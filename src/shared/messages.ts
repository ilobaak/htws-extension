export interface GetStatusMessage {
  tabId?: number;
  type: "GET_STATUS";
}
export interface ProtectSiteMessage {
  protect: boolean;
  tabId: number;
  type: "PROTECT_SITE";
}
export interface GetArchivesMessage {
  type: "GET_ARCHIVES";
}
export interface ClearArchivesMessage {
  type: "CLEAR_ARCHIVES";
}
export interface RestoreAllArchivesMessage {
  type: "RESTORE_ALL_ARCHIVES";
}
export interface ArchiveSelectionPayload {
  groupIds?: string[];
  sessionIds: string[];
  tabIds: string[];
  windowIds: string[];
}
export interface MergeArchiveSelectionMessage {
  destination: "session" | "window";
  name: string;
  selection: ArchiveSelectionPayload;
  type: "MERGE_ARCHIVE_SELECTION";
}
export interface MoveArchiveTabsOutMessage {
  selection: ArchiveSelectionPayload;
  type: "MOVE_ARCHIVE_TABS_OUT";
}
export interface MoveArchiveWindowsOutMessage {
  selection: ArchiveSelectionPayload;
  type: "MOVE_ARCHIVE_WINDOWS_OUT";
}
export interface CreateArchiveGroupMessage {
  color: string;
  tabIds: string[];
  title: string;
  type: "CREATE_ARCHIVE_GROUP";
}
export interface UpdateArchiveGroupMessage {
  color: string;
  folderId: string;
  groupKey: string;
  title?: string;
  type: "UPDATE_ARCHIVE_GROUP";
}
export interface MoveArchiveTabsToGroupMessage {
  folderId: string;
  groupKey?: string;
  tabIds: string[];
  type: "MOVE_ARCHIVE_TABS_TO_GROUP";
}
export interface RestoreArchiveGroupMessage {
  folderId: string;
  groupKey: string;
  type: "RESTORE_ARCHIVE_GROUP";
}
export interface DeleteArchiveGroupMessage {
  folderId: string;
  groupKey: string;
  type: "DELETE_ARCHIVE_GROUP";
}
export interface BookmarkArchiveSelectionMessage {
  selection: ArchiveSelectionPayload;
  type: "BOOKMARK_ARCHIVE_SELECTION";
}
export interface RestoreArchiveSelectionMessage {
  selection: ArchiveSelectionPayload;
  type: "RESTORE_ARCHIVE_SELECTION";
}
export interface DeleteArchiveSelectionMessage {
  selection: ArchiveSelectionPayload;
  type: "DELETE_ARCHIVE_SELECTION";
}
export interface DuplicateArchiveSelectionMessage {
  selection: ArchiveSelectionPayload;
  type: "DUPLICATE_ARCHIVE_SELECTION";
}
export interface ArchiveItemPayload {
  collapsed?: boolean;
  groupKey?: string;
  id: string;
  type: "group" | "session" | "tab" | "window";
}
export interface MoveArchiveItemMessage {
  placement: "after" | "before" | "inside";
  source: ArchiveItemPayload;
  target?: ArchiveItemPayload;
  type: "MOVE_ARCHIVE_ITEM";
}
export interface MergeArchiveItemsMessage {
  destination: ArchiveItemPayload;
  items: ArchiveItemPayload[];
  type: "MERGE_ARCHIVE_ITEMS";
}
export interface ToggleArchivePinMessage {
  item: ArchiveItemPayload;
  type: "TOGGLE_ARCHIVE_PIN";
}
export interface GetArchiveHistoryMessage {
  type: "GET_ARCHIVE_HISTORY";
}
export interface UndoArchiveMessage {
  type: "UNDO_ARCHIVE";
}
export interface RedoArchiveMessage {
  type: "REDO_ARCHIVE";
}
export interface GetActivityLogMessage {
  type: "GET_ACTIVITY_LOG";
}
export interface ClearActivityLogMessage {
  type: "CLEAR_ACTIVITY_LOG";
}
export interface ImportActivityLogMessage {
  data: unknown;
  type: "IMPORT_ACTIVITY_LOG";
}
export interface ExportArchivesMessage {
  type: "EXPORT_ARCHIVES";
}
export interface ImportArchivesMessage {
  data: unknown;
  type: "IMPORT_ARCHIVES";
}
export interface PruneActivityLogMessage {
  type: "PRUNE_ACTIVITY_LOG";
}
export interface RestoreActivityEntryMessage {
  entryId: string;
  type: "RESTORE_ACTIVITY_ENTRY";
}
export interface HibernateTabMessage {
  tabId: number;
  type: "HIBERNATE_TAB";
}
export interface HibernateTabsMessage {
  tabIds: number[];
  type: "HIBERNATE_TABS";
}
export interface HibernateGroupMessage {
  groupId: number;
  ignoreProtection?: boolean;
  type: "HIBERNATE_GROUP";
}
export interface HibernateWindowMessage {
  ignoreProtection?: boolean;
  name?: string;
  windowId: number;
  type: "HIBERNATE_WINDOW";
}
export interface HibernateSessionMessage {
  ignoreProtection?: boolean;
  name?: string;
  type: "HIBERNATE_SESSION";
}
export interface RestoreArchiveTabMessage {
  bookmarkId: string;
  targetWindowId?: number;
  type: "RESTORE_ARCHIVE_TAB";
}
export interface RestoreArchiveWindowMessage {
  folderId: string;
  type: "RESTORE_ARCHIVE_WINDOW";
}
export interface RenameArchiveWindowMessage {
  folderId: string;
  mergeOnConflict?: boolean;
  name: string;
  type: "RENAME_ARCHIVE_WINDOW";
}
export interface RenameArchiveTabMessage {
  bookmarkId: string;
  name: string;
  type: "RENAME_ARCHIVE_TAB";
}
export interface DeleteArchiveTabMessage {
  bookmarkId: string;
  type: "DELETE_ARCHIVE_TAB";
}
export interface DeleteArchiveWindowMessage {
  folderId: string;
  type: "DELETE_ARCHIVE_WINDOW";
}
export interface ToggleArchiveTabBookmarkMessage {
  bookmarkId: string;
  type: "TOGGLE_ARCHIVE_TAB_BOOKMARK";
}
export interface ToggleArchiveWindowBookmarkMessage {
  folderId: string;
  type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK";
}
export interface RestoreArchiveSessionMessage {
  sessionId: string;
  type: "RESTORE_ARCHIVE_SESSION";
}
export interface RenameArchiveSessionMessage {
  mergeOnConflict?: boolean;
  name: string;
  sessionId: string;
  type: "RENAME_ARCHIVE_SESSION";
}
export interface DeleteArchiveSessionMessage {
  sessionId: string;
  type: "DELETE_ARCHIVE_SESSION";
}
export interface ToggleArchiveSessionBookmarkMessage {
  sessionId: string;
  type: "TOGGLE_ARCHIVE_SESSION_BOOKMARK";
}

export type WorkerMessage =
  | GetStatusMessage
  | ProtectSiteMessage
  | GetArchivesMessage
  | ClearArchivesMessage
  | RestoreAllArchivesMessage
  | MergeArchiveSelectionMessage
  | MoveArchiveTabsOutMessage
  | MoveArchiveWindowsOutMessage
  | CreateArchiveGroupMessage
  | UpdateArchiveGroupMessage
  | MoveArchiveTabsToGroupMessage
  | RestoreArchiveGroupMessage
  | DeleteArchiveGroupMessage
  | BookmarkArchiveSelectionMessage
  | RestoreArchiveSelectionMessage
  | DeleteArchiveSelectionMessage
  | DuplicateArchiveSelectionMessage
  | MoveArchiveItemMessage
  | MergeArchiveItemsMessage
  | ToggleArchivePinMessage
  | GetArchiveHistoryMessage
  | UndoArchiveMessage
  | RedoArchiveMessage
  | GetActivityLogMessage
  | ClearActivityLogMessage
  | ImportActivityLogMessage
  | ExportArchivesMessage
  | ImportArchivesMessage
  | PruneActivityLogMessage
  | RestoreActivityEntryMessage
  | HibernateTabMessage
  | HibernateTabsMessage
  | HibernateGroupMessage
  | HibernateWindowMessage
  | HibernateSessionMessage
  | RestoreArchiveTabMessage
  | RestoreArchiveWindowMessage
  | RenameArchiveTabMessage
  | RenameArchiveWindowMessage
  | DeleteArchiveTabMessage
  | DeleteArchiveWindowMessage
  | ToggleArchiveTabBookmarkMessage
  | ToggleArchiveWindowBookmarkMessage
  | RestoreArchiveSessionMessage
  | RenameArchiveSessionMessage
  | DeleteArchiveSessionMessage
  | ToggleArchiveSessionBookmarkMessage;

export interface ObserverSnapshotMessage {
  childFrameCount: number;
  formDirty: boolean;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  streamActive: boolean;
  type: "OBSERVER_SNAPSHOT";
}

export interface ExtensionStatus {
  currentDecision?: {
    decisionReason: string;
    protectionLevel: string;
    warnings: readonly string[];
  };
  hostAccess: "all" | "none" | "selected";
  siteProtectionMode: "broader" | "exact" | "none";
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.type === "GET_STATUS")
    return c.tabId === undefined || isInteger(c.tabId);
  if (
    c.type === "GET_ARCHIVES" ||
    c.type === "CLEAR_ARCHIVES" ||
    c.type === "RESTORE_ALL_ARCHIVES" ||
    c.type === "GET_ARCHIVE_HISTORY" ||
    c.type === "UNDO_ARCHIVE" ||
    c.type === "REDO_ARCHIVE" ||
    c.type === "GET_ACTIVITY_LOG" ||
    c.type === "CLEAR_ACTIVITY_LOG" ||
    c.type === "EXPORT_ARCHIVES" ||
    c.type === "PRUNE_ACTIVITY_LOG"
  )
    return true;
  if (c.type === "IMPORT_ARCHIVES" || c.type === "IMPORT_ACTIVITY_LOG")
    return typeof c.data === "object" && c.data !== null;
  if (c.type === "MERGE_ARCHIVE_SELECTION")
    return (
      (c.destination === "session" || c.destination === "window") &&
      isNonEmptyString(c.name) &&
      isArchiveSelection(c.selection)
    );
  if (
    c.type === "MOVE_ARCHIVE_TABS_OUT" ||
    c.type === "MOVE_ARCHIVE_WINDOWS_OUT" ||
    c.type === "BOOKMARK_ARCHIVE_SELECTION" ||
    c.type === "RESTORE_ARCHIVE_SELECTION" ||
    c.type === "DELETE_ARCHIVE_SELECTION" ||
    c.type === "DUPLICATE_ARCHIVE_SELECTION"
  )
    return isArchiveSelection(c.selection);
  if (c.type === "CREATE_ARCHIVE_GROUP")
    return (
      isStringArray(c.tabIds) &&
      c.tabIds.length > 0 &&
      isNonEmptyString(c.title) &&
      isNonEmptyString(c.color)
    );
  if (c.type === "UPDATE_ARCHIVE_GROUP")
    return (
      isNonEmptyString(c.folderId) &&
      isNonEmptyString(c.groupKey) &&
      (c.title === undefined || isNonEmptyString(c.title)) &&
      isNonEmptyString(c.color)
    );
  if (c.type === "MOVE_ARCHIVE_TABS_TO_GROUP")
    return (
      isNonEmptyString(c.folderId) &&
      (c.groupKey === undefined || isNonEmptyString(c.groupKey)) &&
      isStringArray(c.tabIds) &&
      c.tabIds.length > 0
    );
  if (c.type === "RESTORE_ARCHIVE_GROUP" || c.type === "DELETE_ARCHIVE_GROUP")
    return isNonEmptyString(c.folderId) && isNonEmptyString(c.groupKey);
  if (c.type === "MOVE_ARCHIVE_ITEM")
    return (
      isArchiveItem(c.source) &&
      (c.target === undefined || isArchiveItem(c.target)) &&
      (c.placement === "before" ||
        c.placement === "after" ||
        c.placement === "inside")
    );
  if (c.type === "MERGE_ARCHIVE_ITEMS")
    return (
      isArchiveItem(c.destination) &&
      Array.isArray(c.items) &&
      c.items.length > 1 &&
      c.items.every(isArchiveItem)
    );
  if (c.type === "TOGGLE_ARCHIVE_PIN") return isArchiveItem(c.item);
  if (c.type === "RESTORE_ACTIVITY_ENTRY") return isNonEmptyString(c.entryId);
  if (c.type === "HIBERNATE_TAB") return isInteger(c.tabId);
  if (c.type === "HIBERNATE_TABS")
    return (
      Array.isArray(c.tabIds) &&
      c.tabIds.length > 1 &&
      c.tabIds.every(isInteger) &&
      new Set(c.tabIds).size === c.tabIds.length
    );
  if (c.type === "HIBERNATE_GROUP")
    return (
      isInteger(c.groupId) &&
      c.groupId >= 0 &&
      (c.ignoreProtection === undefined ||
        typeof c.ignoreProtection === "boolean")
    );
  if (c.type === "HIBERNATE_WINDOW")
    return (
      isInteger(c.windowId) &&
      (c.name === undefined || typeof c.name === "string") &&
      (c.ignoreProtection === undefined ||
        typeof c.ignoreProtection === "boolean")
    );
  if (c.type === "HIBERNATE_SESSION")
    return (
      (c.name === undefined || typeof c.name === "string") &&
      (c.ignoreProtection === undefined ||
        typeof c.ignoreProtection === "boolean")
    );
  if (c.type === "RESTORE_ARCHIVE_TAB")
    return (
      isNonEmptyString(c.bookmarkId) &&
      (c.targetWindowId === undefined || isInteger(c.targetWindowId))
    );
  if (c.type === "RESTORE_ARCHIVE_WINDOW") return isNonEmptyString(c.folderId);
  if (c.type === "RENAME_ARCHIVE_TAB")
    return isNonEmptyString(c.bookmarkId) && isNonEmptyString(c.name);
  if (c.type === "RENAME_ARCHIVE_WINDOW")
    return (
      isNonEmptyString(c.folderId) &&
      isNonEmptyString(c.name) &&
      (c.mergeOnConflict === undefined ||
        typeof c.mergeOnConflict === "boolean")
    );
  if (c.type === "DELETE_ARCHIVE_TAB") return isNonEmptyString(c.bookmarkId);
  if (c.type === "DELETE_ARCHIVE_WINDOW") return isNonEmptyString(c.folderId);
  if (c.type === "TOGGLE_ARCHIVE_TAB_BOOKMARK")
    return isNonEmptyString(c.bookmarkId);
  if (c.type === "TOGGLE_ARCHIVE_WINDOW_BOOKMARK")
    return isNonEmptyString(c.folderId);
  if (
    c.type === "RESTORE_ARCHIVE_SESSION" ||
    c.type === "DELETE_ARCHIVE_SESSION" ||
    c.type === "TOGGLE_ARCHIVE_SESSION_BOOKMARK"
  )
    return isNonEmptyString(c.sessionId);
  if (c.type === "RENAME_ARCHIVE_SESSION")
    return (
      isNonEmptyString(c.sessionId) &&
      isNonEmptyString(c.name) &&
      (c.mergeOnConflict === undefined ||
        typeof c.mergeOnConflict === "boolean")
    );
  if (c.type === "PROTECT_SITE")
    return isInteger(c.tabId) && typeof c.protect === "boolean";
  return false;
}

function isArchiveItem(value: unknown): value is ArchiveItemPayload {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isNonEmptyString(item.id) &&
    (item.type === "group" ||
      item.type === "session" ||
      item.type === "window" ||
      item.type === "tab") &&
    (item.type !== "group" || isNonEmptyString(item.groupKey)) &&
    (item.collapsed === undefined || typeof item.collapsed === "boolean")
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}
function isArchiveSelection(value: unknown): value is ArchiveSelectionPayload {
  if (typeof value !== "object" || value === null) return false;
  const selection = value as Record<string, unknown>;
  return (
    (selection.groupIds === undefined || isStringArray(selection.groupIds)) &&
    ["sessionIds", "tabIds", "windowIds"].every((key) => {
      const ids = selection[key];
      return Array.isArray(ids) && ids.every(isNonEmptyString);
    })
  );
}

export function isObserverSnapshot(
  value: unknown,
): value is ObserverSnapshotMessage {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<ObserverSnapshotMessage>;
  return (
    c.type === "OBSERVER_SNAPSHOT" &&
    typeof c.childFrameCount === "number" &&
    Number.isInteger(c.childFrameCount) &&
    c.childFrameCount >= 0 &&
    c.childFrameCount <= 10_000 &&
    typeof c.formDirty === "boolean" &&
    typeof c.mediaPlaying === "boolean" &&
    typeof c.pictureInPicture === "boolean" &&
    typeof c.streamActive === "boolean"
  );
}
