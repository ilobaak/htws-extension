import type {
  ArchiveSessionView,
  ArchiveGroupView,
  ArchiveSnapshot,
  ArchiveTabView,
  ArchiveWindowView,
} from "../background/hibernate-archive";

export interface ArchiveFilterResult {
  matches: ArchiveFilterMatches;
  matchCount: number;
  snapshot: ArchiveSnapshot;
  totalEntries: number;
}

export interface ArchiveFilterMatches {
  groupIds: Set<string>;
  sessionIds: Set<string>;
  tabIds: Set<string>;
  windowIds: Set<string>;
}

export function filterArchiveSnapshot(
  snapshot: ArchiveSnapshot,
  rawQuery: string,
): ArchiveFilterResult {
  const query = normalizeSearchText(rawQuery);
  const totalEntries = countEntries(snapshot);
  if (query === "") {
    return {
      matchCount: totalEntries,
      matches: collectMatches(snapshot, query),
      snapshot,
      totalEntries,
    };
  }

  const sessions = snapshot.sessions.flatMap((session) => {
    if (matchesSession(session, query)) return [session];
    const windows = session.windows.flatMap((window) => {
      const filtered = filterWindow(window, query);
      return filtered === undefined ? [] : [filtered];
    });
    return windows.length === 0 ? [] : [{ ...session, windows }];
  });
  const windows = snapshot.windows.flatMap((window) => {
    const filtered = filterWindow(window, query);
    return filtered === undefined ? [] : [filtered];
  });
  const tabs = snapshot.tabs.filter((tab) => matchesTab(tab, query));
  const filteredSnapshot = { sessions, tabs, windows };

  return {
    matchCount: countMatches(snapshot, query),
    matches: collectMatches(snapshot, query),
    snapshot: {
      ...filteredSnapshot,
      tabCount: countTabs(filteredSnapshot),
    },
    totalEntries,
  };
}

function filterWindow(
  window: ArchiveWindowView,
  query: string,
): ArchiveWindowView | undefined {
  if (matchesWindow(window, query)) return window;
  const tabs = window.tabs.filter((tab) => matchesTab(tab, query));
  const matchingGroupKeys = new Set(
    (window.groups ?? [])
      .filter((group) => matchesGroup(group, query))
      .map((group) => group.key),
  );
  const visibleTabs = window.tabs.filter(
    (tab) =>
      tabs.includes(tab) ||
      (tab.groupKey !== undefined && matchingGroupKeys.has(tab.groupKey)),
  );
  const groups = (window.groups ?? []).flatMap((group) => {
    const groupTabs = visibleTabs.filter((tab) => tab.groupKey === group.key);
    return groupTabs.length === 0 ? [] : [{ ...group, tabs: groupTabs }];
  });
  return visibleTabs.length === 0
    ? undefined
    : { ...window, groups, tabs: visibleTabs };
}

function matchesGroup(group: ArchiveGroupView, query: string): boolean {
  return matches([group.title, group.color], query);
}

function matchesSession(session: ArchiveSessionView, query: string): boolean {
  return matches([session.name, dateSearchText(session.createdAt)], query);
}

function matchesWindow(window: ArchiveWindowView, query: string): boolean {
  const group = window.entryType === "group" ? window.groups?.[0] : undefined;
  return matches(
    [window.name, group?.title, group?.color, dateSearchText(window.createdAt)],
    query,
  );
}

function matchesTab(tab: ArchiveTabView, query: string): boolean {
  return matches(
    [
      tab.title,
      tab.url,
      tab.groupTitle,
      tab.groupColor,
      dateSearchText(tab.createdAt),
    ],
    query,
  );
}

function matches(values: Array<string | undefined>, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  const searchable = normalizeSearchText(
    values.filter((value): value is string => value !== undefined).join(" "),
  );
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((term) => searchable.includes(term));
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function collectMatches(
  snapshot: ArchiveSnapshot,
  query: string,
): ArchiveFilterMatches {
  const result: ArchiveFilterMatches = {
    groupIds: new Set(),
    sessionIds: new Set(),
    tabIds: new Set(),
    windowIds: new Set(),
  };
  const includeWindow = (window: ArchiveWindowView): void => {
    if (query === "" || matchesWindow(window, query))
      result.windowIds.add(window.folderId);
    for (const group of window.groups ?? []) {
      if (query === "" || matchesGroup(group, query))
        result.groupIds.add(`${group.folderId}\u0000${group.key}`);
    }
    for (const tab of window.tabs) {
      if (query === "" || matchesTab(tab, query))
        result.tabIds.add(tab.bookmarkId);
    }
  };
  for (const session of snapshot.sessions) {
    if (query === "" || matchesSession(session, query))
      result.sessionIds.add(session.sessionId);
    session.windows.forEach(includeWindow);
  }
  snapshot.windows.forEach(includeWindow);
  for (const tab of snapshot.tabs) {
    if (query === "" || matchesTab(tab, query))
      result.tabIds.add(tab.bookmarkId);
  }
  return result;
}

function dateSearchText(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toISOString()} ${date.toLocaleString()}`;
}

function countMatches(snapshot: ArchiveSnapshot, query: string): number {
  return (
    snapshot.sessions.reduce(
      (total, session) =>
        total +
        Number(matchesSession(session, query)) +
        session.windows.reduce(
          (windowTotal, window) =>
            windowTotal +
            Number(matchesWindow(window, query)) +
            (window.entryType === "group"
              ? 0
              : (window.groups ?? []).filter((group) =>
                  matchesGroup(group, query),
                ).length) +
            window.tabs.filter((tab) => matchesTab(tab, query)).length,
          0,
        ),
      0,
    ) +
    snapshot.windows.reduce(
      (total, window) =>
        total +
        Number(matchesWindow(window, query)) +
        (window.entryType === "group"
          ? 0
          : (window.groups ?? []).filter((group) => matchesGroup(group, query))
              .length) +
        window.tabs.filter((tab) => matchesTab(tab, query)).length,
      0,
    ) +
    snapshot.tabs.filter((tab) => matchesTab(tab, query)).length
  );
}

function countEntries(snapshot: ArchiveSnapshot): number {
  return (
    snapshot.sessions.reduce(
      (total, session) =>
        total +
        1 +
        session.windows.reduce(
          (windowTotal, window) =>
            windowTotal +
            1 +
            (window.entryType === "group" ? 0 : (window.groups?.length ?? 0)) +
            window.tabs.length,
          0,
        ),
      0,
    ) +
    snapshot.windows.reduce(
      (total, window) =>
        total +
        1 +
        (window.entryType === "group" ? 0 : (window.groups?.length ?? 0)) +
        window.tabs.length,
      0,
    ) +
    snapshot.tabs.length
  );
}

function countTabs(
  snapshot: Pick<ArchiveSnapshot, "sessions" | "tabs" | "windows">,
): number {
  return (
    snapshot.tabs.length +
    snapshot.windows.reduce((total, window) => total + window.tabs.length, 0) +
    snapshot.sessions.reduce(
      (total, session) =>
        total +
        session.windows.reduce(
          (windowTotal, window) => windowTotal + window.tabs.length,
          0,
        ),
      0,
    )
  );
}
