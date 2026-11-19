export const ALL_SITE_ORIGINS = ["http://*/*", "https://*/*"] as const;
export const OBSERVER_SCRIPT_ID = "htws-page-observer-v1";
const BOOTSTRAP_CONCURRENCY = 8;

export async function getGrantedOrigins(): Promise<string[]> {
  const permissions = await chrome.permissions.getAll();
  return permissions.origins ?? [];
}

export function classifyHostAccess(
  url: string | undefined,
  grantedOrigins: readonly string[],
): "all" | "none" | "selected" {
  if (hasAllSiteAccess(grantedOrigins)) return "all";
  if (url === undefined) return "none";
  return grantedOrigins.some((pattern) => matchOriginPattern(url, pattern))
    ? "selected"
    : "none";
}

export function hasAllSiteAccess(origins: readonly string[]): boolean {
  return (
    origins.includes("<all_urls>") ||
    ALL_SITE_ORIGINS.every((origin) => origins.includes(origin))
  );
}

export async function syncObserverRegistration(): Promise<void> {
  const origins = await getGrantedOrigins();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const observerScripts = registered.filter((script) =>
    script.js?.includes("observer.js"),
  );
  const current = observerScripts.find(
    (script) => script.id === OBSERVER_SCRIPT_ID,
  );
  const matchesUnchanged =
    current !== undefined &&
    [...(current.matches ?? [])].sort().join("\n") ===
      [...origins].sort().join("\n") &&
    current.js?.join("\n") === "observer.js";
  if (matchesUnchanged) return;
  if (observerScripts.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: observerScripts.map(({ id }) => id),
    });
  }
  if (origins.length === 0) return;

  await chrome.scripting.registerContentScripts([
    {
      allFrames: true,
      id: OBSERVER_SCRIPT_ID,
      js: ["observer.js"],
      matches: origins,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
      runAt: "document_idle",
    },
  ]);
  await bootstrapObservers(origins);
}

export async function bootstrapObservers(
  suppliedOrigins?: readonly string[],
): Promise<void> {
  const origins = suppliedOrigins ?? (await getGrantedOrigins());
  const tabs = await chrome.tabs.query({});
  const eligibleTabs = tabs
    .filter((tab) =>
      origins.some((pattern) => matchOriginPattern(tab.url ?? "", pattern)),
    )
    .filter(
      (tab): tab is chrome.tabs.Tab & { id: number } =>
        tab.id !== undefined && tab.status === "complete",
    );
  await mapSettledWithConcurrency(eligibleTabs, BOOTSTRAP_CONCURRENCY, (tab) =>
    chrome.scripting.executeScript({
      files: ["observer.js"],
      injectImmediately: true,
      target: { allFrames: true, tabId: tab.id },
    }),
  );
}

export async function mapSettledWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<unknown>,
): Promise<void> {
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex++];
        if (value === undefined) continue;
        try {
          await task(value);
        } catch {
          // One inaccessible tab or frame must not prevent the remaining tabs.
        }
      }
    }),
  );
}

export async function refreshTabObserver(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.status !== "complete") return;
  const origins = await getGrantedOrigins();
  if (classifyHostAccess(tab.url, origins) === "none") return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "REQUEST_OBSERVER_SNAPSHOT",
    });
  } catch {
    await chrome.scripting.executeScript({
      files: ["observer.js"],
      injectImmediately: true,
      target: { allFrames: true, tabId: tab.id },
    });
  }
}

export function matchOriginPattern(url: string, pattern: string): boolean {
  if (pattern === "<all_urls>") return /^https?:/i.test(url);
  const match = /^(\*|http|https):\/\/([^/]+)\/\*$/.exec(pattern);
  if (match === null) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host] = match;
  if (scheme !== "*" && `${scheme}:` !== parsed.protocol) return false;
  if (host === "*") return true;
  if (host?.startsWith("*.")) {
    const domain = host.slice(2).toLowerCase();
    return parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
  }
  return parsed.hostname === host?.toLowerCase();
}
