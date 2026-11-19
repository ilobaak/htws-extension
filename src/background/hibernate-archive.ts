import {
  createArchiveExport,
  mergeArchiveExport,
  type ArchiveExportFile,
  type ArchiveImportResult,
} from "./archive-transfer";
import { isBookmarkableUrl } from "../core/tab-url";
import { normalizeGroupColor } from "../shared/group-colors";

const ARCHIVE_STORE_KEY = "hibernateArchiveStore";
const ARCHIVE_HISTORY_KEY = "hibernateArchiveHistory";
const ARCHIVE_HISTORY_LIMIT = 50;
const ROOT_TITLE_PREFIX = "HTWS Archives";
const SAVED_ROOT_TITLE = "HTWS Saved Bookmarks";
const TITLE_SEPARATOR = " - ";
const NO_GROUP_ID = -1;
let archiveMutationQueue: Promise<void> = Promise.resolve();

export interface ArchivedGroupMetadata {
  archivePinned?: true;
  collapsed: boolean;
  color: `${chrome.tabGroups.Color}`;
  title?: string;
}

export interface ArchivedTabMetadata {
  active: boolean;
  archivePinned?: true;
  bookmarkId: string;
  createdAt: number;
  groupKey?: string;
  incognito?: true;
  index: number;
  pinned: boolean;
  savedBookmarkId?: string;
  title: string;
  url: string;
}

export interface ArchivedWindowMetadata {
  archivePinned?: true;
  createdAt: number;
  entryType?: "group" | "tab" | "window";
  groups: Record<string, ArchivedGroupMetadata>;
  incognito?: true;
  name?: string;
  savedFolderId?: string;
  sessionId?: string;
  sourceWindowId: number;
  tabs: Record<string, ArchivedTabMetadata>;
}

export interface ArchivedSessionMetadata {
  archivePinned?: true;
  createdAt: number;
  name?: string;
  savedFolderId?: string;
  windowIds: string[];
}

export interface ArchiveStore {
  legacyRootFolderId?: string;
  schemaVersion: 4;
  sessions: Record<string, ArchivedSessionMetadata>;
  topLevelOrder?: string[];
  windows: Record<string, ArchivedWindowMetadata>;
}

export interface ArchiveTabView {
  archivePinned?: true;
  bookmarkId: string;
  bookmarked?: true;
  createdAt: number;
  folderId?: string;
  groupColor?: `${chrome.tabGroups.Color}`;
  groupKey?: string;
  groupTitle?: string;
  incognito?: true;
  pinned: boolean;
  title: string;
  url: string;
}

export interface ArchiveGroupView {
  archivePinned?: true;
  collapsed: boolean;
  color: `${chrome.tabGroups.Color}`;
  folderId: string;
  key: string;
  tabs: ArchiveTabView[];
  title?: string;
}

export interface ArchiveWindowView {
  archivePinned?: true;
  bookmarked?: true;
  createdAt: number;
  entryType?: "group" | "window";
  folderId: string;
  groups?: ArchiveGroupView[];
  incognito?: true;
  name?: string;
  tabs: ArchiveTabView[];
  title: string;
}

export interface ArchiveSessionView {
  archivePinned?: true;
  bookmarked?: true;
  createdAt: number;
  name?: string;
  sessionId: string;
  title: string;
  windows: ArchiveWindowView[];
}

export interface ArchiveSnapshot {
  entryOrder?: string[];
  sessions: ArchiveSessionView[];
  tabCount: number;
  tabs: ArchiveTabView[];
  windows: ArchiveWindowView[];
}

export interface ArchiveItemReference {
  collapsed?: boolean;
  groupKey?: string;
  id: string;
  type: "group" | "session" | "tab" | "window";
}

interface ArchiveSnapshotHistoryEntry {
  after: ArchiveStore;
  before: ArchiveStore;
  kind: "snapshot";
  label: string;
}

interface ArchiveBookmarkHistoryEntry {
  item?: ArchiveItemReference;
  items: ArchiveItemReference[];
  kind: "bookmark";
  label: string;
}

type ArchiveHistoryEntry =
  ArchiveSnapshotHistoryEntry | ArchiveBookmarkHistoryEntry;

interface ArchiveHistoryStore {
  future: ArchiveHistoryEntry[];
  past: ArchiveHistoryEntry[];
  version: 1;
}

export interface ArchiveHistoryStatus {
  redoLabel?: string;
  undoLabel?: string;
}

export interface BookmarkSelectionResult {
  bookmarked: number;
  changed: number;
}

export interface HibernateArchiveResult {
  archived: number;
  bookmarkIds: string[];
  folderId: string;
  name?: string;
}

export interface HibernateSessionResult {
  archived: number;
  sessionId: string;
  windows: number;
}

export interface RestoreArchiveResult {
  restored: number;
}

export interface DeleteArchiveResult {
  deleted: number;
}

export interface ArchiveSelection {
  groupIds?: string[];
  sessionIds: string[];
  tabIds: string[];
  windowIds: string[];
}

export interface ArchiveSelectionRestorePlan {
  groups: Array<{ folderId: string; groupKey: string }>;
  sessionIds: string[];
  tabIds: string[];
  windowIds: string[];
}

export interface ArchiveRestructureResult {
  movedTabs: number;
  sessionId?: string;
  windowId?: string;
}

export interface ArchivePinResult {
  pinned: boolean;
}

export interface DuplicateArchiveResult {
  duplicated: number;
}

export interface ArchiveGroupMutationResult {
  groupKey?: string;
  movedTabs: number;
}

export interface RenameArchiveResult {
  conflict?: { id: string; name: string };
  merged?: true;
  name: string;
  ok: boolean;
}

export interface RestoreAllArchivesResult {
  restored: number;
  windows: number;
}

interface ExpandedArchiveSelection {
  sessionIds: Set<string>;
  tabIds: Set<string>;
  wholeWindowIds: Set<string>;
}

interface SelectedTabRecord {
  tab: ArchivedTabMetadata;
  window: ArchivedWindowMetadata;
  windowId: string;
}

export async function clearArchive(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const deleted = Object.values(store.windows).reduce(
    (total, window) => total + Object.keys(window.tabs).length,
    0,
  );
  store.sessions = {};
  store.windows = {};
  await saveStore(store, dependencies);
  return { deleted };
}

export async function createArchiveGroup(
  tabIds: string[],
  title: string,
  color: unknown,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveGroupMutationResult> {
  const normalized = normalizeWindowName(title);
  if (normalized === undefined) throw new Error("Enter a group name.");
  const normalizedColor = normalizeGroupColor(color);
  const store = await loadStore(dependencies);
  const records = selectedTabRecords(store, new Set(tabIds));
  if (records.length !== new Set(tabIds).size || records.length === 0) {
    throw new Error("Select at least one available hibernated tab.");
  }
  const windowId = records[0]!.windowId;
  const sameWindow = records.every((record) => record.windowId === windowId);
  const incognito = records[0]!.tab.incognito === true;
  if (records.some((record) => (record.tab.incognito === true) !== incognito)) {
    throw new Error("A group cannot mix regular and private tabs.");
  }
  const window: ArchivedWindowMetadata = sameWindow
    ? records[0]!.window
    : {
        createdAt: dependencies.now().getTime(),
        entryType: "group",
        groups: {},
        ...(incognito ? { incognito: true as const } : {}),
        name: normalized,
        sourceWindowId: records[0]!.window.sourceWindowId,
        tabs: {},
      };
  const groupKey = uniqueGroupKey(window, createArchiveId("group"));
  window.groups[groupKey] = {
    collapsed: false,
    color: normalizedColor,
    title: normalized,
  };
  if (sameWindow) {
    records.forEach((record) => {
      record.tab.groupKey = groupKey;
    });
  } else {
    records.forEach((record, index) => {
      window.tabs[record.tab.bookmarkId] = {
        ...record.tab,
        active: index === 0,
        groupKey,
        index,
      };
    });
    removeTabRecords(store, records);
    store.windows[createArchiveId("entry")] = window;
  }
  if (
    window.sessionId === undefined &&
    records.length === Object.keys(window.tabs).length
  ) {
    window.entryType = "group";
    window.name = normalized;
  }
  normalizeWindowTabs(window);
  await saveStore(store, dependencies);
  return { groupKey, movedTabs: records.length };
}

export async function updateArchiveGroup(
  folderId: string,
  groupKey: string,
  title: string | undefined,
  color: unknown,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveGroupMutationResult> {
  const normalized =
    title === undefined ? undefined : normalizeWindowName(title);
  if (title !== undefined && normalized === undefined)
    throw new Error("Enter a group name.");
  const normalizedColor = normalizeGroupColor(color);
  const store = await loadStore(dependencies);
  const window = store.windows[folderId];
  const group = window?.groups[groupKey];
  if (window === undefined || group === undefined) {
    throw new Error("That archived group no longer exists.");
  }
  if (normalized !== undefined) group.title = normalized;
  group.color = normalizedColor;
  if (window.entryType === "group" && normalized !== undefined) {
    window.name = normalized;
  }
  await saveStore(store, dependencies);
  return {
    groupKey,
    movedTabs: Object.values(window.tabs).filter(
      (tab) => tab.groupKey === groupKey,
    ).length,
  };
}

export async function moveArchiveTabsToGroup(
  tabIds: string[],
  folderId: string,
  groupKey: string | undefined,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveGroupMutationResult> {
  const store = await loadStore(dependencies);
  const window = store.windows[folderId];
  if (window === undefined)
    throw new Error("That hibernated window no longer exists.");
  if (groupKey !== undefined && window.groups[groupKey] === undefined) {
    throw new Error("That archived group no longer exists.");
  }
  const records = selectedTabRecords(store, new Set(tabIds));
  if (records.length !== new Set(tabIds).size || records.length === 0) {
    throw new Error("Select at least one available hibernated tab.");
  }
  if (
    records.some(
      (record) =>
        (record.tab.incognito === true) !== (window.incognito === true),
    )
  ) {
    throw new Error("A group cannot mix regular and private tabs.");
  }
  let nextIndex = Object.values(window.tabs).reduce(
    (maximum, tab) => Math.max(maximum, tab.index + 1),
    0,
  );
  const movedFromOtherWindows = records.filter(
    (record) => record.windowId !== folderId,
  );
  records.forEach((record) => {
    const tab =
      record.windowId === folderId
        ? record.tab
        : { ...record.tab, active: false, index: nextIndex++ };
    if (groupKey === undefined) delete tab.groupKey;
    else tab.groupKey = groupKey;
    window.tabs[tab.bookmarkId] = tab;
  });
  removeTabRecords(store, movedFromOtherWindows);
  normalizeWindowTabs(window);
  if (window.entryType === "group" && Object.keys(window.groups).length === 0) {
    window.entryType = Object.keys(window.tabs).length === 1 ? "tab" : "window";
    if (window.entryType === "tab") delete window.name;
  }
  await saveStore(store, dependencies);
  return {
    ...(groupKey === undefined ? {} : { groupKey }),
    movedTabs: records.length,
  };
}

export async function restoreArchiveGroup(
  folderId: string,
  groupKey: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<RestoreArchiveResult> {
  const store = await loadStore(dependencies);
  const window = store.windows[folderId];
  const group = window?.groups[groupKey];
  const entries = Object.values(window?.tabs ?? {})
    .filter((tab) => tab.groupKey === groupKey)
    .sort((left, right) => left.index - right.index);
  if (window === undefined || group === undefined || entries.length === 0) {
    throw new Error("That archived group no longer exists.");
  }
  const restoredWindow = await dependencies.windows.create({
    focused: true,
    incognito: window.incognito === true,
    url: entries.map((entry) => entry.url),
  });
  if (restoredWindow?.id === undefined) {
    throw new Error("The browser did not create the restored group window.");
  }
  try {
    const restoredTabs = (
      restoredWindow.tabs ??
      (await dependencies.tabs.query({ windowId: restoredWindow.id }))
    )
      .filter(
        (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
      )
      .sort((left, right) => left.index - right.index);
    if (restoredTabs.length < entries.length) {
      throw new Error("The browser did not restore every grouped tab.");
    }
    await restoreWindowGroups(
      restoredWindow.id,
      restoredTabs,
      entries,
      window,
      dependencies,
    );
    const activeIndex = entries.findIndex((entry) => entry.active);
    const activeTab = restoredTabs[Math.max(0, activeIndex)];
    if (activeTab !== undefined) {
      await dependencies.tabs.update(activeTab.id, { active: true });
    }
    entries.forEach((entry) => delete window.tabs[entry.bookmarkId]);
    normalizeWindowTabs(window);
    if (Object.keys(window.tabs).length === 0) {
      delete store.windows[folderId];
      removeWindowFromSession(store, folderId);
    }
    await saveStore(store, dependencies);
  } catch (error) {
    await dependencies.windows.remove(restoredWindow.id).catch(() => undefined);
    throw error;
  }
  return { restored: entries.length };
}

export async function deleteArchiveGroup(
  folderId: string,
  groupKey: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const window = store.windows[folderId];
  if (window?.groups[groupKey] === undefined) {
    throw new Error("That archived group no longer exists.");
  }
  const tabIds = Object.values(window.tabs)
    .filter((tab) => tab.groupKey === groupKey)
    .map((tab) => tab.bookmarkId);
  tabIds.forEach((tabId) => delete window.tabs[tabId]);
  normalizeWindowTabs(window);
  if (Object.keys(window.tabs).length === 0) {
    delete store.windows[folderId];
    removeWindowFromSession(store, folderId);
  }
  await saveStore(store, dependencies);
  return { deleted: tabIds.length };
}

export async function restoreAllArchives(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<RestoreAllArchivesResult> {
  const snapshot = await getArchiveSnapshot(dependencies);
  const windows =
    snapshot.windows.length +
    snapshot.sessions.reduce(
      (total, session) => total + session.windows.length,
      0,
    );
  let restored = 0;
  for (const session of snapshot.sessions) {
    restored += (await restoreArchiveSession(session.sessionId, dependencies))
      .restored;
  }
  for (const window of snapshot.windows) {
    restored += (await restoreArchiveWindow(window.folderId, dependencies))
      .restored;
  }
  for (const tab of snapshot.tabs) {
    restored += (
      await restoreArchiveTab(tab.bookmarkId, undefined, dependencies)
    ).restored;
  }
  return { restored, windows };
}

export async function mergeArchiveSelection(
  selection: ArchiveSelection,
  destination: "session" | "window",
  name: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveRestructureResult> {
  const normalizedName = normalizeWindowName(name);
  if (normalizedName === undefined) {
    throw new Error(`Enter a ${destination} name.`);
  }
  const store = await loadStore(dependencies);
  const expanded = expandArchiveSelection(store, selection);
  const records = selectedTabRecords(store, expanded.tabIds);
  if (records.length === 0)
    throw new Error("Select at least one archived tab.");
  if (destination === "window") {
    assertUniqueWindowName(store, normalizedName, undefined);
    const windowId = createArchiveId("entry");
    const window = createEmptyWindowMetadata(
      normalizedName,
      records[0]!.window.sourceWindowId,
      dependencies.now().getTime(),
      undefined,
      records[0]!.tab.incognito === true,
    );
    appendTabRecords(window, records);
    removeTabRecords(store, records);
    store.windows[windowId] = window;
    await saveStore(store, dependencies);
    return { movedTabs: records.length, windowId };
  }

  assertUniqueSessionName(store, normalizedName);
  const sessionId = createArchiveId("session");
  const session: ArchivedSessionMetadata = {
    createdAt: dependencies.now().getTime(),
    name: normalizedName,
    windowIds: [],
  };
  const partialByWindow = new Map<string, SelectedTabRecord[]>();
  const standaloneRecords = new Map<boolean, SelectedTabRecord[]>();

  for (const windowId of expanded.wholeWindowIds) {
    const window = store.windows[windowId];
    if (window === undefined) continue;
    removeWindowFromSession(store, windowId);
    window.sessionId = sessionId;
    window.entryType = "window";
    window.name = uniqueWindowNameInSession(
      store,
      session,
      window.name ?? `Window ${session.windowIds.length + 1}`,
    );
    session.windowIds.push(windowId);
  }
  for (const record of records) {
    if (expanded.wholeWindowIds.has(record.windowId)) continue;
    if (
      archiveEntryType(record.window) === "tab" &&
      record.window.sessionId === undefined
    ) {
      const incognito = record.tab.incognito === true;
      const grouped = standaloneRecords.get(incognito) ?? [];
      grouped.push(record);
      standaloneRecords.set(incognito, grouped);
      continue;
    }
    const grouped = partialByWindow.get(record.windowId) ?? [];
    grouped.push(record);
    partialByWindow.set(record.windowId, grouped);
  }

  const partialGroups = [...partialByWindow.values()];
  partialGroups.push(...standaloneRecords.values());
  for (const group of partialGroups) {
    const source = group[0]!.window;
    const windowId = createArchiveId("entry");
    const window = createEmptyWindowMetadata(
      uniqueWindowNameInSession(
        store,
        session,
        source.name ?? `Window ${session.windowIds.length + 1}`,
      ),
      source.sourceWindowId,
      dependencies.now().getTime(),
      sessionId,
      group[0]!.tab.incognito === true,
    );
    appendTabRecords(window, group);
    store.windows[windowId] = window;
    session.windowIds.push(windowId);
  }
  removeTabRecords(
    store,
    records.filter((record) => !expanded.wholeWindowIds.has(record.windowId)),
  );
  for (const selectedSessionId of expanded.sessionIds) {
    delete store.sessions[selectedSessionId];
  }
  store.sessions[sessionId] = session;
  await saveStore(store, dependencies);
  return { movedTabs: records.length, sessionId };
}

export async function moveArchiveTabsOut(
  selection: ArchiveSelection,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveRestructureResult> {
  const store = await loadStore(dependencies);
  const expanded = expandArchiveSelection(store, selection);
  const records = selectedTabRecords(store, expanded.tabIds).filter(
    (record) =>
      archiveEntryType(record.window) !== "tab" ||
      record.window.sessionId !== undefined,
  );
  if (records.length === 0) {
    throw new Error("Select at least one tab that is inside a window.");
  }
  for (const record of records) {
    const entryId = createArchiveId("entry");
    const window: ArchivedWindowMetadata = {
      createdAt: record.tab.createdAt,
      entryType: "tab",
      groups: {},
      ...(record.tab.incognito ? { incognito: true as const } : {}),
      sourceWindowId: record.window.sourceWindowId,
      tabs: {},
    };
    appendTabRecords(window, [record]);
    store.windows[entryId] = window;
  }
  removeTabRecords(store, records);
  await saveStore(store, dependencies);
  return { movedTabs: records.length };
}

export async function moveArchiveWindowsOut(
  selection: ArchiveSelection,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveRestructureResult> {
  const store = await loadStore(dependencies);
  const expanded = expandArchiveSelection(store, selection);
  let movedTabs = 0;
  for (const windowId of expanded.wholeWindowIds) {
    const window = store.windows[windowId];
    if (window?.sessionId === undefined) continue;
    movedTabs += Object.keys(window.tabs).length;
    removeWindowFromSession(store, windowId);
    delete window.sessionId;
    window.entryType = "window";
  }
  if (movedTabs === 0) {
    throw new Error("Select at least one window that is inside a session.");
  }
  await saveStore(store, dependencies);
  return { movedTabs };
}

export async function bookmarkArchiveSelection(
  selection: ArchiveSelection,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<BookmarkSelectionResult> {
  return serializeArchiveMutation(async () => {
    const store = await loadStore(dependencies);
    const expanded = expandArchiveSelection(store, selection);
    const snapshot = await getArchiveSnapshot(dependencies);
    const sessionById = new Map(
      snapshot.sessions.map((session) => [session.sessionId, session]),
    );
    const allWindows = [
      ...snapshot.windows,
      ...snapshot.sessions.flatMap((session) => session.windows),
    ];
    const windowById = new Map(
      allWindows.map((window) => [window.folderId, window]),
    );
    const allTabs = [
      ...snapshot.tabs,
      ...allWindows.flatMap((window) => window.tabs),
    ];
    const tabById = new Map(allTabs.map((tab) => [tab.bookmarkId, tab]));
    const selectedSessions = new Set(expanded.sessionIds);
    const selectedWindows = new Set(
      [...expanded.wholeWindowIds].filter((windowId) => {
        const parentId = store.windows[windowId]?.sessionId;
        return parentId === undefined || !selectedSessions.has(parentId);
      }),
    );
    const coveredTabIds = new Set<string>();
    for (const sessionId of selectedSessions) {
      const session = store.sessions[sessionId];
      for (const windowId of session?.windowIds ?? []) {
        for (const tabId of Object.keys(store.windows[windowId]?.tabs ?? {}))
          coveredTabIds.add(tabId);
      }
    }
    for (const windowId of selectedWindows) {
      for (const tabId of Object.keys(store.windows[windowId]?.tabs ?? {}))
        coveredTabIds.add(tabId);
    }
    const selectedTabs = [...expanded.tabIds].filter(
      (tabId) => !coveredTabIds.has(tabId),
    );
    if (
      selectedSessions.size === 0 &&
      selectedWindows.size === 0 &&
      selectedTabs.length === 0
    ) {
      throw new Error("Select at least one archived entry.");
    }
    const changedItems: ArchiveItemReference[] = [];
    let changed = 0;
    const bookmarkMissingTabs = async (
      tabs: readonly ArchiveTabView[],
    ): Promise<void> => {
      for (const tab of tabs) {
        if (!isArchiveTabBookmarkable(tab)) continue;
        if (tab.bookmarked === true) continue;
        const result = await toggleArchiveTabBookmark(
          tab.bookmarkId,
          dependencies,
        );
        changed += result.changed;
        changedItems.push({ id: tab.bookmarkId, type: "tab" });
      }
    };
    for (const sessionId of selectedSessions) {
      const session = sessionById.get(sessionId);
      if (session?.bookmarked === true) continue;
      const tabs = (
        session?.windows.flatMap((window) => window.tabs) ?? []
      ).filter(isArchiveTabBookmarkable);
      if (tabs.length === 0) continue;
      if (tabs.some((tab) => tab.bookmarked === true)) {
        await bookmarkMissingTabs(tabs);
        continue;
      }
      const result = await toggleArchiveSessionBookmark(
        sessionId,
        dependencies,
      );
      changed += result.changed;
      changedItems.push({ id: sessionId, type: "session" });
    }
    for (const windowId of selectedWindows) {
      const window = windowById.get(windowId);
      if (window === undefined || !window.tabs.some(isArchiveTabBookmarkable)) {
        continue;
      }
      if (window?.bookmarked === true) continue;
      if (window?.tabs.some((tab) => tab.bookmarked === true) === true) {
        await bookmarkMissingTabs(window.tabs);
        continue;
      }
      const result = await toggleArchiveWindowBookmark(windowId, dependencies);
      changed += result.changed;
      changedItems.push({ id: windowId, type: "window" });
    }
    for (const tabId of selectedTabs) {
      const tab = tabById.get(tabId);
      if (tab === undefined || !isArchiveTabBookmarkable(tab)) continue;
      if (tab.bookmarked === true) continue;
      const result = await toggleArchiveTabBookmark(tabId, dependencies);
      changed += result.changed;
      changedItems.push({ id: tabId, type: "tab" });
    }
    if (changedItems.length > 0) {
      await pushHistory(
        {
          items: changedItems,
          kind: "bookmark",
          label: "Bookmark Selected",
        },
        dependencies,
      );
    }
    return {
      bookmarked:
        selectedSessions.size + selectedWindows.size + selectedTabs.length,
      changed,
    };
  });
}

export async function moveArchiveItem(
  source: ArchiveItemReference,
  target: ArchiveItemReference | undefined,
  placement: "after" | "before" | "inside",
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveRestructureResult> {
  const store = await loadStore(dependencies);
  if (source.type === "group" && typeof source.collapsed === "boolean") {
    const group = store.windows[source.id]?.groups[source.groupKey!];
    if (group !== undefined) group.collapsed = source.collapsed;
  }
  const movedTabs = countItemTabs(store, source);
  if (
    target !== undefined &&
    source.type === target.type &&
    source.id === target.id &&
    source.groupKey === target.groupKey
  ) {
    throw new Error("Drop the item on a different entry.");
  }
  if (placement === "inside") {
    moveItemInside(store, source, target, dependencies.now().getTime());
  } else {
    moveItemBeside(store, source, target, placement);
  }
  normalizeTopLevelOrder(store);
  await saveStore(store, dependencies);
  return { movedTabs };
}

export async function mergeArchiveItems(
  items: ArchiveItemReference[],
  destination: ArchiveItemReference,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveRestructureResult> {
  const store = await loadStore(dependencies);
  if (!items.some((item) => sameArchiveItem(item, destination))) {
    throw new Error("The merge destination must be selected.");
  }
  let movedTabs = 0;
  for (const source of items) {
    if (sameArchiveItem(source, destination)) continue;
    movedTabs += countItemTabs(store, source);
    moveItemInside(store, source, destination, dependencies.now().getTime());
  }
  if (movedTabs === 0) throw new Error("Select at least two archive entries.");
  normalizeTopLevelOrder(store);
  await saveStore(store, dependencies);
  return { movedTabs };
}

export async function toggleArchivePin(
  item: ArchiveItemReference,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchivePinResult> {
  const store = await loadStore(dependencies);
  let target:
    | ArchivedGroupMetadata
    | ArchivedSessionMetadata
    | ArchivedTabMetadata
    | ArchivedWindowMetadata
    | undefined;
  if (item.type === "session") target = store.sessions[item.id];
  else if (item.type === "window") target = store.windows[item.id];
  else if (item.type === "tab")
    target = findArchivedTab(store, item.id)?.metadata;
  else target = store.windows[item.id]?.groups[item.groupKey!];
  if (target === undefined)
    throw new Error("That archive entry no longer exists.");
  const pinned = target.archivePinned !== true;
  if (pinned) target.archivePinned = true;
  else delete target.archivePinned;
  await saveStore(store, dependencies);
  return { pinned };
}

export async function deleteArchiveSelection(
  selection: ArchiveSelection,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const expanded = expandArchiveSelection(store, selection);
  const records = selectedTabRecords(store, expanded.tabIds);
  if (records.length === 0) throw new Error("Select an archive entry first.");
  removeTabRecords(store, records);
  normalizeTopLevelOrder(store);
  await saveStore(store, dependencies);
  return { deleted: records.length };
}

export async function duplicateArchiveSelection(
  selection: ArchiveSelection,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DuplicateArchiveResult> {
  const store = await loadStore(dependencies);
  normalizeTopLevelOrder(store);
  const expanded = expandArchiveSelection(store, selection);
  let duplicated = 0;

  for (const sessionId of selection.sessionIds) {
    const sourceSession = store.sessions[sessionId];
    if (sourceSession === undefined) continue;
    const nextSessionId = createArchiveId("session");
    const nextSession: ArchivedSessionMetadata = {
      createdAt: sourceSession.createdAt,
      ...(sourceSession.name === undefined
        ? {}
        : { name: copyName(sourceSession.name) }),
      windowIds: [],
    };
    for (const windowId of sourceSession.windowIds) {
      const sourceWindow = store.windows[windowId];
      if (sourceWindow === undefined) continue;
      const nextWindowId = createArchiveId("entry");
      const nextWindow = cloneArchiveWindow(sourceWindow, nextSessionId);
      store.windows[nextWindowId] = nextWindow;
      nextSession.windowIds.push(nextWindowId);
      duplicated += Object.keys(nextWindow.tabs).length;
    }
    store.sessions[nextSessionId] = nextSession;
    insertTopLevelCopy(
      store,
      `session:${sessionId}`,
      `session:${nextSessionId}`,
    );
  }

  for (const windowId of selection.windowIds) {
    if (expanded.sessionIds.has(store.windows[windowId]?.sessionId ?? ""))
      continue;
    const sourceWindow = store.windows[windowId];
    if (sourceWindow === undefined) continue;
    const nextWindowId = createArchiveId("entry");
    const nextWindow = cloneArchiveWindow(sourceWindow, sourceWindow.sessionId);
    store.windows[nextWindowId] = nextWindow;
    duplicated += Object.keys(nextWindow.tabs).length;
    if (sourceWindow.sessionId !== undefined) {
      const ids = store.sessions[sourceWindow.sessionId]?.windowIds;
      if (ids !== undefined) insertBeside(ids, nextWindowId, windowId, "after");
    } else {
      insertTopLevelCopy(store, `window:${windowId}`, `window:${nextWindowId}`);
    }
  }

  const selectedGroupIds = new Set(selection.groupIds ?? []);
  for (const groupId of selectedGroupIds) {
    const [windowId = "", groupKey] = groupId.split("\u0000", 2);
    const window = store.windows[windowId];
    if (
      window === undefined ||
      groupKey === undefined ||
      window.groups[groupKey] === undefined ||
      expanded.wholeWindowIds.has(windowId)
    )
      continue;
    const sourceTabs = Object.values(window.tabs).filter(
      (tab) => tab.groupKey === groupKey,
    );
    const nextGroupKey = uniqueGroupKey(window, createArchiveId("group"));
    const sourceGroup = window.groups[groupKey]!;
    window.groups[nextGroupKey] = {
      ...structuredClone(sourceGroup),
      ...(sourceGroup.title === undefined
        ? {}
        : { title: copyName(sourceGroup.title) }),
    };
    insertTabCopies(window, sourceTabs, nextGroupKey);
    duplicated += sourceTabs.length;
  }

  const selectedTabIds = new Set(selection.tabIds);
  for (const groupId of selectedGroupIds) {
    const [windowId = "", groupKey] = groupId.split("\u0000", 2);
    const window = store.windows[windowId];
    Object.values(window?.tabs ?? {})
      .filter((tab) => tab.groupKey === groupKey)
      .forEach((tab) => selectedTabIds.delete(tab.bookmarkId));
  }
  for (const tabId of selectedTabIds) {
    const found = findArchivedTab(store, tabId);
    if (found === undefined || expanded.wholeWindowIds.has(found.entryId))
      continue;
    if (archiveEntryType(found.windowMetadata) === "tab") {
      const nextWindowId = createArchiveId("entry");
      const nextWindow = cloneArchiveWindow(found.windowMetadata);
      store.windows[nextWindowId] = nextWindow;
      duplicated += 1;
      insertTopLevelCopy(
        store,
        `tab:${tabId}`,
        `tab:${Object.keys(nextWindow.tabs)[0]}`,
      );
    } else {
      insertTabCopies(
        found.windowMetadata,
        [found.metadata],
        found.metadata.groupKey,
      );
      duplicated += 1;
    }
  }

  if (duplicated === 0) throw new Error("Select an archive entry first.");
  normalizeTopLevelOrder(store);
  await saveStore(store, dependencies);
  return { duplicated };
}

export async function recordArchiveMutation<T>(
  label: string,
  action: () => Promise<T>,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<T> {
  return serializeArchiveMutation(async () => {
    const before = cloneStore(await loadStore(dependencies));
    const result = await action();
    const after = cloneStore(await loadStore(dependencies));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await pushHistory(
        { after, before, kind: "snapshot", label },
        dependencies,
      );
    }
    return result;
  });
}

export async function recordArchiveBookmarkMutation<T>(
  label: string,
  item: ArchiveItemReference,
  action: () => Promise<T>,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<T> {
  return serializeArchiveMutation(async () => {
    const before = JSON.stringify(await loadStore(dependencies));
    const result = await action();
    const after = JSON.stringify(await loadStore(dependencies));
    if (before !== after) {
      await pushHistory(
        { items: [item], kind: "bookmark", label },
        dependencies,
      );
    }
    return result;
  });
}

export async function runArchiveMutationWithoutHistory<T>(
  action: () => Promise<T>,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<T> {
  return serializeArchiveMutation(async () => {
    try {
      return await action();
    } finally {
      await saveHistory({ future: [], past: [], version: 1 }, dependencies);
    }
  });
}

export async function getArchiveHistoryStatus(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveHistoryStatus> {
  const history = await loadHistory(dependencies);
  return {
    ...(history.future.at(-1)?.label === undefined
      ? {}
      : { redoLabel: history.future.at(-1)!.label }),
    ...(history.past.at(-1)?.label === undefined
      ? {}
      : { undoLabel: history.past.at(-1)!.label }),
  };
}

export async function undoArchiveChange(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveHistoryStatus & { changed: boolean; label?: string }> {
  return serializeArchiveMutation(async () => {
    const history = await loadHistory(dependencies);
    const entry = history.past.pop();
    if (entry === undefined)
      return {
        ...(await getArchiveHistoryStatus(dependencies)),
        changed: false,
      };
    await applyHistoryEntry(entry, "undo", dependencies);
    history.future.push(entry);
    await saveHistory(history, dependencies);
    return {
      ...(await getArchiveHistoryStatus(dependencies)),
      changed: true,
      label: entry.label,
    };
  });
}

export async function redoArchiveChange(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveHistoryStatus & { changed: boolean; label?: string }> {
  return serializeArchiveMutation(async () => {
    const history = await loadHistory(dependencies);
    const entry = history.future.pop();
    if (entry === undefined)
      return {
        ...(await getArchiveHistoryStatus(dependencies)),
        changed: false,
      };
    await applyHistoryEntry(entry, "redo", dependencies);
    history.past.push(entry);
    await saveHistory(history, dependencies);
    return {
      ...(await getArchiveHistoryStatus(dependencies)),
      changed: true,
      label: entry.label,
    };
  });
}

function serializeArchiveMutation<T>(action: () => Promise<T>): Promise<T> {
  const result = archiveMutationQueue.then(action, action);
  archiveMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface ToggleBookmarkResult {
  bookmarked: boolean;
  changed: number;
}

export async function exportArchiveData(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveExportFile> {
  return createArchiveExport(await loadStore(dependencies));
}

export async function importArchiveData(
  value: unknown,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveImportResult> {
  const store = await loadStore(dependencies);
  const result = mergeArchiveExport(store, value, createArchiveId);
  if (result.changed) await saveStore(result.store, dependencies);
  return result.summary;
}

export interface ArchiveDependencies {
  bookmarks: {
    create(
      details: chrome.bookmarks.CreateDetails,
    ): Promise<chrome.bookmarks.BookmarkTreeNode>;
    get(
      idOrIds: string | string[],
    ): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
    getChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
    move(
      id: string,
      destination: chrome.bookmarks.MoveDestination,
    ): Promise<chrome.bookmarks.BookmarkTreeNode>;
    remove(id: string): Promise<void>;
    removeTree(id: string): Promise<void>;
    search(
      query: string | chrome.bookmarks.SearchQuery,
    ): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
    update(
      id: string,
      changes: chrome.bookmarks.UpdateChanges,
    ): Promise<chrome.bookmarks.BookmarkTreeNode>;
  };
  delay(milliseconds: number): Promise<void>;
  now(): Date;
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  tabGroups: {
    get(groupId: number): Promise<chrome.tabGroups.TabGroup>;
    update(
      groupId: number,
      update: chrome.tabGroups.UpdateProperties,
    ): Promise<chrome.tabGroups.TabGroup | undefined>;
  };
  tabs: {
    create(properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
    group(options: chrome.tabs.GroupOptions): Promise<number>;
    query(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
    remove(tabIds: number | number[]): Promise<void>;
    update(
      tabId: number,
      update: chrome.tabs.UpdateProperties,
    ): Promise<chrome.tabs.Tab | undefined>;
  };
  windows: {
    create(
      data: chrome.windows.CreateData,
    ): Promise<chrome.windows.Window | undefined>;
    get(windowId: number): Promise<chrome.windows.Window>;
    remove(windowId: number): Promise<void>;
  };
}

export async function hibernateTabs(
  tabs: chrome.tabs.Tab[],
  dependencies: ArchiveDependencies = getDefaultDependencies(),
  name?: string,
  entryType?: "group" | "tab" | "window",
): Promise<HibernateArchiveResult> {
  const eligibleTabs = tabs
    .map((tab) => {
      const url = tab.pendingUrl ?? tab.url;
      return url === undefined ? tab : { ...tab, url };
    })
    .filter(
      (tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
        tab.id !== undefined &&
        tab.url !== undefined &&
        tab.url.trim().length > 0,
    )
    .sort((left, right) => left.index - right.index);
  if (eligibleTabs.length === 0) {
    throw new Error("No safe website tabs are available to hibernate.");
  }
  const sourceWindowId = eligibleTabs[0]?.windowId;
  if (sourceWindowId === undefined) {
    throw new Error("The source window is unavailable.");
  }
  if (
    eligibleTabs.some(
      (tab) =>
        tab.windowId !== sourceWindowId ||
        tab.incognito !== eligibleTabs[0]!.incognito,
    )
  ) {
    throw new Error(
      "A hibernated window cannot mix tabs from regular and private windows.",
    );
  }

  const createdAt = dependencies.now().getTime();
  const store = await loadStore(dependencies);
  const entryId = createArchiveId("entry");
  const normalizedName = normalizeWindowName(name);
  const groups = await loadGroupMetadata(eligibleTabs, dependencies);
  const sourceGroupKeys = new Set(
    eligibleTabs.flatMap((tab) =>
      tab.groupId === NO_GROUP_ID ? [] : [String(tab.groupId)],
    ),
  );
  const requestedEntryType =
    entryType ??
    (eligibleTabs.length === 1 && normalizedName === undefined
      ? "tab"
      : "window");
  const resolvedEntryType =
    requestedEntryType === "tab" && sourceGroupKeys.size > 0
      ? sourceGroupKeys.size === 1 &&
        eligibleTabs.every((tab) => tab.groupId !== NO_GROUP_ID)
        ? "group"
        : "window"
      : requestedEntryType === "tab" && eligibleTabs.length > 1
        ? "window"
        : requestedEntryType;
  const resolvedName =
    normalizedName ??
    (resolvedEntryType === "group"
      ? Object.values(groups)[0]?.title
      : resolvedEntryType === "window"
        ? defaultWindowName(eligibleTabs[0]!)
        : undefined);
  const windowMetadata: ArchivedWindowMetadata = {
    createdAt,
    entryType: resolvedEntryType,
    groups,
    ...(eligibleTabs[0]!.incognito ? { incognito: true as const } : {}),
    ...(resolvedName === undefined ? {} : { name: resolvedName }),
    sourceWindowId,
    tabs: {},
  };

  for (const tab of eligibleTabs) {
    const tabId = createArchiveId("tab");
    windowMetadata.tabs[tabId] = {
      active: tab.active,
      bookmarkId: tabId,
      createdAt,
      ...(tab.groupId === NO_GROUP_ID ? {} : { groupKey: String(tab.groupId) }),
      ...(tab.incognito ? { incognito: true as const } : {}),
      index: tab.index,
      pinned: tab.pinned,
      title: tab.title || tab.url,
      url: tab.url,
    };
  }
  store.windows[entryId] = windowMetadata;
  await saveStore(store, dependencies);

  await dependencies.tabs.remove(eligibleTabs.map((tab) => tab.id));
  return {
    archived: eligibleTabs.length,
    bookmarkIds: Object.keys(windowMetadata.tabs),
    folderId: entryId,
    ...(windowMetadata.name === undefined ? {} : { name: windowMetadata.name }),
  };
}

export async function hibernateSession(
  sessionWindows: chrome.tabs.Tab[][],
  name: string | undefined,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<HibernateSessionResult> {
  const windows = sessionWindows
    .map((tabs) => normalizeEligibleTabs(tabs))
    .filter((tabs) => tabs.length > 0);
  const allTabs = windows.flat();
  if (allTabs.length === 0) {
    throw new Error("No safe website tabs are available to hibernate.");
  }
  const store = await loadStore(dependencies);
  const createdAt = dependencies.now().getTime();
  const sessionId = createArchiveId("session");
  const sessionName = normalizeWindowName(name);
  const sessionMetadata: ArchivedSessionMetadata = {
    createdAt,
    ...(sessionName === undefined ? {} : { name: sessionName }),
    windowIds: [],
  };
  try {
    for (const [windowIndex, tabs] of windows.entries()) {
      const entryId = createArchiveId("entry");
      const metadata: ArchivedWindowMetadata = {
        createdAt,
        entryType: "window",
        groups: await loadGroupMetadata(tabs, dependencies),
        ...(tabs[0]!.incognito ? { incognito: true as const } : {}),
        name: `Window ${windowIndex + 1}`,
        sessionId,
        sourceWindowId: tabs[0]!.windowId,
        tabs: {},
      };
      for (const tab of tabs) {
        const tabId = createArchiveId("tab");
        metadata.tabs[tabId] = {
          active: tab.active,
          bookmarkId: tabId,
          createdAt,
          ...(tab.groupId === NO_GROUP_ID
            ? {}
            : { groupKey: String(tab.groupId) }),
          ...(tab.incognito ? { incognito: true as const } : {}),
          index: tab.index,
          pinned: tab.pinned,
          title: tab.title || tab.url,
          url: tab.url,
        };
      }
      store.windows[entryId] = metadata;
      sessionMetadata.windowIds.push(entryId);
    }
    store.sessions[sessionId] = sessionMetadata;
    await saveStore(store, dependencies);
  } catch (error) {
    for (const windowId of sessionMetadata.windowIds)
      delete store.windows[windowId];
    delete store.sessions[sessionId];
    throw error;
  }
  await dependencies.tabs.remove(allTabs.map((tab) => tab.id));
  return {
    archived: allTabs.length,
    sessionId,
    windows: windows.length,
  };
}

export async function getArchiveSnapshot(
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ArchiveSnapshot> {
  const store = await loadStore(dependencies);
  await normalizeSavedFolderTitleSeparators(store, dependencies);
  let savedMetadataChanged = false;
  for (const metadata of Object.values(store.windows)) {
    if (await reconcileSavedWindowChildren(metadata, dependencies)) {
      savedMetadataChanged = true;
    }
  }
  if (savedMetadataChanged) await saveStore(store, dependencies);
  const entries = (
    await Promise.all(
      Object.entries(store.windows).map(
        async ([entryId, metadata]): Promise<ArchiveWindowView> => {
          const savedIds = [
            metadata.savedFolderId,
            ...Object.values(metadata.tabs).map((tab) => tab.savedBookmarkId),
          ].filter((id): id is string => id !== undefined);
          const confirmedSavedById = new Map(
            (await getExistingBookmarks(savedIds, dependencies)).map(
              (bookmark) => [bookmark.id, bookmark],
            ),
          );
          const tabs = Object.values(metadata.tabs)
            .sort((left, right) => left.index - right.index)
            .map((tabMetadata): ArchiveTabView => {
              const group =
                tabMetadata.groupKey === undefined
                  ? undefined
                  : metadata.groups[tabMetadata.groupKey];
              return {
                ...(tabMetadata.archivePinned
                  ? { archivePinned: true as const }
                  : {}),
                bookmarkId: tabMetadata.bookmarkId,
                ...(tabMetadata.savedBookmarkId !== undefined &&
                confirmedSavedById.get(tabMetadata.savedBookmarkId)?.url !==
                  undefined
                  ? { bookmarked: true as const }
                  : {}),
                createdAt: tabMetadata.createdAt,
                folderId: entryId,
                ...(tabMetadata.groupKey === undefined
                  ? {}
                  : { groupKey: tabMetadata.groupKey }),
                ...(group?.color === undefined
                  ? {}
                  : { groupColor: group.color }),
                ...(group?.title === undefined
                  ? {}
                  : { groupTitle: group.title }),
                ...(tabMetadata.incognito ? { incognito: true as const } : {}),
                pinned: tabMetadata.pinned,
                title: tabMetadata.title,
                url: tabMetadata.url,
              };
            });
          return {
            ...(metadata.archivePinned ||
            (archiveEntryType(metadata) === "group" &&
              Object.values(metadata.groups)[0]?.archivePinned)
              ? { archivePinned: true as const }
              : {}),
            ...(isSavedWindowComplete(metadata, confirmedSavedById)
              ? { bookmarked: true as const }
              : {}),
            createdAt: metadata.createdAt,
            entryType:
              archiveEntryType(metadata) === "group" ? "group" : "window",
            folderId: entryId,
            groups: Object.entries(metadata.groups).flatMap(
              ([key, group]): ArchiveGroupView[] => {
                const groupTabs = tabs.filter((tab) => tab.groupKey === key);
                return groupTabs.length === 0
                  ? []
                  : [
                      {
                        ...(group.archivePinned
                          ? { archivePinned: true as const }
                          : {}),
                        collapsed: group.collapsed,
                        color: group.color,
                        folderId: entryId,
                        key,
                        tabs: groupTabs,
                        ...(group.title === undefined
                          ? {}
                          : { title: group.title }),
                      },
                    ];
              },
            ),
            ...(metadata.incognito ? { incognito: true as const } : {}),
            ...(metadata.name === undefined ? {} : { name: metadata.name }),
            tabs,
            title: formatWindowFolderTitle(
              metadata.createdAt,
              tabs.length,
              metadata.name,
            ),
          };
        },
      ),
    )
  )
    .filter((window) => window.tabs.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt);
  const windows = entries.filter((entry) => {
    const metadata = store.windows[entry.folderId];
    return (
      archiveEntryType(metadata) !== "tab" && metadata?.sessionId === undefined
    );
  });
  const tabs = entries
    .filter((entry) => {
      const metadata = store.windows[entry.folderId];
      return (
        archiveEntryType(metadata) === "tab" &&
        metadata?.sessionId === undefined
      );
    })
    .flatMap((entry) => entry.tabs)
    .sort((left, right) => right.createdAt - left.createdAt);
  const entryById = new Map(entries.map((entry) => [entry.folderId, entry]));
  const sessions = Object.entries(store.sessions)
    .map(([sessionId, metadata]): ArchiveSessionView => {
      const sessionWindows = metadata.windowIds.flatMap((windowId) => {
        const window = entryById.get(windowId);
        return window === undefined ? [] : [window];
      });
      const bookmarkableWindows = sessionWindows.filter((window) =>
        window.tabs.some(isArchiveTabBookmarkable),
      );
      return {
        ...(metadata.archivePinned ? { archivePinned: true as const } : {}),
        ...(metadata.savedFolderId !== undefined &&
        bookmarkableWindows.length > 0 &&
        bookmarkableWindows.every((window) => window.bookmarked === true)
          ? { bookmarked: true as const }
          : {}),
        createdAt: metadata.createdAt,
        ...(metadata.name === undefined ? {} : { name: metadata.name }),
        sessionId,
        title: `${metadata.name ?? "Session"}${TITLE_SEPARATOR}${formatArchiveTimestamp(metadata.createdAt)}`,
        windows: sessionWindows,
      };
    })
    .filter((session) => session.windows.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt);
  return {
    ...((store.topLevelOrder?.length ?? 0) > 0
      ? { entryOrder: store.topLevelOrder }
      : {}),
    sessions,
    tabCount: entries.reduce((total, window) => total + window.tabs.length, 0),
    tabs,
    windows,
  };
}

export async function restoreArchiveTab(
  bookmarkId: string,
  targetWindowId: number | undefined,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<RestoreArchiveResult> {
  const store = await loadStore(dependencies);
  const found = findArchivedTab(store, bookmarkId);
  if (found === undefined)
    throw new Error("That archived tab no longer exists.");
  const { entryId, metadata, windowMetadata } = found;
  const incognito = metadata.incognito === true;
  const targetWindow =
    targetWindowId === undefined
      ? undefined
      : await dependencies.windows.get(targetWindowId).catch(() => undefined);
  const matchingTargetId =
    targetWindow?.incognito === incognito ? targetWindowId : undefined;
  const needsDedicatedWindow =
    (targetWindowId !== undefined && matchingTargetId === undefined) ||
    (incognito && targetWindowId === undefined);
  let createdWindowId: number | undefined;
  let createdTab: chrome.tabs.Tab;
  if (needsDedicatedWindow) {
    const createdWindow = await dependencies.windows.create({
      focused: true,
      incognito,
      url: metadata.url,
    });
    createdWindowId = createdWindow?.id;
    createdTab =
      createdWindow?.tabs?.[0] ??
      (createdWindowId === undefined
        ? ({} as chrome.tabs.Tab)
        : ((await dependencies.tabs.query({ windowId: createdWindowId }))[0] ??
          ({} as chrome.tabs.Tab)));
  } else {
    createdTab = await dependencies.tabs.create({
      active: true,
      index: metadata.index,
      pinned: metadata.pinned,
      url: metadata.url,
      ...(matchingTargetId === undefined ? {} : { windowId: matchingTargetId }),
    });
  }
  if (createdTab.id === undefined) {
    if (createdWindowId !== undefined) {
      await dependencies.windows.remove(createdWindowId).catch(() => undefined);
    }
    throw new Error("The browser did not create the restored tab.");
  }
  try {
    if (metadata.pinned) {
      await dependencies.tabs.update(createdTab.id, { pinned: true });
    }
    await restoreSingleGroup(
      createdTab.id,
      metadata,
      windowMetadata,
      dependencies,
    );

    delete windowMetadata.tabs[bookmarkId];
    if (Object.keys(windowMetadata.tabs).length === 0) {
      delete store.windows[entryId];
      removeWindowFromSession(store, entryId);
    }
    await saveStore(store, dependencies);
  } catch (error) {
    if (createdWindowId === undefined)
      await dependencies.tabs.remove(createdTab.id).catch(() => undefined);
    else
      await dependencies.windows.remove(createdWindowId).catch(() => undefined);
    throw error;
  }
  return { restored: 1 };
}

export async function restoreArchiveWindow(
  folderId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<RestoreArchiveResult> {
  const store = await loadStore(dependencies);
  const metadata = store.windows[folderId];
  if (metadata === undefined || Object.keys(metadata.tabs).length === 0) {
    throw new Error("That archived window has no tabs to restore.");
  }
  const entries = Object.values(metadata.tabs).sort(
    (left, right) => left.index - right.index,
  );
  const restoredWindow = await dependencies.windows.create({
    focused: true,
    incognito: metadata.incognito === true,
    url: entries.map((entry) => entry.url),
  });
  if (restoredWindow?.id === undefined) {
    throw new Error("The browser did not create the restored window.");
  }
  try {
    const restoredTabs = (
      restoredWindow.tabs ??
      (await dependencies.tabs.query({ windowId: restoredWindow.id }))
    )
      .filter(
        (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
      )
      .sort((left, right) => left.index - right.index);
    if (restoredTabs.length < entries.length) {
      throw new Error("The browser did not restore every archived tab.");
    }

    for (const [index, entry] of entries.entries()) {
      const restoredTab = restoredTabs[index];
      if (entry.pinned && restoredTab !== undefined) {
        await dependencies.tabs.update(restoredTab.id, { pinned: true });
      }
    }
    await restoreWindowGroups(
      restoredWindow.id,
      restoredTabs,
      entries,
      metadata,
      dependencies,
    );
    const activeIndex = entries.findIndex((entry) => entry.active);
    const activeTab = restoredTabs[activeIndex];
    if (activeTab !== undefined) {
      await dependencies.tabs.update(activeTab.id, {
        active: true,
      });
    }

    delete store.windows[folderId];
    removeWindowFromSession(store, folderId);
    await saveStore(store, dependencies);
  } catch (error) {
    await dependencies.windows.remove(restoredWindow.id).catch(() => undefined);
    throw error;
  }
  return { restored: entries.length };
}

export async function deleteArchiveTab(
  bookmarkId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const found = findArchivedTab(store, bookmarkId);
  if (found === undefined)
    throw new Error("That hibernated tab no longer exists.");
  delete found.windowMetadata.tabs[bookmarkId];
  if (Object.keys(found.windowMetadata.tabs).length === 0) {
    delete store.windows[found.entryId];
    removeWindowFromSession(store, found.entryId);
  }
  await saveStore(store, dependencies);
  return { deleted: 1 };
}

export async function deleteArchiveWindow(
  folderId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const metadata = store.windows[folderId];
  const deleted = Object.keys(metadata?.tabs ?? {}).length;
  if (deleted === 0) {
    throw new Error("That hibernated window no longer exists.");
  }
  delete store.windows[folderId];
  removeWindowFromSession(store, folderId);
  await saveStore(store, dependencies);
  return { deleted };
}

export async function restoreArchiveSession(
  sessionId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<RestoreArchiveResult> {
  const initial = await loadStore(dependencies);
  const session = initial.sessions[sessionId];
  if (session === undefined)
    throw new Error("That hibernated session no longer exists.");
  const windowIds = session.windowIds.filter(
    (windowId) => initial.windows[windowId] !== undefined,
  );
  if (windowIds.length === 0)
    throw new Error("That hibernated session has no windows to restore.");
  let restored = 0;
  for (const windowId of windowIds) {
    const result = await restoreArchiveWindow(windowId, dependencies);
    restored += result.restored;
  }
  const store = await loadStore(dependencies);
  delete store.sessions[sessionId];
  await saveStore(store, dependencies);
  return { restored };
}

export async function deleteArchiveSession(
  sessionId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<DeleteArchiveResult> {
  const store = await loadStore(dependencies);
  const session = store.sessions[sessionId];
  if (session === undefined)
    throw new Error("That hibernated session no longer exists.");
  const deleted = session.windowIds.reduce(
    (total, windowId) =>
      total + Object.keys(store.windows[windowId]?.tabs ?? {}).length,
    0,
  );
  for (const windowId of session.windowIds) delete store.windows[windowId];
  delete store.sessions[sessionId];
  await saveStore(store, dependencies);
  return { deleted };
}

export async function renameArchiveSession(
  sessionId: string,
  name: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
  mergeOnConflict = false,
): Promise<RenameArchiveResult> {
  const normalized = normalizeWindowName(name);
  if (normalized === undefined) throw new Error("Enter a session name.");
  const store = await loadStore(dependencies);
  const session = store.sessions[sessionId];
  if (session === undefined)
    throw new Error("That hibernated session no longer exists.");
  const conflict = Object.entries(store.sessions).find(
    ([candidateId, candidate]) =>
      candidateId !== sessionId && namesMatch(candidate.name, normalized),
  );
  if (conflict !== undefined) {
    const [targetId, target] = conflict;
    if (!mergeOnConflict) {
      return {
        conflict: { id: targetId, name: target.name ?? normalized },
        name: normalized,
        ok: false,
      };
    }
    for (const windowId of session.windowIds) {
      const window = store.windows[windowId];
      if (window === undefined) continue;
      window.sessionId = targetId;
      if (!target.windowIds.includes(windowId)) target.windowIds.push(windowId);
    }
    delete store.sessions[sessionId];
    await saveStore(store, dependencies);
    return { merged: true, name: normalized, ok: true };
  }
  const previousName = session.name;
  const savedFolder = await getExistingBookmark(
    session.savedFolderId,
    dependencies,
  );
  const renamedFolderTitle = savedFolder
    ? replaceSavedFolderLabel(
        savedFolder.title,
        previousName ?? "Session",
        normalized,
      )
    : undefined;
  if (savedFolder !== undefined && renamedFolderTitle !== undefined) {
    await dependencies.bookmarks.update(savedFolder.id, {
      title: renamedFolderTitle,
    });
  }
  session.name = normalized;
  try {
    await saveStore(store, dependencies);
  } catch (error) {
    if (previousName === undefined) delete session.name;
    else session.name = previousName;
    if (savedFolder !== undefined) {
      await dependencies.bookmarks
        .update(savedFolder.id, { title: savedFolder.title })
        .catch(() => undefined);
    }
    throw error;
  }
  return { name: normalized, ok: true };
}

export async function toggleArchiveSessionBookmark(
  sessionId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ToggleBookmarkResult> {
  const store = await loadStore(dependencies);
  const session = store.sessions[sessionId];
  if (session === undefined)
    throw new Error("That hibernated session no longer exists.");
  const windows = session.windowIds.flatMap((windowId) => {
    const window = store.windows[windowId];
    return window === undefined ? [] : [{ id: windowId, metadata: window }];
  });
  const bookmarkableWindows = windows
    .map(({ id, metadata }) => ({
      id,
      metadata,
      tabs: Object.values(metadata.tabs).filter(isArchiveTabBookmarkable),
    }))
    .filter(({ tabs }) => tabs.length > 0);
  if (bookmarkableWindows.length === 0) {
    throw new Error("This session has no website tabs to bookmark.");
  }
  const existingFolder = session.savedFolderId
    ? (await getExistingBookmarks([session.savedFolderId], dependencies))[0]
    : undefined;
  const savedNodes = new Map(
    (
      await getExistingBookmarks(
        bookmarkableWindows.flatMap(({ metadata }) => [
          ...(metadata.savedFolderId === undefined
            ? []
            : [metadata.savedFolderId]),
          ...Object.values(metadata.tabs).flatMap((tab) =>
            tab.savedBookmarkId === undefined ? [] : [tab.savedBookmarkId],
          ),
        ]),
        dependencies,
      )
    ).map((node) => [node.id, node]),
  );
  const complete =
    existingFolder !== undefined &&
    bookmarkableWindows.every(({ metadata, tabs }) => {
      if (metadata.savedFolderId === undefined) return false;
      const windowFolder = savedNodes.get(metadata.savedFolderId);
      return (
        windowFolder?.url === undefined &&
        windowFolder?.parentId === existingFolder.id &&
        tabs.every((tab) => {
          const bookmark =
            tab.savedBookmarkId === undefined
              ? undefined
              : savedNodes.get(tab.savedBookmarkId);
          return (
            bookmark?.url === tab.url &&
            bookmark.parentId === metadata.savedFolderId
          );
        })
      );
    });
  if (complete && session.savedFolderId !== undefined) {
    const changed = bookmarkableWindows.reduce(
      (total, { tabs }) => total + tabs.length,
      0,
    );
    await dependencies.bookmarks.removeTree(session.savedFolderId);
    await waitForBookmarksRemoved([session.savedFolderId], dependencies);
    delete session.savedFolderId;
    for (const { metadata } of bookmarkableWindows) {
      delete metadata.savedFolderId;
      for (const tab of Object.values(metadata.tabs))
        delete tab.savedBookmarkId;
    }
    await removeSavedRootIfEmpty(dependencies);
    await saveStore(store, dependencies);
    return { bookmarked: false, changed };
  }
  if (existingFolder !== undefined) {
    await dependencies.bookmarks.removeTree(existingFolder.id);
    await waitForBookmarksRemoved([existingFolder.id], dependencies);
  }
  const rootId = await ensureSavedBookmarksRoot(dependencies);
  const folder = await dependencies.bookmarks.create({
    parentId: rootId,
    title: `${session.name ?? "Session"}${TITLE_SEPARATOR}${formatArchiveTimestamp(session.createdAt)}`,
  });
  let changed = 0;
  try {
    for (const [index, { metadata, tabs }] of bookmarkableWindows.entries()) {
      const windowFolder = await dependencies.bookmarks.create({
        parentId: folder.id,
        title: metadata.name ?? `Window ${index + 1}`,
      });
      metadata.savedFolderId = windowFolder.id;
      for (const tab of tabs.sort((left, right) => left.index - right.index)) {
        const bookmark = await dependencies.bookmarks.create({
          parentId: windowFolder.id,
          title: tab.title,
          url: tab.url,
        });
        tab.savedBookmarkId = bookmark.id;
        changed += 1;
      }
    }
    session.savedFolderId = folder.id;
    await saveStore(store, dependencies);
  } catch (error) {
    await dependencies.bookmarks.removeTree(folder.id).catch(() => undefined);
    throw error;
  }
  return { bookmarked: true, changed };
}

export async function toggleArchiveTabBookmark(
  bookmarkId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ToggleBookmarkResult> {
  const store = await loadStore(dependencies);
  const found = findArchivedTab(store, bookmarkId);
  if (found === undefined) {
    throw new Error("That hibernated tab no longer exists.");
  }
  const { metadata, windowMetadata } = found;
  if (!isArchiveTabBookmarkable(metadata)) {
    throw new Error(
      "Private and internal browser pages cannot be browser-bookmarked.",
    );
  }
  if (metadata.savedBookmarkId !== undefined) {
    const [saved] = await getExistingBookmarks(
      [metadata.savedBookmarkId],
      dependencies,
    );
    if (saved !== undefined) {
      await dependencies.bookmarks.remove(saved.id);
      await waitForBookmarksRemoved([saved.id], dependencies);
      delete metadata.savedBookmarkId;
      const savedFolderId = windowMetadata?.savedFolderId;
      if (savedFolderId !== undefined && saved.parentId === savedFolderId) {
        const remaining = await dependencies.bookmarks
          .getChildren(savedFolderId)
          .catch(() => []);
        if (remaining.length === 0) {
          await dependencies.bookmarks
            .removeTree(savedFolderId)
            .catch(() => undefined);
          await waitForBookmarksRemoved([savedFolderId], dependencies);
          if (windowMetadata !== undefined) {
            delete windowMetadata.savedFolderId;
          }
        }
      }
      await removeSavedRootIfEmpty(dependencies);
      await saveStore(store, dependencies);
      return { bookmarked: false, changed: 1 };
    }
    delete metadata.savedBookmarkId;
  }
  const rootId = await ensureSavedBookmarksRoot(dependencies);
  const created = await dependencies.bookmarks.create({
    parentId: rootId,
    title: metadata.title,
    url: metadata.url,
  });
  try {
    metadata.savedBookmarkId = created.id;
    await saveStore(store, dependencies);
  } catch (error) {
    await dependencies.bookmarks.remove(created.id).catch(() => undefined);
    throw error;
  }
  return { bookmarked: true, changed: 1 };
}

export async function toggleArchiveWindowBookmark(
  folderId: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<ToggleBookmarkResult> {
  const store = await loadStore(dependencies);
  const metadata = store.windows[folderId];
  if (metadata === undefined) {
    throw new Error("That hibernated window no longer exists.");
  }
  await reconcileSavedWindowChildren(metadata, dependencies);
  if (metadata.savedFolderId !== undefined) {
    const savedFolderId = metadata.savedFolderId;
    const [savedFolder] = await getExistingBookmarks(
      [savedFolderId],
      dependencies,
    );
    const confirmedSavedById = new Map(
      (
        await getExistingBookmarks(
          Object.values(metadata.tabs)
            .map((tab) => tab.savedBookmarkId)
            .filter((id): id is string => id !== undefined),
          dependencies,
        )
      ).map((bookmark) => [bookmark.id, bookmark]),
    );
    if (
      savedFolder !== undefined &&
      isSavedWindowComplete(metadata, confirmedSavedById)
    ) {
      const savedChildren = await dependencies.bookmarks
        .getChildren(savedFolderId)
        .catch(() => []);
      const savedChildIds = new Set(savedChildren.map((child) => child.id));
      await dependencies.bookmarks.removeTree(savedFolderId);
      await waitForBookmarksRemoved([savedFolderId], dependencies);
      delete metadata.savedFolderId;
      for (const tab of Object.values(metadata.tabs)) {
        if (
          tab.savedBookmarkId !== undefined &&
          savedChildIds.has(tab.savedBookmarkId)
        ) {
          delete tab.savedBookmarkId;
        }
      }
      await removeSavedRootIfEmpty(dependencies);
      await saveStore(store, dependencies);
      return { bookmarked: false, changed: savedChildren.length };
    }
    if (savedFolder === undefined) {
      delete metadata.savedFolderId;
      await saveStore(store, dependencies);
    }
  }
  const snapshot = await getArchiveSnapshot(dependencies);
  const window = [
    ...snapshot.windows,
    ...snapshot.sessions.flatMap((session) => session.windows),
  ].find((candidate) => candidate.folderId === folderId);
  if (window === undefined || window.tabs.length === 0) {
    throw new Error("That hibernated window no longer exists.");
  }
  const bookmarkableTabs = window.tabs.filter(isArchiveTabBookmarkable);
  if (bookmarkableTabs.length === 0) {
    throw new Error("This window has no website tabs to bookmark.");
  }
  const session =
    metadata.sessionId === undefined
      ? undefined
      : store.sessions[metadata.sessionId];
  const [sessionFolder] = await getExistingBookmarks(
    session?.savedFolderId === undefined ? [] : [session.savedFolderId],
    dependencies,
  );
  const rootId =
    sessionFolder !== undefined && sessionFolder.url === undefined
      ? sessionFolder.id
      : await ensureSavedBookmarksRoot(dependencies);
  let folder: chrome.bookmarks.BookmarkTreeNode;
  const [existingFolder] = await getExistingBookmarks(
    metadata.savedFolderId === undefined ? [] : [metadata.savedFolderId],
    dependencies,
  );
  if (existingFolder !== undefined) {
    folder = existingFolder;
  } else {
    folder = await dependencies.bookmarks.create({
      parentId: rootId,
      title: `${window.name ?? "Saved window"}${TITLE_SEPARATOR}${formatArchiveTimestamp(dependencies.now().getTime())}`,
    });
  }
  try {
    for (const tab of bookmarkableTabs) {
      const tabMetadata = metadata.tabs[tab.bookmarkId];
      if (tabMetadata === undefined) continue;
      const [saved] = await getExistingBookmarks(
        tabMetadata.savedBookmarkId === undefined
          ? []
          : [tabMetadata.savedBookmarkId],
        dependencies,
      );
      if (saved !== undefined) {
        if (saved.parentId !== folder.id) {
          await dependencies.bookmarks.move(saved.id, { parentId: folder.id });
        }
        tabMetadata.savedBookmarkId = saved.id;
      } else {
        const created = await dependencies.bookmarks.create({
          parentId: folder.id,
          title: tab.title,
          url: tab.url,
        });
        tabMetadata.savedBookmarkId = created.id;
      }
    }
    metadata.savedFolderId = folder.id;
    await saveStore(store, dependencies);
  } catch (error) {
    if (existingFolder === undefined) {
      await dependencies.bookmarks.removeTree(folder.id).catch(() => undefined);
    }
    throw error;
  }
  return { bookmarked: true, changed: bookmarkableTabs.length };
}

function archiveEntryType(
  metadata: ArchivedWindowMetadata | undefined,
): "group" | "tab" | "window" {
  if (metadata?.entryType !== undefined) return metadata.entryType;
  if (
    metadata !== undefined &&
    metadata.name === undefined &&
    Object.keys(metadata.tabs).length === 1 &&
    Object.keys(metadata.groups).length === 0
  ) {
    return "tab";
  }
  return "window";
}

function isArchiveTabBookmarkable(
  tab: Pick<ArchivedTabMetadata, "incognito" | "url"> | ArchiveTabView,
): boolean {
  return tab.incognito !== true && isBookmarkableUrl(tab.url);
}

function isSavedWindowComplete(
  metadata: ArchivedWindowMetadata | undefined,
  confirmedSavedById: Map<string, chrome.bookmarks.BookmarkTreeNode>,
): boolean {
  if (metadata?.savedFolderId === undefined) return false;
  const tabs = Object.values(metadata.tabs).filter(isArchiveTabBookmarkable);
  return (
    tabs.length > 0 &&
    tabs.every((tab) => {
      if (tab.savedBookmarkId === undefined) return false;
      const saved = confirmedSavedById.get(tab.savedBookmarkId);
      return (
        saved?.url !== undefined && saved.parentId === metadata.savedFolderId
      );
    })
  );
}

async function reconcileSavedWindowChildren(
  metadata: ArchivedWindowMetadata,
  dependencies: ArchiveDependencies,
): Promise<boolean> {
  if (metadata.savedFolderId === undefined) return false;
  const [folder] = await getExistingBookmarks(
    [metadata.savedFolderId],
    dependencies,
  );
  if (folder?.url !== undefined || folder === undefined) return false;
  const children = await dependencies.bookmarks
    .getChildren(folder.id)
    .catch(() => []);
  const childrenById = new Map(children.map((child) => [child.id, child]));
  const usedIds = new Set<string>();
  let changed = false;
  for (const tab of Object.values(metadata.tabs)) {
    const current =
      tab.savedBookmarkId === undefined
        ? undefined
        : childrenById.get(tab.savedBookmarkId);
    if (current?.url !== undefined) {
      usedIds.add(current.id);
      continue;
    }
    const match = children.find(
      (child) => child.url === tab.url && !usedIds.has(child.id),
    );
    if (match === undefined) continue;
    tab.savedBookmarkId = match.id;
    usedIds.add(match.id);
    changed = true;
  }
  return changed;
}

async function ensureSavedBookmarksRoot(
  dependencies: ArchiveDependencies,
): Promise<string> {
  const existing = (await dependencies.bookmarks.search(SAVED_ROOT_TITLE)).find(
    (node) => node.url === undefined && node.title === SAVED_ROOT_TITLE,
  );
  if (existing !== undefined) return existing.id;
  return (await dependencies.bookmarks.create({ title: SAVED_ROOT_TITLE })).id;
}

async function normalizeSavedFolderTitleSeparators(
  store: ArchiveStore,
  dependencies: ArchiveDependencies,
): Promise<void> {
  const folderIds = new Set<string>();
  for (const session of Object.values(store.sessions)) {
    if (session.savedFolderId !== undefined)
      folderIds.add(session.savedFolderId);
  }
  for (const window of Object.values(store.windows)) {
    if (window.savedFolderId !== undefined) folderIds.add(window.savedFolderId);
  }
  const folders = await getExistingBookmarks([...folderIds], dependencies);
  await Promise.all(
    folders
      .filter((folder) => folder.url === undefined)
      .map(async (folder) => {
        const title = folder.title.replace(
          /\s*\u00c2?\u00b7\s*/gu,
          TITLE_SEPARATOR,
        );
        if (title !== folder.title) {
          await dependencies.bookmarks.update(folder.id, { title });
        }
      }),
  );
}

async function removeSavedRootIfEmpty(
  dependencies: ArchiveDependencies,
): Promise<void> {
  const roots = (await dependencies.bookmarks.search(SAVED_ROOT_TITLE)).filter(
    (node) => node.url === undefined && node.title === SAVED_ROOT_TITLE,
  );
  for (const root of roots) {
    const [existingRoot] = await getExistingBookmarks([root.id], dependencies);
    if (existingRoot === undefined) continue;
    const children = await dependencies.bookmarks
      .getChildren(root.id)
      .catch(() => []);
    if (children.length > 0) continue;
    await dependencies.bookmarks.removeTree(root.id);
    await waitForBookmarksRemoved([root.id], dependencies);
  }
}

export function formatArchiveTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatBookmarkTitle(timestamp: number, title: string): string {
  return `${formatArchiveTimestamp(timestamp)}${TITLE_SEPARATOR}${title}`;
}

export function formatWindowFolderTitle(
  timestamp: number,
  tabCount: number,
  name?: string,
): string {
  const label = normalizeWindowName(name) ?? "Window";
  return `${label}${TITLE_SEPARATOR}${formatArchiveTimestamp(timestamp)}${TITLE_SEPARATOR}${tabCount} tab${tabCount === 1 ? "" : "s"}`;
}

export async function renameArchiveWindow(
  folderId: string,
  name: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
  mergeOnConflict = false,
): Promise<RenameArchiveResult> {
  const normalized = normalizeWindowName(name);
  if (normalized === undefined)
    throw new Error("Enter a window or group name.");
  const store = await loadStore(dependencies);
  const metadata = store.windows[folderId];
  if (metadata === undefined)
    throw new Error("That archived window no longer exists.");
  const conflict = Object.entries(store.windows).find(
    ([candidateId, candidate]) =>
      candidateId !== folderId &&
      archiveEntryType(candidate) === "window" &&
      candidate.sessionId === metadata.sessionId &&
      namesMatch(candidate.name, normalized),
  );
  if (conflict !== undefined) {
    const [targetId, target] = conflict;
    if (!mergeOnConflict) {
      return {
        conflict: { id: targetId, name: target.name ?? normalized },
        name: normalized,
        ok: false,
      };
    }
    const records = Object.values(metadata.tabs).map((tab) => ({
      tab,
      window: metadata,
      windowId: folderId,
    }));
    appendTabRecords(target, records);
    delete store.windows[folderId];
    removeWindowFromSession(store, folderId);
    await saveStore(store, dependencies);
    return { merged: true, name: normalized, ok: true };
  }
  const previousName = metadata.name;
  const groupEntry =
    metadata.entryType === "group"
      ? Object.values(metadata.groups)[0]
      : undefined;
  const previousGroupTitle = groupEntry?.title;
  const savedFolder = await getExistingBookmark(
    metadata.savedFolderId,
    dependencies,
  );
  const renamedFolderTitle = savedFolder
    ? replaceSavedFolderLabel(
        savedFolder.title,
        previousName ?? "Saved window",
        normalized,
      )
    : undefined;
  if (savedFolder !== undefined && renamedFolderTitle !== undefined) {
    await dependencies.bookmarks.update(savedFolder.id, {
      title: renamedFolderTitle,
    });
  }
  metadata.name = normalized;
  if (groupEntry !== undefined) groupEntry.title = normalized;
  try {
    await saveStore(store, dependencies);
  } catch (error) {
    if (previousName === undefined) delete metadata.name;
    else metadata.name = previousName;
    if (groupEntry !== undefined) {
      if (previousGroupTitle === undefined) delete groupEntry.title;
      else groupEntry.title = previousGroupTitle;
    }
    if (savedFolder !== undefined) {
      await dependencies.bookmarks
        .update(savedFolder.id, { title: savedFolder.title })
        .catch(() => undefined);
    }
    throw error;
  }
  return { name: normalized, ok: true };
}

export async function renameArchiveTab(
  bookmarkId: string,
  name: string,
  dependencies: ArchiveDependencies = getDefaultDependencies(),
): Promise<{ name: string; ok: true }> {
  const normalized = normalizeWindowName(name);
  if (normalized === undefined) throw new Error("Enter a tab name.");
  const store = await loadStore(dependencies);
  const found = findArchivedTab(store, bookmarkId);
  if (found === undefined)
    throw new Error("That hibernated tab no longer exists.");
  const previousTitle = found.metadata.title;
  const savedBookmark = await getExistingBookmark(
    found.metadata.savedBookmarkId,
    dependencies,
  );
  if (savedBookmark !== undefined) {
    await dependencies.bookmarks.update(savedBookmark.id, {
      title: normalized,
    });
  }
  found.metadata.title = normalized;
  try {
    await saveStore(store, dependencies);
  } catch (error) {
    found.metadata.title = previousTitle;
    if (savedBookmark !== undefined) {
      await dependencies.bookmarks
        .update(savedBookmark.id, { title: savedBookmark.title })
        .catch(() => undefined);
    }
    throw error;
  }
  return { name: normalized, ok: true };
}

async function getExistingBookmark(
  bookmarkId: string | undefined,
  dependencies: ArchiveDependencies,
): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  if (bookmarkId === undefined) return undefined;
  return (await getExistingBookmarks([bookmarkId], dependencies))[0];
}

function replaceSavedFolderLabel(
  title: string,
  previousLabel: string,
  nextLabel: string,
): string {
  const prefix = `${previousLabel}${TITLE_SEPARATOR}`;
  return title.startsWith(prefix)
    ? `${nextLabel}${title.slice(previousLabel.length)}`
    : nextLabel;
}

function normalizeWindowName(name: string | undefined): string | undefined {
  const normalized = name?.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, 80);
}

function defaultWindowName(tab: chrome.tabs.Tab & { url: string }): string {
  const title = tab.title?.trim();
  let label = title && title !== tab.url ? title : "";
  if (!label) {
    try {
      label = new URL(tab.url).hostname.replace(/^www\./u, "");
    } catch {
      label = tab.url;
    }
  }
  return normalizeWindowName(`Window ${label}`) ?? "Window";
}

function createArchiveId(
  prefix: "entry" | "group" | "session" | "tab",
): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function planArchiveSelectionRestore(
  snapshot: ArchiveSnapshot,
  selection: ArchiveSelection,
): ArchiveSelectionRestorePlan {
  const selectedSessionIds = new Set(selection.sessionIds);
  const selectedSessions = snapshot.sessions.filter((session) =>
    selectedSessionIds.has(session.sessionId),
  );
  const sessionIds = selectedSessions.map((session) => session.sessionId);
  const coveredWindowIds = new Set(
    selectedSessions.flatMap((session) =>
      session.windows.map((window) => window.folderId),
    ),
  );
  const allWindows = [
    ...snapshot.sessions.flatMap((session) => session.windows),
    ...snapshot.windows,
  ];
  const selectedWindowIds = new Set(selection.windowIds);
  const windowIds = allWindows
    .filter(
      (window) =>
        selectedWindowIds.has(window.folderId) &&
        !coveredWindowIds.has(window.folderId),
    )
    .map((window) => window.folderId);
  windowIds.forEach((windowId) => coveredWindowIds.add(windowId));

  const selectedGroupIds = new Set(selection.groupIds ?? []);
  const groups = allWindows.flatMap((window) =>
    coveredWindowIds.has(window.folderId)
      ? []
      : (window.groups ?? []).flatMap((group) =>
          selectedGroupIds.has(`${window.folderId}\u0000${group.key}`)
            ? [{ folderId: window.folderId, groupKey: group.key }]
            : [],
        ),
  );
  const coveredGroupIds = new Set(
    groups.map(({ folderId, groupKey }) => `${folderId}\u0000${groupKey}`),
  );
  const selectedTabIds = new Set(selection.tabIds);
  const selectableTabs: Array<{ tab: ArchiveTabView; windowId?: string }> = [
    ...snapshot.tabs.map((tab) => ({ tab })),
    ...allWindows.flatMap((window) =>
      window.tabs.map((tab) => ({ tab, windowId: window.folderId })),
    ),
  ];
  const tabIds = selectableTabs.flatMap(({ tab, windowId }) => {
    if (!selectedTabIds.has(tab.bookmarkId)) return [];
    if (windowId !== undefined && coveredWindowIds.has(windowId)) return [];
    if (
      windowId !== undefined &&
      tab.groupKey !== undefined &&
      coveredGroupIds.has(`${windowId}\u0000${tab.groupKey}`)
    )
      return [];
    return [tab.bookmarkId];
  });
  return { groups, sessionIds, tabIds, windowIds };
}

function expandArchiveSelection(
  store: ArchiveStore,
  selection: ArchiveSelection,
): ExpandedArchiveSelection {
  const sessionIds = new Set<string>();
  const wholeWindowIds = new Set<string>();
  const tabIds = new Set<string>();
  for (const sessionId of selection.sessionIds) {
    const session = store.sessions[sessionId];
    if (session === undefined) continue;
    sessionIds.add(sessionId);
    session.windowIds.forEach((windowId) => wholeWindowIds.add(windowId));
  }
  for (const windowId of selection.windowIds) {
    if (store.windows[windowId] !== undefined) wholeWindowIds.add(windowId);
  }
  for (const groupId of selection.groupIds ?? []) {
    const [windowId = "", groupKey] = groupId.split("\u0000", 2);
    const window = store.windows[windowId];
    if (window === undefined || groupKey === undefined) continue;
    Object.values(window.tabs)
      .filter((tab) => tab.groupKey === groupKey)
      .forEach((tab) => tabIds.add(tab.bookmarkId));
  }
  for (const tabId of selection.tabIds) {
    if (findArchivedTab(store, tabId) !== undefined) tabIds.add(tabId);
  }
  for (const windowId of wholeWindowIds) {
    const window = store.windows[windowId];
    if (window === undefined) continue;
    Object.keys(window.tabs).forEach((tabId) => tabIds.add(tabId));
  }
  return { sessionIds, tabIds, wholeWindowIds };
}

function selectedTabRecords(
  store: ArchiveStore,
  tabIds: ReadonlySet<string>,
): SelectedTabRecord[] {
  return Object.entries(store.windows)
    .flatMap(([windowId, window]) =>
      Object.values(window.tabs).flatMap((tab) =>
        tabIds.has(tab.bookmarkId) ? [{ tab, window, windowId }] : [],
      ),
    )
    .sort(
      (left, right) =>
        left.window.createdAt - right.window.createdAt ||
        left.tab.index - right.tab.index,
    );
}

function createEmptyWindowMetadata(
  name: string,
  sourceWindowId: number,
  createdAt: number,
  sessionId?: string,
  incognito = false,
): ArchivedWindowMetadata {
  return {
    createdAt,
    entryType: "window",
    groups: {},
    ...(incognito ? { incognito: true as const } : {}),
    name,
    ...(sessionId === undefined ? {} : { sessionId }),
    sourceWindowId,
    tabs: {},
  };
}

function appendTabRecords(
  target: ArchivedWindowMetadata,
  records: SelectedTabRecord[],
): void {
  if (
    records.some(
      (record) =>
        (record.tab.incognito === true) !== (target.incognito === true),
    )
  ) {
    throw new Error(
      "Private and regular tabs cannot be combined in the same archived window.",
    );
  }
  const groupKeyBySource = new Map<string, string>();
  let nextIndex = Object.keys(target.tabs).length;
  for (const record of records) {
    let groupKey: string | undefined;
    if (record.tab.groupKey !== undefined) {
      const sourceKey = `${record.windowId}:${record.tab.groupKey}`;
      groupKey = groupKeyBySource.get(sourceKey);
      if (groupKey === undefined) {
        groupKey = uniqueGroupKey(target, sourceKey);
        groupKeyBySource.set(sourceKey, groupKey);
        const group = record.window.groups[record.tab.groupKey];
        if (group !== undefined) target.groups[groupKey] = { ...group };
      }
    }
    const movedTab: ArchivedTabMetadata = {
      ...record.tab,
      index: nextIndex,
    };
    if (groupKey === undefined) delete movedTab.groupKey;
    else movedTab.groupKey = groupKey;
    target.tabs[record.tab.bookmarkId] = movedTab;
    nextIndex += 1;
  }
  normalizeWindowTabs(target);
}

function uniqueGroupKey(
  target: ArchivedWindowMetadata,
  preferred: string,
): string {
  let candidate = preferred;
  let suffix = 2;
  while (target.groups[candidate] !== undefined) {
    candidate = `${preferred}:${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function removeTabRecords(
  store: ArchiveStore,
  records: SelectedTabRecord[],
): void {
  const affectedWindowIds = new Set<string>();
  for (const record of records) {
    delete record.window.tabs[record.tab.bookmarkId];
    affectedWindowIds.add(record.windowId);
  }
  for (const windowId of affectedWindowIds) {
    const window = store.windows[windowId];
    if (window === undefined) continue;
    if (Object.keys(window.tabs).length === 0) {
      delete store.windows[windowId];
      removeWindowFromSession(store, windowId);
      continue;
    }
    normalizeWindowTabs(window);
  }
}

function normalizeWindowTabs(window: ArchivedWindowMetadata): void {
  const tabs = Object.values(window.tabs).sort(
    (left, right) => left.index - right.index,
  );
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.active),
  );
  tabs.forEach((tab, index) => {
    tab.index = index;
    tab.active = index === activeIndex;
  });
  const usedGroups = new Set(
    tabs.flatMap((tab) => (tab.groupKey === undefined ? [] : [tab.groupKey])),
  );
  for (const groupKey of Object.keys(window.groups)) {
    if (!usedGroups.has(groupKey)) delete window.groups[groupKey];
  }
}

function moveItemInside(
  store: ArchiveStore,
  source: ArchiveItemReference,
  target: ArchiveItemReference | undefined,
  now: number,
): void {
  if (target === undefined) {
    detachItemToRoot(store, source);
    return;
  }
  if (target.type === "tab" && source.type !== "tab") {
    moveTabIntoContainer(store, target.id, source, now);
    return;
  }
  if (source.type === "session" && target.type === "window") {
    moveWindowInside(store, target.id, source);
    return;
  }
  if (source.type === "session" && target.type === "group") {
    moveGroupInside(store, target, source, now);
    return;
  }
  if (source.type === "window" && target.type === "group") {
    moveGroupInside(store, target, source, now);
    return;
  }
  if (source.type === "group") {
    moveGroupInside(store, source, target, now);
    return;
  }
  if (source.type === "tab") {
    moveTabInside(store, source.id, target, now);
    return;
  }
  if (source.type === "window") {
    moveWindowInside(store, source.id, target);
    return;
  }
  if (target.type !== "session") {
    throw new Error("A session can only be merged into another session.");
  }
  const sourceSession = store.sessions[source.id];
  const targetSession = store.sessions[target.id];
  if (sourceSession === undefined || targetSession === undefined)
    throw new Error("That session no longer exists.");
  for (const windowId of sourceSession.windowIds) {
    const window = store.windows[windowId];
    if (window === undefined) continue;
    window.sessionId = target.id;
    if (!targetSession.windowIds.includes(windowId))
      targetSession.windowIds.push(windowId);
  }
  delete store.sessions[source.id];
}

function moveTabInside(
  store: ArchiveStore,
  tabId: string,
  target: ArchiveItemReference,
  now: number,
): void {
  const record = selectedTabRecords(store, new Set([tabId]))[0];
  if (record === undefined) throw new Error("That tab no longer exists.");
  if (target.type === "session") {
    const session = store.sessions[target.id];
    if (session === undefined)
      throw new Error("That session no longer exists.");
    const windowId = createArchiveId("entry");
    const window = createEmptyWindowMetadata(
      uniqueWindowNameInSession(
        store,
        session,
        `Window ${session.windowIds.length + 1}`,
      ),
      record.window.sourceWindowId,
      now,
      target.id,
      record.tab.incognito === true,
    );
    store.windows[windowId] = window;
    session.windowIds.push(windowId);
    removeTabRecords(store, [record]);
    appendTabRecords(window, [record]);
    return;
  }
  if (target.type === "group") {
    moveTabToGroup(store, tabId, target.id, target.groupKey!);
    return;
  }
  const targetWindowId =
    target.type === "window"
      ? target.id
      : findArchivedTab(store, target.id)?.entryId;
  const targetWindow =
    targetWindowId === undefined ? undefined : store.windows[targetWindowId];
  if (targetWindow === undefined)
    throw new Error("That drop target no longer exists.");
  if (targetWindowId === record.windowId) {
    if (target.type === "window" && record.tab.groupKey !== undefined) {
      delete record.tab.groupKey;
      normalizeWindowTabs(targetWindow);
    }
    return;
  }
  if (target.type === "tab" && archiveEntryType(targetWindow) === "tab") {
    targetWindow.entryType = "window";
    targetWindow.name = "Window";
  }
  removeTabRecords(store, [record]);
  appendTabRecords(targetWindow, [record]);
}

function moveTabIntoContainer(
  store: ArchiveStore,
  tabId: string,
  container: ArchiveItemReference,
  now: number,
): void {
  if (container.type === "session") {
    const found = findArchivedTab(store, tabId);
    if (
      found !== undefined &&
      archiveEntryType(found.windowMetadata) === "window"
    ) {
      moveWindowInside(store, found.entryId, container);
    } else {
      moveTabInside(store, tabId, container, now);
    }
    return;
  }
  if (container.type === "group") {
    moveTabToGroup(store, tabId, container.id, container.groupKey!);
    return;
  }
  const window = store.windows[container.id];
  if (window === undefined)
    throw new Error("That hibernated container no longer exists.");
  if (archiveEntryType(window) === "group") {
    const groupKey = Object.keys(window.groups)[0];
    if (groupKey === undefined)
      throw new Error("That hibernated group no longer exists.");
    moveTabToGroup(store, tabId, container.id, groupKey);
    return;
  }
  moveTabInside(store, tabId, container, now);
}

function moveTabToGroup(
  store: ArchiveStore,
  tabId: string,
  windowId: string,
  groupKey: string,
): void {
  const record = selectedTabRecords(store, new Set([tabId]))[0];
  const target = store.windows[windowId];
  if (record === undefined || target?.groups[groupKey] === undefined)
    throw new Error("That hibernated tab or group no longer exists.");
  if (record.windowId === windowId && record.tab.groupKey === groupKey) return;
  assertCompatibleWindow(target, record.tab);
  const moved = structuredClone(record.tab);
  removeTabRecords(store, [record]);
  moved.groupKey = groupKey;
  moved.index = Object.keys(target.tabs).length;
  moved.active = false;
  target.tabs[moved.bookmarkId] = moved;
  normalizeWindowTabs(target);
}

function moveGroupInside(
  store: ArchiveStore,
  source: ArchiveItemReference,
  target: ArchiveItemReference,
  now: number,
): void {
  if (target.type === "window" && target.id === source.id) return;
  if (target.type === "group") {
    const records = groupTabRecords(store, source);
    records.forEach((record) =>
      moveTabToGroup(store, record.tab.bookmarkId, target.id, target.groupKey!),
    );
    return;
  }
  if (target.type === "tab") {
    moveTabToGroup(store, target.id, source.id, source.groupKey!);
    return;
  }
  const records = groupTabRecords(store, source);
  const sourceGroup = structuredClone(
    store.windows[source.id]!.groups[source.groupKey!]!,
  );
  let targetWindowId: string;
  if (target.type === "session") {
    const session = store.sessions[target.id];
    if (session === undefined)
      throw new Error("That hibernated session no longer exists.");
    targetWindowId = createArchiveId("entry");
    store.windows[targetWindowId] = createEmptyWindowMetadata(
      uniqueWindowNameInSession(
        store,
        session,
        sourceGroup.title ?? `Window ${session.windowIds.length + 1}`,
      ),
      records[0]!.window.sourceWindowId,
      now,
      target.id,
      records[0]!.tab.incognito === true,
    );
    session.windowIds.push(targetWindowId);
  } else {
    targetWindowId = target.id;
  }
  moveGroupRecordsToWindow(
    store,
    records,
    source.groupKey!,
    sourceGroup,
    targetWindowId,
  );
}

function moveGroupRecordsToWindow(
  store: ArchiveStore,
  records: SelectedTabRecord[],
  preferredKey: string,
  group: ArchivedGroupMetadata,
  targetWindowId: string,
): void {
  const target = store.windows[targetWindowId];
  if (target === undefined)
    throw new Error("That hibernated window no longer exists.");
  records.forEach((record) => assertCompatibleWindow(target, record.tab));
  const groupKey = uniqueGroupKey(target, preferredKey);
  const moved = records.map((record) => structuredClone(record.tab));
  removeTabRecords(store, records);
  target.groups[groupKey] = group;
  let index = Object.keys(target.tabs).length;
  for (const tab of moved) {
    tab.active = false;
    tab.groupKey = groupKey;
    tab.index = index++;
    target.tabs[tab.bookmarkId] = tab;
  }
  normalizeWindowTabs(target);
}

function groupTabRecords(
  store: ArchiveStore,
  group: ArchiveItemReference,
): SelectedTabRecord[] {
  const window = store.windows[group.id];
  if (window?.groups[group.groupKey!] === undefined)
    throw new Error("That hibernated group no longer exists.");
  return selectedTabRecords(
    store,
    new Set(
      Object.values(window.tabs)
        .filter((tab) => tab.groupKey === group.groupKey)
        .map((tab) => tab.bookmarkId),
    ),
  );
}

function assertCompatibleWindow(
  window: ArchivedWindowMetadata,
  tab: ArchivedTabMetadata,
): void {
  if ((tab.incognito === true) !== (window.incognito === true))
    throw new Error(
      "Private and regular tabs cannot be combined in the same archived window.",
    );
}

function moveWindowInside(
  store: ArchiveStore,
  windowId: string,
  target: ArchiveItemReference,
): void {
  const source = store.windows[windowId];
  if (source === undefined || archiveEntryType(source) !== "window")
    throw new Error("That window no longer exists.");
  if (target.type === "session") {
    const session = store.sessions[target.id];
    if (session === undefined)
      throw new Error("That session no longer exists.");
    if (source.sessionId === target.id) return;
    removeWindowFromSession(store, windowId);
    source.sessionId = target.id;
    source.name = uniqueWindowNameInSession(
      store,
      session,
      source.name ?? `Window ${session.windowIds.length + 1}`,
    );
    session.windowIds.push(windowId);
    return;
  }
  const targetWindowId =
    target.type === "window"
      ? target.id
      : findArchivedTab(store, target.id)?.entryId;
  const destination =
    targetWindowId === undefined ? undefined : store.windows[targetWindowId];
  if (
    destination === undefined ||
    targetWindowId === windowId ||
    archiveEntryType(destination) !== "window"
  ) {
    throw new Error("Drop this window on a different window or session.");
  }
  const records = selectedTabRecords(store, new Set(Object.keys(source.tabs)));
  delete store.windows[windowId];
  removeWindowFromSession(store, windowId);
  appendTabRecords(destination, records);
}

function detachItemToRoot(
  store: ArchiveStore,
  source: ArchiveItemReference,
): void {
  if (source.type === "group") {
    detachGroupToRoot(store, source);
    return;
  }
  if (source.type === "tab") {
    const record = selectedTabRecords(store, new Set([source.id]))[0];
    if (record === undefined) throw new Error("That tab no longer exists.");
    if (
      archiveEntryType(record.window) === "tab" &&
      record.window.sessionId === undefined
    )
      return;
    const entryId = createArchiveId("entry");
    const window: ArchivedWindowMetadata = {
      createdAt: record.tab.createdAt,
      entryType: "tab",
      groups: {},
      ...(record.tab.incognito ? { incognito: true as const } : {}),
      sourceWindowId: record.window.sourceWindowId,
      tabs: {},
    };
    removeTabRecords(store, [record]);
    appendTabRecords(window, [record]);
    store.windows[entryId] = window;
    return;
  }
  if (source.type === "window") {
    const window = store.windows[source.id];
    if (window === undefined) throw new Error("That window no longer exists.");
    removeWindowFromSession(store, source.id);
    delete window.sessionId;
    window.entryType = "window";
  }
}

function detachGroupToRoot(
  store: ArchiveStore,
  source: ArchiveItemReference,
): void {
  const sourceWindow = store.windows[source.id];
  const group = sourceWindow?.groups[source.groupKey!];
  if (sourceWindow === undefined || group === undefined)
    throw new Error("That hibernated group no longer exists.");
  const records = groupTabRecords(store, source);
  const movedTabs = records.map((record) => structuredClone(record.tab));
  removeTabRecords(store, records);
  const entryId = createArchiveId("entry");
  const groupKey = source.groupKey!;
  const window: ArchivedWindowMetadata = {
    createdAt: movedTabs[0]?.createdAt ?? Date.now(),
    entryType: "group",
    groups: { [groupKey]: structuredClone(group) },
    ...(movedTabs[0]?.incognito ? { incognito: true as const } : {}),
    name: group.title ?? "Group",
    sourceWindowId: sourceWindow.sourceWindowId,
    tabs: {},
  };
  movedTabs.forEach((tab, index) => {
    tab.active = index === 0;
    tab.groupKey = groupKey;
    tab.index = index;
    window.tabs[tab.bookmarkId] = tab;
  });
  store.windows[entryId] = window;
  normalizeTopLevelOrder(store);
}

function moveItemBeside(
  store: ArchiveStore,
  source: ArchiveItemReference,
  target: ArchiveItemReference | undefined,
  placement: "after" | "before",
): void {
  if (target === undefined) {
    detachItemToRoot(store, source);
    return;
  }
  if (source.type === "group" && target.type === "group") {
    if (source.id !== target.id)
      throw new Error("Before and after drops must target a sibling group.");
    const window = store.windows[source.id];
    if (window === undefined)
      throw new Error("That hibernated group no longer exists.");
    reorderGroup(window, source.groupKey!, target.groupKey!, placement);
    return;
  }
  if (source.type === "tab" && target.type === "tab") {
    const sourceRecord = selectedTabRecords(store, new Set([source.id]))[0];
    const targetRecord = selectedTabRecords(store, new Set([target.id]))[0];
    if (sourceRecord === undefined || targetRecord === undefined)
      throw new Error("That tab no longer exists.");
    if (isTopLevelItem(store, source) && isTopLevelItem(store, target)) {
      normalizeTopLevelOrder(store);
      insertBeside(
        store.topLevelOrder!,
        `tab:${source.id}`,
        `tab:${target.id}`,
        placement,
      );
      return;
    }
    if (sourceRecord.windowId !== targetRecord.windowId)
      throw new Error("Before and after drops must target a sibling tab.");
    reorderTab(targetRecord.window, source.id, target.id, placement);
    return;
  }
  if (source.type === "window" && target.type === "window") {
    const sourceWindow = store.windows[source.id];
    const targetWindow = store.windows[target.id];
    if (sourceWindow === undefined || targetWindow === undefined)
      throw new Error("That window no longer exists.");
    if (sourceWindow.sessionId !== targetWindow.sessionId)
      throw new Error("Before and after drops must target a sibling window.");
    if (targetWindow.sessionId !== undefined) {
      const session = store.sessions[targetWindow.sessionId];
      if (session === undefined)
        throw new Error("That session no longer exists.");
      insertBeside(session.windowIds, source.id, target.id, placement);
      return;
    }
  } else if (source.type !== target.type) {
    if (!isTopLevelItem(store, source) || !isTopLevelItem(store, target)) {
      throw new Error("Before and after drops must target a sibling entry.");
    }
  }
  const sourceKey = topLevelKey(store, source);
  const targetKey = topLevelKey(store, target);
  if (sourceKey === undefined || targetKey === undefined)
    throw new Error("Before and after drops must target top-level entries.");
  normalizeTopLevelOrder(store);
  insertBeside(store.topLevelOrder!, sourceKey, targetKey, placement);
}

function reorderTab(
  window: ArchivedWindowMetadata,
  sourceId: string,
  targetId: string,
  placement: "after" | "before",
): void {
  const ids = Object.values(window.tabs)
    .sort((left, right) => left.index - right.index)
    .map((tab) => tab.bookmarkId);
  insertBeside(ids, sourceId, targetId, placement);
  ids.forEach((id, index) => {
    const tab = window.tabs[id];
    if (tab !== undefined) tab.index = index;
  });
}

function reorderGroup(
  window: ArchivedWindowMetadata,
  sourceKey: string,
  targetKey: string,
  placement: "after" | "before",
): void {
  if (sourceKey === targetKey) return;
  if (
    window.groups[sourceKey] === undefined ||
    window.groups[targetKey] === undefined
  )
    throw new Error("That hibernated group no longer exists.");
  const keys = Object.keys(window.groups);
  insertBeside(keys, sourceKey, targetKey, placement);
  window.groups = Object.fromEntries(
    keys.map((key) => [key, window.groups[key]!]),
  );
}

function insertBeside(
  values: string[],
  source: string,
  target: string,
  placement: "after" | "before",
): void {
  const withoutSource = values.filter((value) => value !== source);
  const targetIndex = withoutSource.indexOf(target);
  if (targetIndex < 0) throw new Error("That drop target no longer exists.");
  withoutSource.splice(
    targetIndex + (placement === "after" ? 1 : 0),
    0,
    source,
  );
  values.splice(0, values.length, ...withoutSource);
}

function insertTopLevelCopy(
  store: ArchiveStore,
  sourceKey: string,
  copyKey: string,
): void {
  normalizeTopLevelOrder(store);
  const sourceIndex = store.topLevelOrder!.indexOf(sourceKey);
  if (sourceIndex < 0) store.topLevelOrder!.push(copyKey);
  else store.topLevelOrder!.splice(sourceIndex + 1, 0, copyKey);
}

function copyName(value: string): string {
  return `${value} (Copy)`.slice(0, 80);
}

function cloneArchiveWindow(
  source: ArchivedWindowMetadata,
  sessionId: string | undefined = source.sessionId,
): ArchivedWindowMetadata {
  const groups = Object.fromEntries(
    Object.entries(source.groups).map(([key, group]) => [
      key,
      {
        ...structuredClone(group),
        ...(group.title === undefined ? {} : { title: copyName(group.title) }),
      },
    ]),
  );
  const tabs: Record<string, ArchivedTabMetadata> = {};
  for (const sourceTab of Object.values(source.tabs).sort(
    (left, right) => left.index - right.index,
  )) {
    const bookmarkId = createArchiveId("tab");
    tabs[bookmarkId] = {
      ...structuredClone(sourceTab),
      active: false,
      bookmarkId,
      title: copyName(sourceTab.title),
    };
    delete tabs[bookmarkId]!.savedBookmarkId;
  }
  const clone: ArchivedWindowMetadata = {
    ...structuredClone(source),
    groups,
    ...(source.name === undefined ? {} : { name: copyName(source.name) }),
    tabs,
  };
  delete clone.savedFolderId;
  if (sessionId === undefined) delete clone.sessionId;
  else clone.sessionId = sessionId;
  normalizeWindowTabs(clone);
  return clone;
}

function insertTabCopies(
  window: ArchivedWindowMetadata,
  sourceTabs: ArchivedTabMetadata[],
  groupKey: string | undefined,
): void {
  const selectedIds = new Set(sourceTabs.map((tab) => tab.bookmarkId));
  const ordered = Object.values(window.tabs).sort(
    (left, right) => left.index - right.index,
  );
  const nextTabs: ArchivedTabMetadata[] = [];
  for (const tab of ordered) {
    nextTabs.push(tab);
    if (!selectedIds.has(tab.bookmarkId)) continue;
    const bookmarkId = createArchiveId("tab");
    const copy: ArchivedTabMetadata = {
      ...structuredClone(tab),
      active: false,
      bookmarkId,
      title: copyName(tab.title),
    };
    delete copy.savedBookmarkId;
    if (groupKey === undefined) delete copy.groupKey;
    else copy.groupKey = groupKey;
    nextTabs.push(copy);
  }
  window.tabs = Object.fromEntries(
    nextTabs.map((tab, index) => [tab.bookmarkId, { ...tab, index }]),
  );
  normalizeWindowTabs(window);
}

function isTopLevelItem(
  store: ArchiveStore,
  item: ArchiveItemReference,
): boolean {
  if (item.type === "group") return false;
  if (item.type === "session") return store.sessions[item.id] !== undefined;
  if (item.type === "window")
    return store.windows[item.id]?.sessionId === undefined;
  const found = findArchivedTab(store, item.id);
  return (
    found !== undefined &&
    archiveEntryType(found.windowMetadata) === "tab" &&
    found.windowMetadata.sessionId === undefined
  );
}

function topLevelKey(
  store: ArchiveStore,
  item: ArchiveItemReference,
): string | undefined {
  if (!isTopLevelItem(store, item)) return undefined;
  if (item.type === "session") return `session:${item.id}`;
  if (item.type === "group") return undefined;
  if (item.type === "window") return `window:${item.id}`;
  return `tab:${item.id}`;
}

function normalizeTopLevelOrder(store: ArchiveStore): void {
  const valid = new Set<string>();
  Object.keys(store.sessions).forEach((id) => valid.add(`session:${id}`));
  for (const [id, window] of Object.entries(store.windows)) {
    if (window.sessionId !== undefined) continue;
    if (archiveEntryType(window) === "tab") {
      const tabId = Object.keys(window.tabs)[0];
      if (tabId !== undefined) valid.add(`tab:${tabId}`);
    } else valid.add(`window:${id}`);
  }
  const existing = (store.topLevelOrder ?? []).filter((id) => valid.delete(id));
  const missing = [...valid].sort((left, right) => {
    const leftTime = topLevelCreatedAt(store, left);
    const rightTime = topLevelCreatedAt(store, right);
    return rightTime - leftTime;
  });
  store.topLevelOrder = [...existing, ...missing];
}

function topLevelCreatedAt(store: ArchiveStore, key: string): number {
  const [type, id] = key.split(":", 2);
  if (type === "session") return store.sessions[id!]?.createdAt ?? 0;
  if (type === "window") return store.windows[id!]?.createdAt ?? 0;
  return findArchivedTab(store, id!)?.metadata.createdAt ?? 0;
}

function countItemTabs(
  store: ArchiveStore,
  item: ArchiveItemReference,
): number {
  if (item.type === "group") {
    const window = store.windows[item.id];
    return Object.values(window?.tabs ?? {}).filter(
      (tab) => tab.groupKey === item.groupKey,
    ).length;
  }
  if (item.type === "tab")
    return findArchivedTab(store, item.id) === undefined ? 0 : 1;
  if (item.type === "window")
    return Object.keys(store.windows[item.id]?.tabs ?? {}).length;
  return (store.sessions[item.id]?.windowIds ?? []).reduce(
    (total, id) => total + Object.keys(store.windows[id]?.tabs ?? {}).length,
    0,
  );
}

function sameArchiveItem(
  left: ArchiveItemReference,
  right: ArchiveItemReference,
): boolean {
  return (
    left.type === right.type &&
    left.id === right.id &&
    left.groupKey === right.groupKey
  );
}

function namesMatch(
  candidate: string | undefined,
  normalizedName: string,
): boolean {
  return (
    candidate?.localeCompare(normalizedName, undefined, {
      sensitivity: "base",
    }) === 0
  );
}

function assertUniqueSessionName(store: ArchiveStore, name: string): void {
  if (
    Object.values(store.sessions).some((session) =>
      namesMatch(session.name, name),
    )
  ) {
    throw new Error("A session with that name already exists.");
  }
}

function assertUniqueWindowName(
  store: ArchiveStore,
  name: string,
  sessionId: string | undefined,
): void {
  if (
    Object.values(store.windows).some(
      (window) =>
        archiveEntryType(window) === "window" &&
        window.sessionId === sessionId &&
        namesMatch(window.name, name),
    )
  ) {
    throw new Error("A window with that name already exists in this scope.");
  }
}

function uniqueWindowNameInSession(
  store: ArchiveStore,
  session: ArchivedSessionMetadata,
  preferred: string,
): string {
  let candidate = preferred;
  let suffix = 2;
  while (
    session.windowIds.some((windowId) =>
      namesMatch(store.windows[windowId]?.name, candidate),
    )
  ) {
    candidate = `${preferred} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}

function normalizeEligibleTabs(
  tabs: chrome.tabs.Tab[],
): Array<chrome.tabs.Tab & { id: number; url: string }> {
  return tabs
    .map((tab) => {
      const url = tab.pendingUrl ?? tab.url;
      return url === undefined ? tab : { ...tab, url };
    })
    .filter(
      (tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
        tab.id !== undefined &&
        tab.url !== undefined &&
        tab.url.trim().length > 0,
    )
    .sort((left, right) => left.index - right.index);
}

function findArchivedTab(
  store: ArchiveStore,
  bookmarkId: string,
):
  | {
      entryId: string;
      metadata: ArchivedTabMetadata;
      windowMetadata: ArchivedWindowMetadata;
    }
  | undefined {
  for (const [entryId, windowMetadata] of Object.entries(store.windows)) {
    const metadata = windowMetadata.tabs[bookmarkId];
    if (metadata !== undefined) return { entryId, metadata, windowMetadata };
  }
  return undefined;
}

function removeWindowFromSession(store: ArchiveStore, windowId: string): void {
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    if (!session.windowIds.includes(windowId)) continue;
    session.windowIds = session.windowIds.filter(
      (candidate) => candidate !== windowId,
    );
    if (session.windowIds.length === 0) delete store.sessions[sessionId];
    return;
  }
}

async function loadGroupMetadata(
  tabs: chrome.tabs.Tab[],
  dependencies: ArchiveDependencies,
): Promise<Record<string, ArchivedGroupMetadata>> {
  const groups: Record<string, ArchivedGroupMetadata> = {};
  const groupIds = new Set(
    tabs.map((tab) => tab.groupId).filter((groupId) => groupId !== NO_GROUP_ID),
  );
  await Promise.all(
    [...groupIds].map(async (groupId) => {
      try {
        const group = await dependencies.tabGroups.get(groupId);
        const title = normalizeWindowName(group.title);
        groups[String(groupId)] = {
          collapsed: group.collapsed,
          color: group.color,
          ...(title === undefined ? {} : { title }),
        };
      } catch {
        return;
      }
    }),
  );
  return groups;
}

async function restoreSingleGroup(
  tabId: number,
  tab: ArchivedTabMetadata | undefined,
  window: ArchivedWindowMetadata | undefined,
  dependencies: ArchiveDependencies,
): Promise<void> {
  if (tab?.groupKey === undefined || window === undefined) return;
  const group = window.groups[tab.groupKey];
  if (group === undefined) return;
  const groupId = await dependencies.tabs.group({ tabIds: tabId });
  await updateLiveGroup(groupId, group, dependencies);
}

async function restoreWindowGroups(
  windowId: number,
  restoredTabs: Array<chrome.tabs.Tab & { id: number }>,
  metadata: Array<ArchivedTabMetadata | undefined>,
  window: ArchivedWindowMetadata | undefined,
  dependencies: ArchiveDependencies,
): Promise<void> {
  if (window === undefined) return;
  const tabsByGroup = new Map<string, number[]>();
  for (const [index, tab] of metadata.entries()) {
    if (tab?.groupKey === undefined || tab.pinned) continue;
    const restoredTab = restoredTabs[index];
    if (restoredTab === undefined) continue;
    const ids = tabsByGroup.get(tab.groupKey) ?? [];
    ids.push(restoredTab.id);
    tabsByGroup.set(tab.groupKey, ids);
  }
  for (const [groupKey, tabIds] of tabsByGroup) {
    const group = window.groups[groupKey];
    if (group === undefined || tabIds.length === 0) continue;
    const groupId = await dependencies.tabs.group({
      createProperties: { windowId },
      tabIds: tabIds as [number, ...number[]],
    });
    await updateLiveGroup(groupId, group, dependencies);
  }
}

async function updateLiveGroup(
  groupId: number,
  group: ArchivedGroupMetadata,
  dependencies: ArchiveDependencies,
): Promise<void> {
  const normalized = { ...group, color: normalizeGroupColor(group.color) };
  try {
    await dependencies.tabGroups.update(groupId, normalized);
  } catch {
    const withoutColor: chrome.tabGroups.UpdateProperties = {
      collapsed: normalized.collapsed,
      ...(normalized.title === undefined ? {} : { title: normalized.title }),
    };
    await dependencies.tabGroups.update(groupId, withoutColor);
  }
}

async function loadStore(
  dependencies: ArchiveDependencies,
): Promise<ArchiveStore> {
  const stored = await dependencies.storage.get(ARCHIVE_STORE_KEY);
  const candidate = stored[ARCHIVE_STORE_KEY] as
    Partial<ArchiveStore> | undefined;
  const legacyCandidate = candidate as
    | (Partial<ArchiveStore> & {
        rootFolderId?: string;
        schemaVersion?: number;
      })
    | undefined;
  const store: ArchiveStore = {
    ...(typeof candidate?.legacyRootFolderId === "string"
      ? { legacyRootFolderId: candidate.legacyRootFolderId }
      : typeof legacyCandidate?.rootFolderId === "string"
        ? { legacyRootFolderId: legacyCandidate.rootFolderId }
        : {}),
    schemaVersion: 4,
    sessions:
      typeof candidate?.sessions === "object" && candidate.sessions !== null
        ? candidate.sessions
        : {},
    topLevelOrder: Array.isArray(candidate?.topLevelOrder)
      ? candidate.topLevelOrder.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    windows:
      typeof candidate?.windows === "object" && candidate.windows !== null
        ? candidate.windows
        : {},
  };
  let repairedGroupMetadata = false;
  for (const window of Object.values(store.windows)) {
    const incognito =
      window.incognito === true ||
      Object.values(window.tabs).some((tab) => tab.incognito === true);
    if (incognito) window.incognito = true;
    else delete window.incognito;
    for (const tab of Object.values(window.tabs)) {
      if (incognito) tab.incognito = true;
      else delete tab.incognito;
    }
    for (const [groupKey, group] of Object.entries(window.groups)) {
      if (groupKey.trim().length === 0) {
        const repairedKey = uniqueGroupKey(window, "legacy-group");
        window.groups[repairedKey] = group;
        delete window.groups[groupKey];
        for (const tab of Object.values(window.tabs)) {
          if (tab.groupKey === groupKey) tab.groupKey = repairedKey;
        }
        repairedGroupMetadata = true;
      }
      const title = normalizeWindowName(group.title);
      if (group.title !== undefined && title === undefined) {
        delete group.title;
        repairedGroupMetadata = true;
      } else if (title !== undefined && title !== group.title) {
        group.title = title;
        repairedGroupMetadata = true;
      }
      const color = normalizeGroupColor(group.color);
      if (color !== group.color) {
        group.color = color;
        repairedGroupMetadata = true;
      }
    }
  }
  normalizeTopLevelOrder(store);
  if (legacyCandidate?.schemaVersion !== 4 || repairedGroupMetadata) {
    await saveStore(store, dependencies);
  }
  if (store.legacyRootFolderId !== undefined) {
    await removeLegacyArchiveRoot(store, dependencies);
  }
  return store;
}

function cloneStore(store: ArchiveStore): ArchiveStore {
  return structuredClone(store);
}

async function loadHistory(
  dependencies: ArchiveDependencies,
): Promise<ArchiveHistoryStore> {
  const stored = await dependencies.storage.get(ARCHIVE_HISTORY_KEY);
  const value = stored[ARCHIVE_HISTORY_KEY] as
    Partial<ArchiveHistoryStore> | undefined;
  return {
    future: Array.isArray(value?.future)
      ? value.future.slice(-ARCHIVE_HISTORY_LIMIT)
      : [],
    past: Array.isArray(value?.past)
      ? value.past.slice(-ARCHIVE_HISTORY_LIMIT)
      : [],
    version: 1,
  };
}

async function pushHistory(
  entry: ArchiveHistoryEntry,
  dependencies: ArchiveDependencies,
): Promise<void> {
  const history = await loadHistory(dependencies);
  history.past.push(entry);
  history.past = history.past.slice(-ARCHIVE_HISTORY_LIMIT);
  history.future = [];
  await saveHistory(history, dependencies);
}

async function saveHistory(
  history: ArchiveHistoryStore,
  dependencies: ArchiveDependencies,
): Promise<void> {
  const candidate: ArchiveHistoryStore = {
    future: history.future.slice(-ARCHIVE_HISTORY_LIMIT),
    past: history.past.slice(-ARCHIVE_HISTORY_LIMIT),
    version: 1,
  };
  while (candidate.past.length + candidate.future.length > 0) {
    try {
      await dependencies.storage.set({ [ARCHIVE_HISTORY_KEY]: candidate });
      return;
    } catch {
      if (candidate.past.length >= candidate.future.length)
        candidate.past.shift();
      else candidate.future.shift();
    }
  }
  await dependencies.storage
    .set({ [ARCHIVE_HISTORY_KEY]: candidate })
    .catch(() => undefined);
}

async function applyHistoryEntry(
  entry: ArchiveHistoryEntry,
  direction: "redo" | "undo",
  dependencies: ArchiveDependencies,
): Promise<void> {
  if (entry.kind === "bookmark") {
    const items = entry.items ?? (entry.item === undefined ? [] : [entry.item]);
    for (const item of direction === "undo" ? [...items].reverse() : items) {
      if (item.type === "session")
        await toggleArchiveSessionBookmark(item.id, dependencies);
      else if (item.type === "window")
        await toggleArchiveWindowBookmark(item.id, dependencies);
      else await toggleArchiveTabBookmark(item.id, dependencies);
    }
    return;
  }
  const current = await loadStore(dependencies);
  const target = cloneStore(direction === "undo" ? entry.before : entry.after);
  carryCurrentBookmarkReferences(current, target);
  normalizeTopLevelOrder(target);
  await saveStore(target, dependencies);
  await synchronizeSavedBookmarkTitles(target, dependencies);
}

function carryCurrentBookmarkReferences(
  current: ArchiveStore,
  target: ArchiveStore,
): void {
  for (const [id, session] of Object.entries(target.sessions)) {
    const currentId = current.sessions[id]?.savedFolderId;
    if (current.sessions[id] !== undefined) {
      if (currentId === undefined) delete session.savedFolderId;
      else session.savedFolderId = currentId;
    }
  }
  for (const [id, window] of Object.entries(target.windows)) {
    const currentWindow = current.windows[id];
    if (currentWindow !== undefined) {
      if (currentWindow.savedFolderId === undefined)
        delete window.savedFolderId;
      else window.savedFolderId = currentWindow.savedFolderId;
    }
    for (const tab of Object.values(window.tabs)) {
      const currentTab = findArchivedTab(current, tab.bookmarkId)?.metadata;
      if (currentTab === undefined) continue;
      if (currentTab.savedBookmarkId === undefined) delete tab.savedBookmarkId;
      else tab.savedBookmarkId = currentTab.savedBookmarkId;
    }
  }
}

async function synchronizeSavedBookmarkTitles(
  store: ArchiveStore,
  dependencies: ArchiveDependencies,
): Promise<void> {
  for (const session of Object.values(store.sessions)) {
    if (session.savedFolderId !== undefined) {
      await dependencies.bookmarks
        .update(session.savedFolderId, {
          title: `${session.name ?? "Session"}${TITLE_SEPARATOR}${formatArchiveTimestamp(session.createdAt)}`,
        })
        .catch(() => undefined);
    }
  }
  for (const window of Object.values(store.windows)) {
    if (window.savedFolderId !== undefined) {
      const nested =
        window.sessionId !== undefined &&
        store.sessions[window.sessionId]?.savedFolderId !== undefined;
      await dependencies.bookmarks
        .update(window.savedFolderId, {
          title: nested
            ? (window.name ?? "Window")
            : formatWindowFolderTitle(
                window.createdAt,
                Object.keys(window.tabs).length,
                window.name,
              ),
        })
        .catch(() => undefined);
    }
    for (const tab of Object.values(window.tabs)) {
      if (tab.savedBookmarkId === undefined) continue;
      await dependencies.bookmarks
        .update(tab.savedBookmarkId, { title: tab.title, url: tab.url })
        .catch(() => undefined);
    }
  }
}

function saveStore(
  store: ArchiveStore,
  dependencies: ArchiveDependencies,
): Promise<void> {
  return dependencies.storage.set({ [ARCHIVE_STORE_KEY]: store });
}

async function removeLegacyArchiveRoot(
  store: ArchiveStore,
  dependencies: ArchiveDependencies,
): Promise<void> {
  const rootId = store.legacyRootFolderId;
  if (rootId === undefined) return;
  const [root] = await getExistingBookmarks([rootId], dependencies);
  if (
    root !== undefined &&
    root.url === undefined &&
    root.title.startsWith(ROOT_TITLE_PREFIX)
  ) {
    await dependencies.bookmarks.removeTree(root.id);
    await waitForBookmarksRemoved([root.id], dependencies);
  }
  delete store.legacyRootFolderId;
  await saveStore(store, dependencies);
}

async function waitForBookmarksRemoved(
  bookmarkIds: string[],
  dependencies: ArchiveDependencies,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const remaining = await getExistingBookmarks(bookmarkIds, dependencies);
    if (remaining.length === 0) return;
    await dependencies.delay(50);
  }
  throw new Error("The browser did not confirm bookmark removal.");
}

async function getExistingBookmarks(
  bookmarkIds: string[],
  dependencies: ArchiveDependencies,
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  if (bookmarkIds.length === 0) return [];
  try {
    return await dependencies.bookmarks.get(bookmarkIds);
  } catch {
    const results = await Promise.all(
      bookmarkIds.map(async (bookmarkId) => {
        try {
          const [bookmark] = await dependencies.bookmarks.get(bookmarkId);
          return bookmark;
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter(
      (bookmark): bookmark is chrome.bookmarks.BookmarkTreeNode =>
        bookmark !== undefined,
    );
  }
}

function getDefaultDependencies(): ArchiveDependencies {
  return {
    bookmarks: chrome.bookmarks,
    delay: (milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    now: () => new Date(),
    storage: chrome.storage.local,
    tabGroups: chrome.tabGroups,
    tabs: chrome.tabs,
    windows: chrome.windows,
  };
}
