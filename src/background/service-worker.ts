import { evaluateTab, snapshotTab } from "../core/tab-policy";
import {
  planAutoHibernateBatches,
  resolveLastAccessed,
} from "../core/auto-hibernate";
import {
  classifyTabUrl,
  isArchiveableUrl,
  isWebsiteUrl,
} from "../core/tab-url";
import {
  isObserverSnapshot,
  isWorkerMessage,
  type ArchiveSelectionPayload,
  type ExtensionStatus,
  type WorkerMessage,
} from "../shared/messages";
import { aggregatePageState, loadPageStateStore } from "../shared/page-state";
import { loadSettings } from "../shared/settings";
import {
  compileSiteRules,
  createRule,
  getSiteProtectionMode,
  loadSiteRules,
  saveSiteRules,
} from "../shared/site-rules";
import {
  appendActivityLog,
  clearActivityLog,
  getActivityLog,
  importActivityLog,
  pruneActivityLog,
  type ActivityLogEntry,
  type ActivityLogTab,
} from "./activity-log";
import {
  bookmarkArchiveSelection,
  createArchiveGroup,
  deleteArchiveSelection,
  deleteArchiveGroup,
  clearArchive,
  deleteArchiveSession,
  deleteArchiveTab,
  deleteArchiveWindow,
  duplicateArchiveSelection,
  exportArchiveData,
  getArchiveSnapshot,
  getArchiveHistoryStatus,
  hibernateSession,
  hibernateTabs,
  importArchiveData,
  mergeArchiveSelection,
  mergeArchiveItems,
  moveArchiveTabsOut,
  moveArchiveItem,
  moveArchiveTabsToGroup,
  moveArchiveWindowsOut,
  planArchiveSelectionRestore,
  recordArchiveBookmarkMutation,
  recordArchiveMutation,
  redoArchiveChange,
  renameArchiveSession,
  renameArchiveTab,
  renameArchiveWindow,
  restoreArchiveSession,
  restoreArchiveGroup,
  restoreArchiveTab,
  restoreArchiveWindow,
  runArchiveMutationWithoutHistory,
  toggleArchiveSessionBookmark,
  toggleArchivePin,
  toggleArchiveTabBookmark,
  toggleArchiveWindowBookmark,
  updateArchiveGroup,
  undoArchiveChange,
  type ArchiveWindowView,
} from "./hibernate-archive";
import {
  classifyHostAccess,
  getGrantedOrigins,
  refreshTabObserver,
  syncObserverRegistration,
} from "./host-access";
import {
  clearPageStates,
  handleObserverSnapshot,
  markTabComplete,
  markTabLoading,
  removeTabState,
} from "./page-state-manager";
import {
  ensureTabContextMenu,
  HIBERNATE_GROUP_MENU_ID,
  HIBERNATE_SELECTED_TABS_MENU_ID,
  HIBERNATE_SESSION_MENU_ID,
  HIBERNATE_TAB_MENU_ID,
  HIBERNATE_WINDOW_MENU_ID,
  NEVER_HIBERNATE_SITE_MENU_ID,
  updateSelectedTabsContextMenu,
} from "./tab-context-menu";

const AUTO_HIBERNATE_ALARM = "htws-auto-hibernate";
const TAB_ACCESS_STORE_KEY = "autoHibernateTabAccess";
type TabAccessStore = Record<string, number>;
let tabAccessMutation = Promise.resolve();
let autoHibernateRunning = false;
const activeTabByWindow = new Map<number, number>();

chrome.runtime.onInstalled.addListener(() => runSafely(initializeRuntime()));
chrome.runtime.onStartup.addListener(() => runSafely(initializeRuntime()));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_HIBERNATE_ALARM) runSafely(runAutoHibernate());
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (isObserverSnapshot(message)) {
      void handleObserverSnapshot(message, sender)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (!isWorkerMessage(message)) return false;
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL(""))
    ) {
      sendResponse({ error: "Extension request rejected.", ok: false });
      return false;
    }
    void handleWorkerMessage(message)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({
          error:
            error instanceof Error
              ? error.message
              : "Extension request failed.",
          ok: false,
        }),
      );
    return true;
  },
);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  if (info.menuItemId === HIBERNATE_TAB_MENU_ID) {
    runSafely(handleHibernateTabs([tab], undefined, "tab"));
  } else if (info.menuItemId === HIBERNATE_SELECTED_TABS_MENU_ID) {
    runSafely(
      chrome.tabs
        .query({ highlighted: true, windowId: tab.windowId })
        .then((tabs) => handleHibernateTabs(tabs, undefined, "tab")),
    );
  } else if (info.menuItemId === HIBERNATE_GROUP_MENU_ID) {
    runSafely(handleHibernateGroup(tab.groupId));
  } else if (info.menuItemId === HIBERNATE_WINDOW_MENU_ID) {
    runSafely(
      chrome.tabs
        .query({ windowId: tab.windowId })
        .then((tabs) => handleHibernateTabs(tabs, undefined, "window")),
    );
  } else if (info.menuItemId === HIBERNATE_SESSION_MENU_ID) {
    runSafely(handleHibernateSession(undefined));
  } else if (info.menuItemId === NEVER_HIBERNATE_SITE_MENU_ID) {
    runSafely(
      chrome.tabs
        .query({ highlighted: true, windowId: tab.windowId })
        .then((tabs) =>
          setTabsProtection(
            tabs.length > 1 && tabs.some((item) => item.id === tab.id)
              ? tabs
              : [tab],
            true,
          ),
        ),
    );
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.groupId !== undefined) {
    runSafely(syncTabContextMenus(tab.windowId));
  }
  if (changeInfo.status === "loading")
    runSafely(markTabLoading(tabId, changeInfo.url ?? tab.url));
  else if (changeInfo.status === "complete")
    runSafely(
      markTabComplete(tabId, tab.url).then(() => refreshTabObserver(tab)),
    );
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) =>
  runSafely(
    Promise.all([
      recordTabActivation(tabId, windowId),
      syncTabContextMenus(windowId),
    ]),
  ),
);
chrome.tabs.onHighlighted.addListener(({ windowId }) =>
  runSafely(syncTabContextMenus(windowId)),
);
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined) {
    if (tab.active) activeTabByWindow.set(tab.windowId, tab.id);
    runSafely(recordTabAccess(tab.id));
  }
});
chrome.tabs.onRemoved.addListener((tabId) =>
  runSafely(Promise.all([removeTabState(tabId), removeTabAccess(tabId)])),
);
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
  runSafely(replaceTabAccess(addedTabId, removedTabId)),
);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.settings !== undefined) {
    runSafely(syncAutoHibernateAlarm());
  }
});
chrome.permissions.onAdded.addListener(() =>
  runSafely(clearPageStates().then(syncObserverRegistration)),
);
chrome.permissions.onRemoved.addListener(() =>
  runSafely(clearPageStates().then(syncObserverRegistration)),
);
runSafely(initializeRuntime());

async function initializeRuntime(): Promise<void> {
  await ensureTabContextMenu();
  await syncTabContextMenus();
  await Promise.all([
    initializeTabAccessStore(),
    syncObserverRegistration(),
    syncAutoHibernateAlarm(),
    pruneActivityLog(),
  ]);
}

async function syncTabContextMenus(windowId?: number): Promise<void> {
  const query =
    windowId === undefined ? { currentWindow: true as const } : { windowId };
  const [highlightedTabs, activeTabs] = await Promise.all([
    chrome.tabs.query({ ...query, highlighted: true }),
    chrome.tabs.query({ ...query, active: true }),
  ]);
  const activeTab = activeTabs[0];
  await updateSelectedTabsContextMenu(
    highlightedTabs.length,
    activeTab !== undefined &&
      activeTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
  );
}

async function syncAutoHibernateAlarm(): Promise<void> {
  const settings = await loadSettings();
  if (settings.autoHibernateMinutes === null) {
    await chrome.alarms.clear(AUTO_HIBERNATE_ALARM);
    return;
  }
  await chrome.alarms.create(AUTO_HIBERNATE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}

async function runAutoHibernate(): Promise<void> {
  if (autoHibernateRunning) return;
  autoHibernateRunning = true;
  try {
    const settings = await loadSettings();
    if (settings.autoHibernateMinutes === null) return;
    const [tabs, accessStore] = await Promise.all([
      chrome.tabs.query({}),
      loadTabAccessStore(),
    ]);
    const now = Date.now();
    const resolvedTabs = tabs.map((tab) => ({
      ...tab,
      lastAccessed: resolveLastAccessed(
        tab,
        tab.id === undefined ? undefined : accessStore[String(tab.id)],
        now,
      ),
    }));
    const batches = planAutoHibernateBatches(resolvedTabs, settings, now);
    for (const batchTabs of batches) {
      const grouped =
        settings.autoHibernateGroupedTabs === "together" &&
        batchTabs[0]?.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
      const groupId = grouped ? batchTabs[0]?.groupId : undefined;
      const group =
        groupId === undefined
          ? undefined
          : await chrome.tabGroups.get(groupId).catch(() => undefined);
      try {
        await handleHibernateTabs(
          batchTabs,
          group?.title?.trim() || undefined,
          grouped ? "window" : "tab",
          false,
          true,
          grouped,
          grouped ? "group" : "tab",
        );
      } catch {
        // One failed tab or group must not prevent later candidates from being checked.
      }
    }
  } finally {
    autoHibernateRunning = false;
  }
}

async function initializeTabAccessStore(): Promise<void> {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({}),
    loadTabAccessStore(),
  ]);
  const now = Date.now();
  const next: TabAccessStore = {};
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    if (tab.active) activeTabByWindow.set(tab.windowId, tab.id);
    next[String(tab.id)] = tab.active
      ? now
      : resolveLastAccessed(tab, stored[String(tab.id)], now);
  }
  await chrome.storage.session.set({ [TAB_ACCESS_STORE_KEY]: next });
}

async function loadTabAccessStore(): Promise<TabAccessStore> {
  const stored = await chrome.storage.session.get(TAB_ACCESS_STORE_KEY);
  const candidate = stored[TAB_ACCESS_STORE_KEY];
  if (typeof candidate !== "object" || candidate === null) return {};
  return Object.fromEntries(
    Object.entries(candidate).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function mutateTabAccess(
  mutation: (store: TabAccessStore) => void,
): Promise<void> {
  tabAccessMutation = tabAccessMutation.then(async () => {
    const store = await loadTabAccessStore();
    mutation(store);
    await chrome.storage.session.set({ [TAB_ACCESS_STORE_KEY]: store });
  });
  return tabAccessMutation;
}

function recordTabAccess(tabId: number): Promise<void> {
  return mutateTabAccess((store) => {
    store[String(tabId)] = Date.now();
  });
}

function recordTabActivation(tabId: number, windowId: number): Promise<void> {
  const previousTabId = activeTabByWindow.get(windowId);
  activeTabByWindow.set(windowId, tabId);
  return mutateTabAccess((store) => {
    const now = Date.now();
    if (previousTabId !== undefined) store[String(previousTabId)] = now;
    store[String(tabId)] = now;
  });
}

function removeTabAccess(tabId: number): Promise<void> {
  for (const [windowId, activeTabId] of activeTabByWindow) {
    if (activeTabId === tabId) activeTabByWindow.delete(windowId);
  }
  return mutateTabAccess((store) => {
    delete store[String(tabId)];
  });
}

function replaceTabAccess(
  addedTabId: number,
  removedTabId: number,
): Promise<void> {
  for (const [windowId, activeTabId] of activeTabByWindow) {
    if (activeTabId === removedTabId)
      activeTabByWindow.set(windowId, addedTabId);
  }
  return mutateTabAccess((store) => {
    const prior = store[String(removedTabId)] ?? Date.now();
    delete store[String(removedTabId)];
    store[String(addedTabId)] = prior;
  });
}

async function handleWorkerMessage(message: WorkerMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_STATUS":
      return getStatus(message.tabId);
    case "GET_ARCHIVES":
      return getArchiveSnapshot();
    case "CLEAR_ARCHIVES":
      return recordArchiveMutation("Clear All", () => clearArchive());
    case "RESTORE_ALL_ARCHIVES":
      return handleRestoreAll();
    case "BOOKMARK_ARCHIVE_SELECTION":
      return bookmarkArchiveSelection(message.selection);
    case "RESTORE_ARCHIVE_SELECTION":
      return handleRestoreSelection(message.selection);
    case "DELETE_ARCHIVE_SELECTION":
      return recordArchiveMutation("Delete Selected", () =>
        deleteArchiveSelection(message.selection),
      );
    case "DUPLICATE_ARCHIVE_SELECTION":
      return recordArchiveMutation("Duplicate Selected", () =>
        duplicateArchiveSelection(message.selection),
      );
    case "MERGE_ARCHIVE_SELECTION":
      return recordArchiveMutation(
        `Move To New ${message.destination === "session" ? "Session" : "Window"}`,
        () =>
          mergeArchiveSelection(
            message.selection,
            message.destination,
            message.name,
          ),
      );
    case "MOVE_ARCHIVE_TABS_OUT":
      return recordArchiveMutation("Move Tabs Out", () =>
        moveArchiveTabsOut(message.selection),
      );
    case "MOVE_ARCHIVE_WINDOWS_OUT":
      return recordArchiveMutation("Move Windows Out", () =>
        moveArchiveWindowsOut(message.selection),
      );
    case "CREATE_ARCHIVE_GROUP":
      return recordArchiveMutation("Create Group", () =>
        createArchiveGroup(message.tabIds, message.title, message.color),
      );
    case "UPDATE_ARCHIVE_GROUP":
      return recordArchiveMutation("Update Group", () =>
        updateArchiveGroup(
          message.folderId,
          message.groupKey,
          message.title,
          message.color,
        ),
      );
    case "MOVE_ARCHIVE_TABS_TO_GROUP":
      return recordArchiveMutation(
        message.groupKey === undefined ? "Ungroup Tabs" : "Move Tabs To Group",
        () =>
          moveArchiveTabsToGroup(
            message.tabIds,
            message.folderId,
            message.groupKey,
          ),
      );
    case "RESTORE_ARCHIVE_GROUP":
      return handleRestoreGroup(message.folderId, message.groupKey);
    case "DELETE_ARCHIVE_GROUP":
      return recordArchiveMutation("Erase Group", () =>
        deleteArchiveGroup(message.folderId, message.groupKey),
      );
    case "MOVE_ARCHIVE_ITEM":
      return recordArchiveMutation("Drag Move", () =>
        moveArchiveItem(message.source, message.target, message.placement),
      );
    case "MERGE_ARCHIVE_ITEMS":
      return recordArchiveMutation("Merge Selected", () =>
        mergeArchiveItems(message.items, message.destination),
      );
    case "TOGGLE_ARCHIVE_PIN":
      return recordArchiveMutation("Toggle Pin", () =>
        toggleArchivePin(message.item),
      );
    case "GET_ARCHIVE_HISTORY":
      return getArchiveHistoryStatus();
    case "UNDO_ARCHIVE":
      return undoArchiveChange();
    case "REDO_ARCHIVE":
      return redoArchiveChange();
    case "GET_ACTIVITY_LOG":
      return getActivityLog();
    case "CLEAR_ACTIVITY_LOG":
      return clearActivityLog();
    case "IMPORT_ACTIVITY_LOG":
      return importActivityLog(message.data);
    case "EXPORT_ARCHIVES":
      return exportArchiveData();
    case "IMPORT_ARCHIVES":
      return recordArchiveMutation("Import Archive", () =>
        importArchiveData(message.data),
      );
    case "PRUNE_ACTIVITY_LOG":
      return pruneActivityLog();
    case "RESTORE_ACTIVITY_ENTRY":
      return restoreActivityEntry(message.entryId);
    case "HIBERNATE_TAB":
      return handleHibernateTabs(
        [await chrome.tabs.get(message.tabId)],
        undefined,
        "tab",
      );
    case "HIBERNATE_TABS":
      return handleHibernateTabs(
        await Promise.all(
          message.tabIds.map((tabId) => chrome.tabs.get(tabId)),
        ),
        undefined,
        "tab",
      );
    case "HIBERNATE_GROUP":
      return handleHibernateGroup(message.groupId, message.ignoreProtection);
    case "HIBERNATE_WINDOW":
      return handleHibernateTabs(
        await chrome.tabs.query({ windowId: message.windowId }),
        message.name,
        "window",
        message.ignoreProtection,
      );
    case "HIBERNATE_SESSION":
      return handleHibernateSession(message.name, message.ignoreProtection);
    case "RENAME_ARCHIVE_TAB":
      return recordArchiveMutation("Rename Tab", () =>
        renameArchiveTab(message.bookmarkId, message.name),
      );
    case "RENAME_ARCHIVE_WINDOW":
      return recordArchiveMutation("Rename Window", () =>
        renameArchiveWindow(
          message.folderId,
          message.name,
          undefined,
          message.mergeOnConflict,
        ),
      );
    case "RESTORE_ARCHIVE_TAB":
      return handleRestoreTab(message.bookmarkId, message.targetWindowId);
    case "RESTORE_ARCHIVE_WINDOW":
      return handleRestoreWindow(message.folderId);
    case "DELETE_ARCHIVE_TAB":
      return recordArchiveMutation("Erase Tab", () =>
        deleteArchiveTab(message.bookmarkId),
      );
    case "DELETE_ARCHIVE_WINDOW":
      return recordArchiveMutation("Erase Window", () =>
        deleteArchiveWindow(message.folderId),
      );
    case "TOGGLE_ARCHIVE_TAB_BOOKMARK":
      return recordArchiveBookmarkMutation(
        "Toggle Tab Bookmark",
        { id: message.bookmarkId, type: "tab" },
        () => toggleArchiveTabBookmark(message.bookmarkId),
      );
    case "TOGGLE_ARCHIVE_WINDOW_BOOKMARK":
      return recordArchiveBookmarkMutation(
        "Toggle Window Bookmark",
        { id: message.folderId, type: "window" },
        () => toggleArchiveWindowBookmark(message.folderId),
      );
    case "RENAME_ARCHIVE_SESSION":
      return recordArchiveMutation("Rename Session", () =>
        renameArchiveSession(
          message.sessionId,
          message.name,
          undefined,
          message.mergeOnConflict,
        ),
      );
    case "RESTORE_ARCHIVE_SESSION":
      return handleRestoreSession(message.sessionId);
    case "DELETE_ARCHIVE_SESSION":
      return recordArchiveMutation("Erase Session", () =>
        deleteArchiveSession(message.sessionId),
      );
    case "TOGGLE_ARCHIVE_SESSION_BOOKMARK":
      return recordArchiveBookmarkMutation(
        "Toggle Session Bookmark",
        { id: message.sessionId, type: "session" },
        () => toggleArchiveSessionBookmark(message.sessionId),
      );
    case "PROTECT_SITE":
      return setSiteProtection(message.tabId, message.protect);
  }
}

async function handleHibernateSession(
  name: string | undefined,
  ignoreProtection = false,
) {
  const browserWindows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
  const populatedWindows = browserWindows.filter(
    (window) => (window.tabs?.length ?? 0) > 0,
  );
  const allTabs = populatedWindows.flatMap((window) => window.tabs ?? []);
  const { candidates, closeOnly, eligible, skipped } = await selectEligibleTabs(
    allTabs,
    ignoreProtection,
  );
  const eligibleIds = new Set(eligible.map((tab) => tab.id));
  const grouped = populatedWindows
    .map((window) =>
      (window.tabs ?? []).filter((tab) => eligibleIds.has(tab.id)),
    )
    .filter((tabs) => tabs.length > 0);
  const affected = [...eligible, ...closeOnly];
  const logTabs = toLogTabs(affected.length > 0 ? affected : candidates);
  try {
    if (affected.length === 0) throw new Error(noEligibleTabsMessage(skipped));
    const result =
      eligible.length > 0
        ? await runArchiveMutationWithoutHistory(() =>
            hibernateSession(grouped, name),
          )
        : { archived: 0, windows: 0 };
    await closeTabsWithoutArchive(closeOnly);
    const detail = hibernationDetail(ignoreProtection, skipped, closeOnly);
    await appendActivityLog({
      action: "hibernate",
      ...("sessionId" in result ? { archiveId: result.sessionId } : {}),
      ...(detail ? { detail } : {}),
      outcome: skipped.length ? "partial" : "success",
      tabs: logTabs,
      target: "session",
      ...(name?.trim() ? { windowName: name.trim() } : {}),
    });
    return { ...result, ...(detail ? { detail } : {}), skipped };
  } catch (error) {
    await appendActivityLog({
      action: "hibernate",
      detail: error instanceof Error ? error.message : "Hibernation failed.",
      outcome: "failure",
      tabs: logTabs,
      target: "session",
      ...(name?.trim() ? { windowName: name.trim() } : {}),
    });
    throw error;
  }
}

async function handleHibernateTabs(
  tabs: chrome.tabs.Tab[],
  name: string | undefined,
  target: "tab" | "window",
  ignoreProtection = false,
  automatic = false,
  requireEveryTab = false,
  entryType: "group" | "tab" | "window" = target,
) {
  const { candidates, closeOnly, eligible, skipped } = await selectEligibleTabs(
    tabs,
    ignoreProtection,
    automatic,
  );
  const affected = [...eligible, ...closeOnly];
  const logTabs = toLogTabs(affected.length > 0 ? affected : candidates);
  if (
    requireEveryTab &&
    (closeOnly.length > 0 || eligible.length !== candidates.length)
  ) {
    return { archived: 0, bookmarkIds: [], skipped };
  }
  if (automatic && affected.length === 0) {
    return { archived: 0, bookmarkIds: [], skipped };
  }
  try {
    if (affected.length === 0) throw new Error(noEligibleTabsMessage(skipped));
    const result =
      eligible.length > 0
        ? await runArchiveMutationWithoutHistory(() =>
            hibernateTabs(eligible, undefined, name, entryType),
          )
        : { archived: 0, bookmarkIds: [] };
    await closeTabsWithoutArchive(closeOnly);
    const activityName =
      ("name" in result ? result.name : undefined) ?? name?.trim();
    const archiveId =
      target === "tab"
        ? result.bookmarkIds[0]
        : "folderId" in result
          ? result.folderId
          : undefined;
    const baseDetail = hibernationDetail(ignoreProtection, skipped, closeOnly);
    const detail = automatic
      ? ["Automatically hibernated after inactivity.", baseDetail]
          .filter((part): part is string => part !== undefined)
          .join(" ")
      : baseDetail;
    await appendActivityLog({
      action: "hibernate",
      ...(archiveId === undefined ? {} : { archiveId }),
      ...(detail ? { detail } : {}),
      outcome: skipped.length ? "partial" : "success",
      tabs: logTabs,
      target,
      ...(activityName ? { windowName: activityName } : {}),
    });
    return { ...result, ...(detail ? { detail } : {}), skipped };
  } catch (error) {
    await appendActivityLog({
      action: "hibernate",
      detail: error instanceof Error ? error.message : "Hibernation failed.",
      outcome: "failure",
      tabs: logTabs,
      target,
      ...(name?.trim() ? { windowName: name.trim() } : {}),
    });
    throw error;
  }
}

async function handleHibernateGroup(
  groupId: number,
  ignoreProtection = false,
): Promise<unknown> {
  if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    throw new Error("This tab is not in a group.");
  }
  const [tabs, group] = await Promise.all([
    chrome.tabs.query({ groupId }),
    chrome.tabGroups.get(groupId),
  ]);
  if (tabs.length === 0) throw new Error("This tab group is empty.");
  return handleHibernateTabs(
    tabs,
    group.title?.trim() || "Group",
    "window",
    ignoreProtection,
    false,
    true,
    "group",
  );
}

async function selectEligibleTabs(
  tabs: chrome.tabs.Tab[],
  ignoreProtection = false,
  automatic = false,
) {
  const candidates = tabs
    .map((tab) => {
      const url = tab.pendingUrl ?? tab.url;
      return url === undefined ? tab : { ...tab, url };
    })
    .filter(
      (tab): tab is chrome.tabs.Tab & { url: string } =>
        typeof tab.url === "string" && tab.url.length > 0,
    );
  const settings = await loadSettings();
  const skipped: Array<{ reason: string; title: string; url: string }> = [];
  const archiveCandidates: typeof candidates = [];
  const closeOnly: typeof candidates = [];
  const privateKeptOpen = new WeakSet<chrome.tabs.Tab>();
  for (const tab of candidates) {
    const classification = classifyTabUrl(tab.url);
    const skip = (reason: string): void => {
      skipped.push({ reason, title: tab.title ?? tab.url, url: tab.url });
    };
    const inactiveForMs = Math.max(0, Date.now() - tab.lastAccessed);
    if (
      automatic &&
      ((tab.incognito && !settings.autoHibernateIncludeIncognito) ||
        (classification === "internal" &&
          !settings.autoHibernateIncludeInternalPages))
    ) {
      skip("auto-scope-excluded");
    } else if (automatic && tab.active) {
      skip("active");
    } else if (
      automatic &&
      settings.autoHibernateMinutes !== null &&
      inactiveForMs < settings.autoHibernateMinutes * 60_000
    ) {
      skip("recently-active");
    } else if (automatic && tab.mutedInfo?.reason === "capture") {
      skip("tab-capture-active");
    } else if (automatic && tab.pinned && settings.protectPinned) {
      skip("pinned");
    } else if (automatic && tab.audible && settings.protectAudible) {
      skip("audible");
    } else if (!isArchiveableUrl(tab.url)) {
      skip("unsupported-url");
    } else if (tab.incognito && settings.incognitoBehavior === "keep-open") {
      privateKeptOpen.add(tab);
      skip("incognito-kept-open");
    } else if (
      classification === "internal" &&
      settings.internalPageBehavior === "keep-open"
    ) {
      skip("internal-page-kept-open");
    } else if (
      (tab.incognito && settings.incognitoBehavior === "close-and-log") ||
      (classification === "internal" &&
        settings.internalPageBehavior === "close-and-log")
    ) {
      closeOnly.push(tab);
    } else {
      archiveCandidates.push(tab);
    }
  }
  const websiteCandidates = archiveCandidates.filter((tab) =>
    isWebsiteUrl(tab.url),
  );
  const websiteCloseOnlyCandidates = automatic
    ? closeOnly.filter((tab) => isWebsiteUrl(tab.url))
    : [];
  const websiteCloseOnlySet = new Set(websiteCloseOnlyCandidates);
  const internalEligible = archiveCandidates.filter(
    (tab) => classifyTabUrl(tab.url) === "internal",
  );
  if (ignoreProtection) {
    return {
      candidates: candidates.filter((tab) => !privateKeptOpen.has(tab)),
      closeOnly,
      eligible: archiveCandidates,
      skipped,
    };
  }
  const [siteStore, pageStore, origins] = await Promise.all([
    loadSiteRules(),
    loadPageStateStore(),
    getGrantedOrigins(),
  ]);
  const siteRules = compileSiteRules(siteStore);
  const eligible: chrome.tabs.Tab[] = [...internalEligible];
  const evaluatedCloseOnly = automatic
    ? closeOnly.filter((tab) => !websiteCloseOnlySet.has(tab))
    : closeOnly;
  for (const tab of [...websiteCandidates, ...websiteCloseOnlyCandidates]) {
    const decision = evaluateTab(snapshotTab(tab), settings, {
      hostAccess:
        tab.discarded || tab.incognito
          ? "none"
          : classifyHostAccess(tab.url, origins),
      ignoreActive: !automatic,
      ignoreInactivity: !automatic,
      pageSafety:
        tab.discarded || tab.incognito
          ? undefined
          : aggregatePageState(
              tab.id === undefined ? undefined : pageStore[String(tab.id)],
            ),
      siteRules,
    });
    if (decision.eligible) {
      if (websiteCloseOnlySet.has(tab)) evaluatedCloseOnly.push(tab);
      else eligible.push(tab);
    } else
      skipped.push({
        reason: decision.decisionReason,
        title: tab.title ?? tab.url,
        url: tab.url,
      });
  }
  return {
    candidates: candidates.filter((tab) => !privateKeptOpen.has(tab)),
    closeOnly: evaluatedCloseOnly,
    eligible,
    skipped,
  };
}

async function closeTabsWithoutArchive(tabs: chrome.tabs.Tab[]): Promise<void> {
  const ids = tabs
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length > 0) await chrome.tabs.remove(ids);
}

function noEligibleTabsMessage(skipped: Array<{ reason: string }>): string {
  const unsupported = skipped.filter(
    ({ reason }) => reason === "unsupported-url",
  ).length;
  const incognito = skipped.filter(
    ({ reason }) => reason === "incognito-kept-open",
  ).length;
  const keptOpen = skipped.filter(
    ({ reason }) => reason === "internal-page-kept-open",
  ).length;
  const protectedTabs = skipped.length - unsupported - incognito - keptOpen;
  if (unsupported === skipped.length && unsupported > 0) {
    return "No tabs were hibernated because every tab uses a prohibited URL type. Ignore Protection does not override prohibited URL types.";
  }
  if (incognito === skipped.length && incognito > 0) {
    return "No tabs were hibernated because Settings is configured to keep private tabs open.";
  }
  if (keptOpen === skipped.length && keptOpen > 0) {
    return "No tabs were hibernated because Settings is configured to keep internal browser pages open.";
  }
  if (skipped.length === 0) {
    return "No tabs with readable URLs were available to hibernate.";
  }
  return `No tabs were hibernated. ${capitalize(skippedSummary(unsupported, incognito, keptOpen, protectedTabs))} ${skipped.length === 1 ? "was" : "were"} left open.`;
}

function hibernationDetail(
  ignoreProtection: boolean,
  skipped: Array<{ reason: string }>,
  closedWithoutArchive: chrome.tabs.Tab[],
): string | undefined {
  const parts: string[] = [];
  if (ignoreProtection)
    parts.push("Protection rules were intentionally ignored.");
  if (skipped.length > 0) {
    const unsupported = skipped.filter(
      ({ reason }) => reason === "unsupported-url",
    ).length;
    const incognito = skipped.filter(
      ({ reason }) => reason === "incognito-kept-open",
    ).length;
    const keptOpen = skipped.filter(
      ({ reason }) => reason === "internal-page-kept-open",
    ).length;
    const protectedTabs = skipped.length - unsupported - incognito - keptOpen;
    parts.push(
      `${capitalize(skippedSummary(unsupported, incognito, keptOpen, protectedTabs))} ${skipped.length === 1 ? "was" : "were"} left open.`,
    );
  }
  const privateClosed = closedWithoutArchive.filter(
    (tab) => tab.incognito,
  ).length;
  const internalClosed = closedWithoutArchive.length - privateClosed;
  if (internalClosed > 0) {
    parts.push(
      `${internalClosed} internal browser page${internalClosed === 1 ? " was" : "s were"} closed and logged without an archive entry.`,
    );
  }
  if (privateClosed > 0)
    parts.push(
      `${privateClosed} private tab${privateClosed === 1 ? " was" : "s were"} closed and logged without an archive entry.`,
    );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function skippedSummary(
  unsupported: number,
  incognito: number,
  keptOpen: number,
  protectedTabs: number,
): string {
  const parts = [
    unsupported > 0
      ? `${unsupported} tab${unsupported === 1 ? "" : "s"} with unsupported URL${unsupported === 1 ? "" : "s"}`
      : "",
    incognito > 0
      ? `${incognito} private tab${incognito === 1 ? "" : "s"} kept open by Settings`
      : "",
    keptOpen > 0
      ? `${keptOpen} internal browser page${keptOpen === 1 ? "" : "s"} kept open by Settings`
      : "",
    protectedTabs > 0
      ? `${protectedTabs} protected tab${protectedTabs === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length === 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

async function handleRestoreSession(sessionId: string) {
  const snapshot = await getArchiveSnapshot();
  const session = snapshot.sessions.find(
    (entry) => entry.sessionId === sessionId,
  );
  const tabs =
    session?.windows.flatMap((window) =>
      window.tabs.map(({ title, url }) => ({
        title,
        url,
        windowKey: window.folderId,
      })),
    ) ?? [];
  try {
    const result = await runArchiveMutationWithoutHistory(() =>
      restoreArchiveSession(sessionId),
    );
    await appendActivityLog({
      action: "restore",
      outcome: "success",
      tabs,
      target: "session",
      ...(session?.name ? { windowName: session.name } : {}),
    });
    return result;
  } catch (error) {
    await appendActivityLog({
      action: "restore",
      detail: error instanceof Error ? error.message : "Restore failed.",
      outcome: "failure",
      tabs,
      target: "session",
      ...(session?.name ? { windowName: session.name } : {}),
    });
    throw error;
  }
}

async function handleRestoreTab(bookmarkId: string, targetWindowId?: number) {
  const snapshot = await getArchiveSnapshot();
  const found = [
    ...snapshot.tabs,
    ...snapshot.windows.flatMap((window) => window.tabs),
    ...snapshot.sessions.flatMap((session) =>
      session.windows.flatMap((window) => window.tabs),
    ),
  ].find((tab) => tab.bookmarkId === bookmarkId);
  const tabs = found ? [{ title: found.title, url: found.url }] : [];
  try {
    const result = await runArchiveMutationWithoutHistory(() =>
      restoreArchiveTab(bookmarkId, targetWindowId),
    );
    await appendActivityLog({
      action: "restore",
      outcome: "success",
      tabs,
      target: "tab",
    });
    return result;
  } catch (error) {
    await appendActivityLog({
      action: "restore",
      detail: error instanceof Error ? error.message : "Restore failed.",
      outcome: "failure",
      tabs,
      target: "tab",
    });
    throw error;
  }
}

async function handleRestoreWindow(folderId: string) {
  const snapshot = await getArchiveSnapshot();
  const archived =
    snapshot.windows.find((window) => window.folderId === folderId) ??
    snapshot.sessions
      .flatMap((session) => session.windows)
      .find((window) => window.folderId === folderId);
  try {
    const result = await runArchiveMutationWithoutHistory(() =>
      restoreArchiveWindow(folderId),
    );
    await appendRestoreWindowLog(archived, "success");
    return result;
  } catch (error) {
    await appendRestoreWindowLog(
      archived,
      "failure",
      error instanceof Error ? error.message : "Restore failed.",
    );
    throw error;
  }
}

async function handleRestoreGroup(folderId: string, groupKey: string) {
  const snapshot = await getArchiveSnapshot();
  const window =
    snapshot.windows.find((entry) => entry.folderId === folderId) ??
    snapshot.sessions
      .flatMap((session) => session.windows)
      .find((entry) => entry.folderId === folderId);
  const group = window?.groups?.find((entry) => entry.key === groupKey);
  const tabs = group?.tabs.map(({ title, url }) => ({ title, url })) ?? [];
  try {
    const result = await runArchiveMutationWithoutHistory(() =>
      restoreArchiveGroup(folderId, groupKey),
    );
    await appendActivityLog({
      action: "restore",
      outcome: "success",
      tabs,
      target: "window",
      ...(group?.title ? { windowName: group.title } : {}),
    });
    return result;
  } catch (error) {
    await appendActivityLog({
      action: "restore",
      detail: error instanceof Error ? error.message : "Restore failed.",
      outcome: "failure",
      tabs,
      target: "window",
      ...(group?.title ? { windowName: group.title } : {}),
    });
    throw error;
  }
}

async function handleRestoreSelection(
  selection: ArchiveSelectionPayload,
): Promise<{ restored: number }> {
  const plan = planArchiveSelectionRestore(
    await getArchiveSnapshot(),
    selection,
  );
  const itemCount =
    plan.sessionIds.length +
    plan.windowIds.length +
    plan.groups.length +
    plan.tabIds.length;
  if (itemCount === 0) throw new Error("Select an archive entry first.");
  let restored = 0;
  for (const sessionId of plan.sessionIds) {
    restored += (await handleRestoreSession(sessionId)).restored;
  }
  for (const folderId of plan.windowIds) {
    restored += (await handleRestoreWindow(folderId)).restored;
  }
  for (const { folderId, groupKey } of plan.groups) {
    restored += (await handleRestoreGroup(folderId, groupKey)).restored;
  }
  for (const bookmarkId of plan.tabIds) {
    restored += (await handleRestoreTab(bookmarkId)).restored;
  }
  return { restored };
}

async function handleRestoreAll(): Promise<{
  restored: number;
  windows: number;
}> {
  const snapshot = await getArchiveSnapshot();
  const windows =
    snapshot.windows.length +
    snapshot.sessions.reduce(
      (total, session) => total + session.windows.length,
      0,
    );
  let restored = 0;
  for (const session of snapshot.sessions) {
    restored += (await handleRestoreSession(session.sessionId)).restored;
  }
  for (const window of snapshot.windows) {
    restored += (await handleRestoreWindow(window.folderId)).restored;
  }
  for (const tab of snapshot.tabs) {
    restored += (await handleRestoreTab(tab.bookmarkId)).restored;
  }
  return { restored, windows };
}

function appendRestoreWindowLog(
  window: ArchiveWindowView | undefined,
  outcome: "failure" | "success",
  detail?: string,
) {
  return appendActivityLog({
    action: "restore",
    ...(detail ? { detail } : {}),
    outcome,
    tabs: window?.tabs.map(({ title, url }) => ({ title, url })) ?? [],
    target: "window",
    ...(window?.name ? { windowName: window.name } : {}),
  });
}

function toLogTabs(tabs: chrome.tabs.Tab[]): ActivityLogTab[] {
  return tabs
    .map((tab) => ({ tab, url: tab.pendingUrl ?? tab.url }))
    .filter(
      (entry): entry is { tab: chrome.tabs.Tab; url: string } =>
        typeof entry.url === "string" && entry.url.length > 0,
    )
    .map(({ tab, url }) => ({
      title: tab.title || url,
      url,
      windowKey: String(tab.windowId),
    }));
}

async function restoreActivityEntry(
  entryId: string,
): Promise<{ fallback: boolean; restored: number }> {
  const entry = (await getActivityLog()).find(
    (candidate) => candidate.id === entryId,
  );
  if (entry === undefined) throw new Error("That activity entry has expired.");
  if (entry.action === "hibernate" && entry.outcome === "failure") {
    throw new Error("Nothing was hibernated by this failed action.");
  }
  if (entry.tabs.length === 0) {
    throw new Error("This activity entry has no recorded tabs to restore.");
  }

  if (
    entry.action === "hibernate" &&
    entry.archiveId !== undefined &&
    (await activityArchiveExists(entry))
  ) {
    const result =
      entry.target === "tab"
        ? await handleRestoreTab(entry.archiveId)
        : entry.target === "window"
          ? await handleRestoreWindow(entry.archiveId)
          : await handleRestoreSession(entry.archiveId);
    return { fallback: false, restored: result.restored };
  }

  const tabs = entry.tabs.filter((tab) => isArchiveableUrl(tab.url));
  if (tabs.length === 0) {
    throw new Error("This activity entry has no restorable URLs.");
  }
  await restoreLoggedTabs(entry.target, tabs);
  await appendActivityLog({
    action: "restore",
    detail: "Restored from activity history.",
    outcome: "success",
    tabs,
    target: entry.target,
    ...(entry.windowName ? { windowName: entry.windowName } : {}),
  });
  return { fallback: true, restored: tabs.length };
}

async function activityArchiveExists(
  entry: ActivityLogEntry,
): Promise<boolean> {
  if (entry.archiveId === undefined) return false;
  const snapshot = await getArchiveSnapshot();
  if (entry.target === "session") {
    return snapshot.sessions.some(
      (session) => session.sessionId === entry.archiveId,
    );
  }
  if (entry.target === "window") {
    return [
      ...snapshot.windows,
      ...snapshot.sessions.flatMap((s) => s.windows),
    ].some((window) => window.folderId === entry.archiveId);
  }
  return [
    ...snapshot.tabs,
    ...snapshot.windows.flatMap((window) => window.tabs),
    ...snapshot.sessions.flatMap((session) =>
      session.windows.flatMap((window) => window.tabs),
    ),
  ].some((tab) => tab.bookmarkId === entry.archiveId);
}

async function restoreLoggedTabs(
  target: ActivityLogEntry["target"],
  tabs: ActivityLogTab[],
): Promise<void> {
  if (target === "tab") {
    await chrome.tabs.create({ active: true, url: tabs[0]!.url });
    return;
  }
  if (target === "window") {
    await chrome.windows.create({ url: tabs.map((tab) => tab.url) });
    return;
  }
  const windows = new Map<string, string[]>();
  for (const tab of tabs) {
    const key = tab.windowKey ?? "legacy-session";
    const urls = windows.get(key) ?? [];
    urls.push(tab.url);
    windows.set(key, urls);
  }
  for (const urls of windows.values()) {
    await chrome.windows.create({ url: urls });
  }
}

async function getStatus(tabId?: number): Promise<ExtensionStatus> {
  const [settings, siteStore, pageStore, origins, tabs] = await Promise.all([
    loadSettings(),
    loadSiteRules(),
    loadPageStateStore(),
    getGrantedOrigins(),
    chrome.tabs.query({ currentWindow: true }),
  ]);
  const current =
    tabs.find((tab) => tab.id === tabId) ?? tabs.find((tab) => tab.active);
  const rules = compileSiteRules(siteStore);
  const hostAccess = classifyHostAccess(current?.url, origins);
  const decision =
    current === undefined
      ? undefined
      : evaluateTab(snapshotTab(current), settings, {
          hostAccess,
          ignoreActive: true,
          ignoreInactivity: true,
          pageSafety: aggregatePageState(
            current.id === undefined
              ? undefined
              : pageStore[String(current.id)],
          ),
          siteRules: rules,
        });
  const incognitoReason = current?.incognito
    ? settings.incognitoBehavior === "keep-open"
      ? "incognito-kept-open"
      : settings.incognitoBehavior === "close-and-log"
        ? "incognito-close-and-log"
        : undefined
    : undefined;
  return {
    ...(decision
      ? {
          currentDecision: {
            decisionReason: incognitoReason ?? decision.decisionReason,
            protectionLevel: decision.protectionLevel,
            warnings: decision.warnings,
          },
        }
      : {}),
    hostAccess,
    siteProtectionMode: getSiteProtectionMode(current?.url, siteStore),
  };
}

async function setSiteProtection(
  tabId: number,
  protect: boolean,
): Promise<{ ok: true }> {
  return setTabsProtection([await chrome.tabs.get(tabId)], protect);
}

async function setTabsProtection(
  tabs: chrome.tabs.Tab[],
  protect: boolean,
): Promise<{ ok: true }> {
  const hostnames = new Set(
    tabs.flatMap((tab) => {
      if (tab.url === undefined) return [];
      const parsedUrl = new URL(tab.url);
      return ["http:", "https:"].includes(parsedUrl.protocol)
        ? [parsedUrl.hostname.toLowerCase()]
        : [];
    }),
  );
  if (hostnames.size === 0) {
    throw new Error("Only normal website tabs can be added to site rules.");
  }
  const store = await loadSiteRules();
  const withoutCurrent = store.rules.filter(
    (rule) =>
      !(
        rule.matchType === "hostname" &&
        hostnames.has(rule.pattern.toLowerCase())
      ),
  );
  await saveSiteRules({
    rules: protect
      ? [
          ...withoutCurrent,
          ...[...hostnames].map((hostname) => createRule(hostname, "hostname")),
        ]
      : withoutCurrent,
    schemaVersion: 1,
  });
  return { ok: true };
}

function runSafely(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}
