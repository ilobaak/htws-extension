import type { Settings } from "../shared/settings";
import { classifyTabUrl, isArchiveableUrl } from "./tab-url";

export function resolveLastAccessed(
  tab: chrome.tabs.Tab,
  tracked: number | undefined,
  now: number,
): number {
  const native =
    typeof tab.lastAccessed === "number" && Number.isFinite(tab.lastAccessed)
      ? tab.lastAccessed
      : 0;
  return Math.max(native, tracked ?? 0) || now;
}

export function shouldCheckAutoHibernateTab(
  tab: chrome.tabs.Tab,
  settings: Settings,
  lastAccessed: number,
  now: number,
): boolean {
  if (settings.autoHibernateMinutes === null || tab.id === undefined) {
    return false;
  }
  const url = tab.pendingUrl ?? tab.url;
  if (tab.active || typeof url !== "string" || !isArchiveableUrl(url)) {
    return false;
  }
  if (tab.incognito && !settings.autoHibernateIncludeIncognito) return false;
  if (
    classifyTabUrl(url) === "internal" &&
    !settings.autoHibernateIncludeInternalPages
  ) {
    return false;
  }
  return now - lastAccessed >= settings.autoHibernateMinutes * 60_000;
}

export function planAutoHibernateBatches(
  tabs: chrome.tabs.Tab[],
  settings: Settings,
  now: number,
): chrome.tabs.Tab[][] {
  const batches: chrome.tabs.Tab[][] = [];
  const grouped = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (
      settings.autoHibernateGroupedTabs === "together" &&
      tab.groupId !== -1
    ) {
      const key = `${tab.windowId}:${tab.groupId}`;
      const members = grouped.get(key) ?? [];
      members.push(tab);
      grouped.set(key, members);
    } else if (
      shouldCheckAutoHibernateTab(tab, settings, tab.lastAccessed, now)
    ) {
      batches.push([tab]);
    }
  }
  for (const members of grouped.values()) {
    if (
      members.every((tab) =>
        shouldCheckAutoHibernateTab(tab, settings, tab.lastAccessed, now),
      )
    ) {
      batches.push(members);
    }
  }
  return batches;
}
