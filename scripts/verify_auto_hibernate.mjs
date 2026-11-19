/* global chrome, setTimeout */

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
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
const profilePath = await mkdtemp(resolve(tmpdir(), "htws-auto-hibernate-"));
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${request.url}</title><p>Auto test</p>`);
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("The auto-hibernation server did not expose a TCP port.");
}

let browser;
try {
  browser = await puppeteer.launch({
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--user-data-dir=${profilePath}`,
    ],
    executablePath: bravePath,
    headless: true,
  });
  const worker = await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      target.url().startsWith("chrome-extension://"),
    { timeout: 15_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  });
  const base = `http://127.0.0.1:${address.port}`;
  const setup = await page.evaluate(async (baseUrl) => {
    const urls = [
      `${baseUrl}/active`,
      `${baseUrl}/auto-target`,
      `${baseUrl}/pinned`,
      `${baseUrl}/group-member`,
      `${baseUrl.replace("127.0.0.1", "localhost")}/protected-group-member`,
      `${baseUrl}/eligible-group-a`,
      `${baseUrl}/eligible-group-b`,
    ];
    const window = await chrome.windows.create({ focused: false, url: urls });
    if (window.id === undefined) throw new Error("Test window has no ID.");
    const tabs = (await chrome.tabs.query({ windowId: window.id })).sort(
      (left, right) => left.index - right.index,
    );
    if (tabs.length !== 7 || tabs.some((tab) => tab.id === undefined)) {
      throw new Error("Automatic hibernation test tabs were not created.");
    }
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.tabs.update(tabs[2].id, { pinned: true });
    const groupId = await chrome.tabs.group({
      createProperties: { windowId: window.id },
      tabIds: [tabs[3].id, tabs[4].id],
    });
    await chrome.tabGroups.update(groupId, {
      collapsed: true,
      color: "purple",
      title: "Protected group",
    });
    const eligibleGroupId = await chrome.tabs.group({
      createProperties: { windowId: window.id },
      tabIds: [tabs[5].id, tabs[6].id],
    });
    await chrome.tabGroups.update(eligibleGroupId, {
      collapsed: false,
      color: "green",
      title: "Eligible group",
    });
    await chrome.storage.local.set({
      siteRules: {
        rules: [
          {
            enabled: true,
            id: "acceptance-protected-group",
            matchType: "hostname",
            pattern: "localhost",
          },
        ],
        schemaVersion: 1,
      },
    });
    await chrome.storage.sync.set({
      settings: {
        activityRetentionDays: 90,
        autoHibernateGroupedTabs: "together",
        autoHibernateIncludeIncognito: false,
        autoHibernateIncludeInternalPages: false,
        autoHibernateMinutes: 1,
        autoHibernateUnit: "minutes",
        incognitoBehavior: "keep-open",
        internalPageBehavior: "archive",
        protectAudible: true,
        protectModifiedFields: true,
        protectPinned: true,
        protectPlayingMedia: true,
        schemaVersion: 8,
      },
    });
    const alarmDeadline = Date.now() + 5_000;
    while (Date.now() < alarmDeadline) {
      if ((await chrome.alarms.get("htws-auto-hibernate")) !== undefined) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if ((await chrome.alarms.get("htws-auto-hibernate")) === undefined) {
      throw new Error("The automatic hibernation alarm was not scheduled.");
    }
    return {
      activeTabId: tabs[0].id,
      eligibleGroupTabIds: [tabs[5].id, tabs[6].id],
      eligibleGroupUrls: [urls[5], urls[6]],
      groupedTabIds: [tabs[3].id, tabs[4].id],
      pinnedTabId: tabs[2].id,
      targetTabId: tabs[1].id,
      targetUrl: urls[1],
    };
  }, base);

  const deadline = Date.now() + 135_000;
  let result;
  while (Date.now() < deadline) {
    result = await page.evaluate(
      async ({
        activeTabId,
        eligibleGroupTabIds,
        groupedTabIds,
        pinnedTabId,
        targetTabId,
      }) => {
        const exists = async (tabId) =>
          chrome.tabs
            .get(tabId)
            .then(() => true)
            .catch(() => false);
        const [archive, alarm, settings, session] = await Promise.all([
          chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }),
          chrome.alarms.get("htws-auto-hibernate"),
          chrome.storage.sync.get("settings"),
          chrome.storage.session.get("autoHibernateTabAccess"),
        ]);
        const target = await chrome.tabs
          .get(targetTabId)
          .catch(() => undefined);
        return {
          activeExists: await exists(activeTabId),
          alarm,
          archive,
          eligibleGroupTabsExist: await Promise.all(
            eligibleGroupTabIds.map(exists),
          ),
          now: Date.now(),
          pinnedExists: await exists(pinnedTabId),
          groupedTabsExist: await Promise.all(groupedTabIds.map(exists)),
          session,
          settings,
          target,
          targetExists: await exists(targetTabId),
        };
      },
      setup,
    );
    if (
      !result.targetExists &&
      result.eligibleGroupTabsExist?.every((exists) => !exists)
    )
      break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  const archivedUrls = [
    ...(result?.archive?.tabs ?? []),
    ...(result?.archive?.windows ?? []).flatMap((window) => window.tabs ?? []),
  ].map((tab) => tab.url);
  const archivedGroup = result?.archive?.windows?.find(
    (window) =>
      window.entryType === "group" && window.name === "Eligible group",
  );
  if (
    result?.targetExists !== false ||
    result.activeExists !== true ||
    result.pinnedExists !== true ||
    result.groupedTabsExist?.some((exists) => !exists) ||
    result.eligibleGroupTabsExist?.some((exists) => exists) ||
    archivedGroup?.groups?.[0]?.color !== "green" ||
    !setup.eligibleGroupUrls.every((url) =>
      archivedGroup?.tabs?.some((tab) => tab.url === url),
    ) ||
    !archivedUrls.includes(setup.targetUrl)
  ) {
    throw new Error(
      `Automatic hibernation contract failed: ${JSON.stringify({ archivedUrls, result, setup })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      activeTabStayedOpen: true,
      archivedUrl: setup.targetUrl,
      extensionId,
      eligibleGroupArchivedTogether: true,
      protectedGroupStayedOpen: true,
      pinnedTabStayedOpen: true,
    })}\n`,
  );
} finally {
  if (browser !== undefined) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profilePath, { force: true, recursive: true });
}
