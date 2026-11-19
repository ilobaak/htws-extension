/* global chrome, console, setTimeout */

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(root, "dist");
const bravePath =
  process.env.BRAVE_PATH ??
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const outputDirectory = resolve(
  root,
  process.env.BENCHMARK_OUTPUT_DIR ?? "benchmark-results/raw",
);
const repeats = parsePositiveInteger(process.env.BENCHMARK_REPEATS ?? "3");
const workloadMemoryMb = parsePositiveInteger(
  process.env.BENCHMARK_MEMORY_MB ?? "4",
);
const settleMs = parsePositiveInteger(
  process.env.BENCHMARK_SETTLE_MS ?? "3000",
);
const scenarios = parseScenarios(
  process.env.BENCHMARK_SCENARIOS ?? "10x1,30x3,60x6,100x10",
);
const methods = ["native-discard", "htws-hibernate"];
const runStartedAt = new Date();
const runId = runStartedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const resultPath = resolve(outputDirectory, `memory-benchmark-${runId}.json`);
const csvPath = resolve(outputDirectory, `memory-benchmark-${runId}.csv`);
const results = [];

await mkdir(outputDirectory, { recursive: true });

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname !== "/workload") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const tabId = requestUrl.searchParams.get("id") ?? "unknown";
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(workloadDocument(tabId, workloadMemoryMb));
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});

const serverAddress = server.address();
if (serverAddress === null || typeof serverAddress === "string") {
  throw new Error("The benchmark server did not expose a TCP port.");
}
const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

let interrupted = false;
process.once("SIGINT", () => {
  interrupted = true;
});

try {
  for (let repetition = 1; repetition <= repeats; repetition += 1) {
    const orderedMethods =
      repetition % 2 === 1 ? methods : [...methods].reverse();
    for (const scenario of scenarios) {
      for (const method of orderedMethods) {
        if (interrupted) throw new Error("Benchmark interrupted.");
        const label = `${scenario.tabs} tabs / ${scenario.windows} windows / repetition ${repetition} / ${method}`;
        console.log(`Starting ${label}`);
        const result = await runBenchmark({
          baseUrl,
          method,
          repetition,
          scenario,
        });
        results.push(result);
        await persistResults();
        console.log(
          `Completed ${label}: ${formatMb(result.savedWorkingSetBytes)} saved (${result.savedWorkingSetPercent.toFixed(1)}%)`,
        );
      }
    }
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(`Wrote ${resultPath}`);
console.log(`Wrote ${csvPath}`);

async function runBenchmark({
  baseUrl: workloadBaseUrl,
  method,
  repetition,
  scenario,
}) {
  const profilePath = await mkdtemp(
    resolve(tmpdir(), "htws-memory-benchmark-"),
  );
  const resolvedProfilePath = resolve(profilePath);
  const resolvedTemporaryRoot = resolve(tmpdir());
  if (!resolvedProfilePath.startsWith(`${resolvedTemporaryRoot}\\`)) {
    throw new Error(
      `Refusing to use non-temporary profile path: ${profilePath}`,
    );
  }
  let browser;
  const benchmarkStartedAt = new Date();
  try {
    browser = await puppeteer.launch({
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--user-data-dir=${profilePath}`,
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--no-first-run",
      ],
      executablePath: bravePath,
      headless: true,
    });

    const browserProcess = browser.process();
    if (browserProcess === null || browserProcess.pid === undefined) {
      throw new Error("Brave did not expose its root process ID.");
    }

    const worker = await browser.waitForTarget(
      (target) =>
        target.type() === "service_worker" &&
        target.url().startsWith("chrome-extension://"),
      { timeout: 20_000 },
    );
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await browser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    });

    const setup = await extensionPage.evaluate(
      async ({ benchmarkBaseUrl, tabCount, windowCount }) => {
        await chrome.storage.sync.set({
          settings: {
            activityRetentionDays: 90,
            autoHibernateGroupedTabs: "together",
            autoHibernateIncludeIncognito: false,
            autoHibernateIncludeInternalPages: false,
            autoHibernateMinutes: null,
            autoHibernateUnit: "minutes",
            incognitoBehavior: "keep-open",
            internalPageBehavior: "archive",
            protectAudible: false,
            protectModifiedFields: false,
            protectPinned: false,
            protectPlayingMedia: false,
            schemaVersion: 8,
          },
        });

        const controllerTab = await chrome.tabs.getCurrent();
        if (controllerTab?.windowId === undefined) {
          throw new Error("The extension controller window was unavailable.");
        }

        const baseTabsPerWindow = Math.floor(tabCount / windowCount);
        const extraTabs = tabCount % windowCount;
        const createdWindowIds = [];
        let nextTab = 0;
        for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
          const count = baseTabsPerWindow + (windowIndex < extraTabs ? 1 : 0);
          const urls = Array.from({ length: count }, () => {
            const url = `${benchmarkBaseUrl}/workload?id=${nextTab}`;
            nextTab += 1;
            return url;
          });
          const createdWindow = await chrome.windows.create({
            focused: false,
            url: urls,
          });
          if (createdWindow.id === undefined) {
            throw new Error("A benchmark window was created without an ID.");
          }
          createdWindowIds.push(createdWindow.id);
        }

        await chrome.windows.update(controllerTab.windowId, { focused: true });
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const benchmarkTabs = (await chrome.tabs.query({})).filter((tab) =>
            tab.url?.startsWith(`${benchmarkBaseUrl}/workload`),
          );
          if (
            benchmarkTabs.length === tabCount &&
            benchmarkTabs.every((tab) => tab.status === "complete")
          ) {
            return {
              controllerWindowId: controllerTab.windowId,
              createdWindowIds,
              tabIds: benchmarkTabs.map((tab) => tab.id),
            };
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
        throw new Error("Benchmark tabs did not finish loading in time.");
      },
      {
        benchmarkBaseUrl: workloadBaseUrl,
        tabCount: scenario.tabs,
        windowCount: scenario.windows,
      },
    );

    await delay(settleMs);
    const activeMemory = await sampleProcessTreeMemory(browserProcess.pid);
    const transitionStartedAt = Date.now();
    let transitionedTabs = 0;
    let transitionDetail;

    if (method === "native-discard") {
      transitionDetail = await extensionPage.evaluate(
        async ({ benchmarkBaseUrl, controllerWindowId }) => {
          await chrome.windows.update(controllerWindowId, { focused: true });
          const benchmarkTabs = (await chrome.tabs.query({})).filter((tab) =>
            tab.url?.startsWith(`${benchmarkBaseUrl}/workload`),
          );
          const errors = [];
          for (const tab of benchmarkTabs) {
            if (tab.id === undefined) continue;
            try {
              await chrome.tabs.discard(tab.id);
            } catch (error) {
              errors.push(
                error instanceof Error ? error.message : "Discard failed.",
              );
            }
          }

          const deadline = Date.now() + 30_000;
          let discarded = [];
          while (Date.now() < deadline) {
            discarded = (await chrome.tabs.query({})).filter(
              (tab) =>
                tab.url?.startsWith(`${benchmarkBaseUrl}/workload`) &&
                tab.discarded,
            );
            if (discarded.length === benchmarkTabs.length) break;
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          return {
            attempted: benchmarkTabs.length,
            errors,
            transitioned: discarded.length,
          };
        },
        {
          benchmarkBaseUrl: workloadBaseUrl,
          controllerWindowId: setup.controllerWindowId,
        },
      );
      transitionedTabs = transitionDetail.transitioned;
    } else {
      transitionDetail = await extensionPage.evaluate(async () => {
        return chrome.runtime.sendMessage({
          ignoreProtection: true,
          name: "Memory benchmark",
          type: "HIBERNATE_SESSION",
        });
      });
      transitionedTabs = transitionDetail.archived;
    }

    const transitionDurationMs = Date.now() - transitionStartedAt;
    await delay(settleMs);
    const postMemory = await sampleProcessTreeMemory(browserProcess.pid);
    const remainingTestTabs = await extensionPage.evaluate(
      async (benchmarkBaseUrl) =>
        (await chrome.tabs.query({})).filter((tab) =>
          tab.url?.startsWith(`${benchmarkBaseUrl}/workload`),
        ).length,
      workloadBaseUrl,
    );

    const savedWorkingSetBytes =
      activeMemory.workingSetBytes - postMemory.workingSetBytes;
    const savedPrivateBytes =
      activeMemory.privateBytes - postMemory.privateBytes;

    return {
      activePrivateBytes: activeMemory.privateBytes,
      activeProcessCount: activeMemory.processCount,
      activeWorkingSetBytes: activeMemory.workingSetBytes,
      braveVersion: await browser.version(),
      completedAt: new Date().toISOString(),
      method,
      postPrivateBytes: postMemory.privateBytes,
      postProcessCount: postMemory.processCount,
      postWorkingSetBytes: postMemory.workingSetBytes,
      remainingTestTabs,
      repetition,
      savedPrivateBytes,
      savedPrivatePercent: percent(
        savedPrivateBytes,
        activeMemory.privateBytes,
      ),
      savedWorkingSetBytes,
      savedWorkingSetPercent: percent(
        savedWorkingSetBytes,
        activeMemory.workingSetBytes,
      ),
      startedAt: benchmarkStartedAt.toISOString(),
      tabCount: scenario.tabs,
      transitionedTabs,
      transitionDetail,
      transitionDurationMs,
      windowCount: scenario.windows,
      workloadMemoryMb,
    };
  } finally {
    if (browser !== undefined) await browser.close();
    await rm(resolvedProfilePath, { force: true, recursive: true });
  }
}

async function sampleProcessTreeMemory(rootProcessId) {
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    samples.push(readProcessTreeMemory(rootProcessId));
    if (sampleIndex < 4) await delay(400);
  }
  return {
    privateBytes: median(samples.map((sample) => sample.privateBytes)),
    processCount: Math.round(
      median(samples.map((sample) => sample.processCount)),
    ),
    workingSetBytes: median(samples.map((sample) => sample.workingSetBytes)),
  };
}

function readProcessTreeMemory(rootProcessId) {
  const script = `
$benchmarkProcesses = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount)
$benchmarkIds = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$benchmarkIds.Add([uint32]${rootProcessId})
$benchmarkChanged = $true
while ($benchmarkChanged) {
  $benchmarkChanged = $false
  foreach ($benchmarkProcess in $benchmarkProcesses) {
    if ($benchmarkIds.Contains([uint32]$benchmarkProcess.ParentProcessId) -and $benchmarkIds.Add([uint32]$benchmarkProcess.ProcessId)) {
      $benchmarkChanged = $true
    }
  }
}
$benchmarkSelected = @($benchmarkProcesses | Where-Object { $benchmarkIds.Contains([uint32]$_.ProcessId) })
$benchmarkSummary = [pscustomobject]@{
  privateBytes = [uint64](($benchmarkSelected | Measure-Object -Property PrivatePageCount -Sum).Sum)
  processCount = $benchmarkSelected.Count
  workingSetBytes = [uint64](($benchmarkSelected | Measure-Object -Property WorkingSetSize -Sum).Sum)
}
$benchmarkSummary | ConvertTo-Json -Compress
`;
  const command = spawnSync(
    "powershell",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  if (command.status !== 0) {
    throw new Error(
      `Unable to sample Brave process memory: ${command.stderr.trim()}`,
    );
  }
  return JSON.parse(command.stdout.trim());
}

async function persistResults() {
  const metadata = {
    bravePath,
    completedRuns: results.length,
    generatedAt: new Date().toISOString(),
    methods,
    repeats,
    runStartedAt: runStartedAt.toISOString(),
    scenarios,
    settleMs,
    workloadMemoryMb,
  };
  await writeFile(
    resultPath,
    `${JSON.stringify({ metadata, results }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(csvPath, toCsv(results), "utf8");
}

function toCsv(rows) {
  const columns = [
    "tabCount",
    "windowCount",
    "repetition",
    "method",
    "activeWorkingSetBytes",
    "postWorkingSetBytes",
    "savedWorkingSetBytes",
    "savedWorkingSetPercent",
    "activePrivateBytes",
    "postPrivateBytes",
    "savedPrivateBytes",
    "savedPrivatePercent",
    "activeProcessCount",
    "postProcessCount",
    "transitionedTabs",
    "remainingTestTabs",
    "transitionDurationMs",
    "braveVersion",
    "startedAt",
    "completedAt",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function workloadDocument(tabId, memoryMb) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Memory workload ${tabId}</title></head>
  <body>
    <main id="content"><h1>Memory workload ${tabId}</h1></main>
    <canvas id="canvas" width="512" height="512"></canvas>
    <script>
      const blocks = [];
      for (let block = 0; block < ${memoryMb}; block += 1) {
        const bytes = new Uint8Array(1024 * 1024);
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          bytes[offset] = (block + offset) % 251;
        }
        blocks.push(bytes);
      }
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 750; index += 1) {
        const node = document.createElement("p");
        node.textContent = "Deterministic benchmark row " + index + " for tab ${tabId}";
        fragment.append(node);
      }
      document.querySelector("#content").append(fragment);
      const context = document.querySelector("#canvas").getContext("2d");
      const pixels = context.createImageData(512, 512);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = index % 255;
        pixels.data[index + 1] = (index / 3) % 255;
        pixels.data[index + 2] = (index / 7) % 255;
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      window.__benchmarkBlocks = blocks;
      window.__benchmarkReady = true;
    </script>
  </body>
</html>`;
}

function parseScenarios(value) {
  return value.split(",").map((entry) => {
    const match = /^(\d+)x(\d+)$/.exec(entry.trim());
    if (match === null) {
      throw new Error(`Invalid benchmark scenario: ${entry}`);
    }
    const tabs = parsePositiveInteger(match[1]);
    const windows = parsePositiveInteger(match[2]);
    if (windows > tabs) {
      throw new Error(`Scenario cannot have more windows than tabs: ${entry}`);
    }
    return { tabs, windows };
  });
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function percent(numerator, denominator) {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
