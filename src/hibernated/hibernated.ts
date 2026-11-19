import "./hibernated.css";
import "../shared/archive-manager.css";
import type {
  ArchiveSnapshot,
  ArchiveTabView,
  ArchiveWindowView,
} from "../background/hibernate-archive";
import {
  reconcileArchiveEntryOrder,
  renderArchiveManager,
  type ArchiveManagerActions,
  type ArchiveItemReference,
} from "../shared/archive-manager";
import { downloadJson, readJsonFile } from "../shared/json-file";
import { GROUP_COLORS } from "../shared/group-colors";
import { isSupportedProductName } from "../shared/product";
import {
  confirmArchiveDeletion,
  type ArchiveDeleteSummary,
} from "../shared/archive-delete-confirmation";
import { filterArchiveSnapshot } from "./archive-filter";
import {
  deselectArchiveMatches,
  effectiveArchiveSelection,
  inclusiveArchiveSelectionRange,
  type ArchiveSelectionReference,
} from "./archive-selection";

const list = get<HTMLDivElement>("archive-list");
const empty = get<HTMLParagraphElement>("archive-empty");
const status = get<HTMLParagraphElement>("page-status");
const summary = get<HTMLElement>("archive-summary");
const exportArchives = get<HTMLButtonElement>("export-archives");
const importArchives = get<HTMLButtonElement>("import-archives");
const clearArchives = get<HTMLButtonElement>("clear-archives");
const restoreAll = get<HTMLButtonElement>("restore-all");
const undoArchive = get<HTMLButtonElement>("undo-archive");
const redoArchive = get<HTMLButtonElement>("redo-archive");
const rootDropZone = get<HTMLDivElement>("archive-root-drop-zone");
const selectionSummary = get<HTMLElement>("selection-summary");
const selectAllArchives = get<HTMLInputElement>("select-all-archives");
const mergeSelectedEntries = get<HTMLButtonElement>("merge-selected");
const mergeSelectedWindow = get<HTMLButtonElement>("merge-selected-window");
const mergeSelectedSession = get<HTMLButtonElement>("merge-selected-session");
const bookmarkSelected = get<HTMLButtonElement>("bookmark-selected");
const restoreSelected = get<HTMLButtonElement>("restore-selected");
const moveTabsOut = get<HTMLButtonElement>("move-tabs-out");
const groupCreator = get<HTMLDivElement>("group-creator");
const groupCreatorForm = get<HTMLFormElement>("group-creator-form");
const groupCreatorName = get<HTMLInputElement>("group-creator-name");
const groupCreatorColors = get<HTMLDivElement>("group-creator-colors");
const groupCreatorColorDropdown = get<HTMLDetailsElement>(
  "group-creator-color-dropdown",
);
const groupCreatorCurrentColor = get<HTMLSpanElement>(
  "group-creator-current-color",
);
const cancelGroupCreator = get<HTMLButtonElement>("cancel-group-creator");
const moveTabsToGroup = get<HTMLButtonElement>("move-tabs-to-group");
const ungroupTabs = get<HTMLButtonElement>("ungroup-tabs");
const moveWindowsOut = get<HTMLButtonElement>("move-windows-out");
const clearSelectionButton = get<HTMLButtonElement>("clear-selection");
const deleteSelected = get<HTMLButtonElement>("delete-selected");
const duplicateSelected = get<HTMLButtonElement>("duplicate-selected");
const archiveImportFile = get<HTMLInputElement>("archive-import-file");
const textFilter = get<HTMLInputElement>("archive-text-filter");
const filterResults = get<HTMLParagraphElement>("archive-filter-results");
const selectMatched = get<HTMLButtonElement>("select-matched");
const tableHead = get<HTMLDivElement>("archive-table-head");
const sortButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-sort-key]"),
];
type SortKey = "bookmarked" | "date" | "name" | "pinned" | "type";
type TypePriority = "group" | "session" | "tab" | "window";
interface SelectionPayload {
  groupIds: string[];
  sessionIds: string[];
  tabIds: string[];
  windowIds: string[];
}
const typeCycle: TypePriority[] = ["session", "window", "tab", "group"];
let currentSnapshot: ArchiveSnapshot | undefined;
let entryOrder: string[] | undefined;
let hasRendered = false;
const openSessionIds = new Set<string>();
const openWindowIds = new Set<string>();
const groupOpenState = new Map<string, boolean>();
const selectedGroupIds = new Set<string>();
const selectedSessionIds = new Set<string>();
const selectedWindowIds = new Set<string>();
const selectedTabIds = new Set<string>();
let refreshTimer: number | undefined;
let transferBusy = false;
let selectionBusy = false;
let sortDirection: "ascending" | "descending" = "descending";
let sortKey: SortKey = "date";
let typePriority: TypePriority = "session";
let groupCreatorColor: `${chrome.tabGroups.Color}` = "blue";
let selectionAnchor: ArchiveSelectionReference | undefined;

exportArchives.addEventListener("click", () => void exportArchiveJson());
importArchives.addEventListener("click", () => archiveImportFile.click());
clearArchives.addEventListener("click", () => void clearAllArchives());
restoreAll.addEventListener("click", () => void restoreEveryArchive());
undoArchive.addEventListener("click", () => void changeHistory("undo"));
redoArchive.addEventListener("click", () => void changeHistory("redo"));
bookmarkSelected.addEventListener("click", () => void bookmarkSelection());
restoreSelected.addEventListener("click", () => void restoreSelection());
mergeSelectedEntries.addEventListener("click", () => void mergeSelection());
mergeSelectedWindow.addEventListener(
  "click",
  () => void mergeSelected("window"),
);
mergeSelectedSession.addEventListener(
  "click",
  () => void mergeSelected("session"),
);
moveTabsOut.addEventListener("click", () => void moveSelectedTabsOut());
cancelGroupCreator.addEventListener("click", () => groupCreator.hidePopover());
groupCreatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createSelectedGroup();
});
moveTabsToGroup.addEventListener("click", () => openGroupCreator());
ungroupTabs.addEventListener("click", () => void ungroupSelectedTabs());
moveWindowsOut.addEventListener("click", () => void moveSelectedWindowsOut());
duplicateSelected.addEventListener("click", () => void duplicateSelection());
deleteSelected.addEventListener("click", () => void deleteSelection());
document.addEventListener("keydown", (event) => {
  if (
    (event.key !== "Backspace" && event.key !== "Delete") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.defaultPrevented ||
    event.repeat ||
    selectionBusy ||
    deleteSelected.disabled ||
    document.querySelector<HTMLDialogElement>("#delete-selection-dialog")
      ?.open === true ||
    isEditableKeyboardTarget(event.target)
  )
    return;
  event.preventDefault();
  void deleteSelection();
});
clearSelectionButton.addEventListener("click", () => {
  clearSelection();
  if (currentSnapshot !== undefined) renderSnapshot(currentSnapshot);
});
selectAllArchives.addEventListener("change", () => {
  if (currentSnapshot === undefined) return;
  clearSelection();
  if (selectAllArchives.checked) {
    currentSnapshot.sessions.forEach((session) =>
      selectedSessionIds.add(session.sessionId),
    );
    currentSnapshot.windows.forEach((window) =>
      selectedWindowIds.add(window.folderId),
    );
    currentSnapshot.tabs.forEach((tab) => selectedTabIds.add(tab.bookmarkId));
  }
  renderSnapshot(currentSnapshot);
});
archiveImportFile.addEventListener("change", () => void importArchiveJson());
textFilter.addEventListener("input", () => {
  if (currentSnapshot !== undefined) renderSnapshot(currentSnapshot);
});
selectMatched.addEventListener("click", selectFilterMatches);
rootDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.stopPropagation();
  rootDropZone.classList.add("is-drop-target");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});
rootDropZone.addEventListener("dragleave", () =>
  rootDropZone.classList.remove("is-drop-target"),
);
rootDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  rootDropZone.classList.remove("is-drop-target");
  const source = readDraggedItem(event.dataTransfer);
  if (source !== undefined) void dragMove(source, undefined, "inside");
});
document.addEventListener("dragover", (event) => {
  if (!isArchiveDrag(event.dataTransfer)) return;
  event.preventDefault();
  document
    .querySelector(".hibernated-shell")
    ?.classList.add("is-page-drop-target");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});
document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null)
    document
      .querySelector(".hibernated-shell")
      ?.classList.remove("is-page-drop-target");
});
document.addEventListener("drop", (event) => {
  if (!isArchiveDrag(event.dataTransfer)) return;
  event.preventDefault();
  document
    .querySelector(".hibernated-shell")
    ?.classList.remove("is-page-drop-target");
  const source = readDraggedItem(event.dataTransfer);
  if (source !== undefined) void dragMove(source, undefined, "inside");
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextKey = button.dataset.sortKey as SortKey;
    if (nextKey === "type") {
      if (sortKey === "type") {
        typePriority = nextTypePriority(typePriority);
      } else {
        sortKey = "type";
        typePriority = "session";
      }
    } else if (nextKey === sortKey) {
      sortDirection =
        sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      sortKey = nextKey;
      sortDirection = nextKey === "name" ? "ascending" : "descending";
    }
    entryOrder = undefined;
    updateSortHeaders();
    if (currentSnapshot !== undefined) renderSnapshot(currentSnapshot);
  });
});

updateSortHeaders();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.hibernateArchiveStore !== undefined) {
    scheduleRefresh();
  }
});
chrome.bookmarks.onCreated.addListener(scheduleRefresh);
chrome.bookmarks.onChanged.addListener(scheduleRefresh);
chrome.bookmarks.onRemoved.addListener(scheduleRefresh);

const actions: ArchiveManagerActions = {
  confirmDelete: confirmArchiveDeletion,
  async deleteGroup(folderId, groupKey) {
    await requireCount(
      { folderId, groupKey, type: "DELETE_ARCHIVE_GROUP" },
      "deleted",
    );
    await refresh("Hibernated group erased.");
  },
  async toggleBookmarkSession(sessionId) {
    const result = await toggleBookmark({
      sessionId,
      type: "TOGGLE_ARCHIVE_SESSION_BOOKMARK",
    });
    await refresh(
      result.bookmarked
        ? `${result.changed} session bookmark${result.changed === 1 ? "" : "s"} saved.`
        : "Saved session bookmarks removed; hibernation entry remains.",
    );
  },
  async toggleBookmarkTab(bookmarkId) {
    const result = await toggleBookmark({
      bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    await refresh(
      result.bookmarked
        ? "Bookmark saved."
        : "Saved bookmark removed; hibernation entry remains.",
    );
  },
  async toggleBookmarkWindow(folderId) {
    const result = await toggleBookmark({
      folderId,
      type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK",
    });
    await refresh(
      result.bookmarked
        ? `${result.changed} bookmark${result.changed === 1 ? "" : "s"} saved.`
        : "Saved window bookmarks removed; hibernation entry remains.",
    );
  },
  async togglePin(item) {
    const response = (await chrome.runtime.sendMessage({
      item,
      type: "TOGGLE_ARCHIVE_PIN",
    })) as { error?: string; pinned?: boolean } | undefined;
    if (typeof response?.pinned !== "boolean")
      throw new Error(response?.error ?? "The pin could not be updated.");
    entryOrder = undefined;
    await refresh(response.pinned ? "Entry pinned." : "Entry unpinned.");
  },
  async deleteTab(bookmarkId) {
    await requireCount({ bookmarkId, type: "DELETE_ARCHIVE_TAB" }, "deleted");
    await refresh("Hibernated tab erased.");
  },
  async deleteSession(sessionId) {
    await requireCount(
      { sessionId, type: "DELETE_ARCHIVE_SESSION" },
      "deleted",
    );
    await refresh("Hibernated session erased.");
  },
  async deleteWindow(folderId) {
    await requireCount({ folderId, type: "DELETE_ARCHIVE_WINDOW" }, "deleted");
    await refresh("Hibernated window erased.");
  },
  async renameTab(bookmarkId, name) {
    const response = (await chrome.runtime.sendMessage({
      bookmarkId,
      name,
      type: "RENAME_ARCHIVE_TAB",
    })) as { error?: string; ok?: boolean } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Rename failed.");
    await refresh("Tab renamed.");
  },
  async renameWindow(folderId, name) {
    await renameWithMerge("window", folderId, name);
  },
  async renameSession(sessionId, name) {
    await renameWithMerge("session", sessionId, name);
  },
  async restoreTab(bookmarkId) {
    await requireCount({ bookmarkId, type: "RESTORE_ARCHIVE_TAB" }, "restored");
    await refresh("Tab restored.");
  },
  async restoreWindow(folderId) {
    const restored = await requireCount(
      { folderId, type: "RESTORE_ARCHIVE_WINDOW" },
      "restored",
    );
    await refresh(`${restored} tab${restored === 1 ? "" : "s"} restored.`);
  },
  async restoreSession(sessionId) {
    const restored = await requireCount(
      { sessionId, type: "RESTORE_ARCHIVE_SESSION" },
      "restored",
    );
    await refresh(
      `${restored} session tab${restored === 1 ? "" : "s"} restored.`,
    );
  },
  async restoreGroup(folderId, groupKey) {
    const restored = await requireCount(
      { folderId, groupKey, type: "RESTORE_ARCHIVE_GROUP" },
      "restored",
    );
    await refresh(
      `${restored} grouped tab${restored === 1 ? "" : "s"} restored.`,
    );
  },
  async updateGroup(folderId, groupKey, title, color) {
    const response = (await chrome.runtime.sendMessage({
      color,
      folderId,
      groupKey,
      ...(title === undefined ? {} : { title }),
      type: "UPDATE_ARCHIVE_GROUP",
    })) as { error?: string; movedTabs?: number } | undefined;
    if (typeof response?.movedTabs !== "number") {
      throw new Error(response?.error ?? "The group could not be updated.");
    }
    await refresh("Group updated.");
  },
  showError(message) {
    showStatus(message, true);
  },
};

async function toggleBookmark(
  message: Record<string, unknown>,
): Promise<{ bookmarked: boolean; changed: number }> {
  const response = (await chrome.runtime.sendMessage(message)) as
    { bookmarked?: boolean; changed?: number; error?: string } | undefined;
  if (
    typeof response?.bookmarked !== "boolean" ||
    typeof response.changed !== "number"
  ) {
    throw new Error(response?.error ?? "The bookmark action failed.");
  }
  return { bookmarked: response.bookmarked, changed: response.changed };
}

async function renameWithMerge(
  type: "session" | "window",
  id: string,
  name: string,
): Promise<void> {
  const sendRename = async (mergeOnConflict: boolean) =>
    (await chrome.runtime.sendMessage({
      ...(type === "session" ? { sessionId: id } : { folderId: id }),
      mergeOnConflict,
      name,
      type:
        type === "session" ? "RENAME_ARCHIVE_SESSION" : "RENAME_ARCHIVE_WINDOW",
    })) as
      | {
          conflict?: { id: string; name: string };
          error?: string;
          merged?: boolean;
          ok?: boolean;
        }
      | undefined;
  let response = await sendRename(false);
  if (response?.conflict !== undefined) {
    const merge = globalThis.confirm(
      `A ${type} named "${response.conflict.name}" already exists in this scope. Merge this ${type} into it?`,
    );
    if (!merge) return;
    response = await sendRename(true);
  }
  if (!response?.ok) throw new Error(response?.error ?? "Rename failed.");
  await refresh(
    response.merged
      ? `${type === "session" ? "Sessions" : "Windows"} merged.`
      : `${type === "session" ? "Session" : "Window"} renamed.`,
  );
}

renderGroupCreatorColors();
void refresh();

async function refresh(message?: string): Promise<void> {
  try {
    const snapshot = await getArchives();
    currentSnapshot = snapshot;
    sanitizeSelection(snapshot);
    updateTransferControls();
    renderArchiveSummary(snapshot);
    renderSnapshot(snapshot);
    await updateHistoryControls();
    if (message) showStatus(message, false);
  } catch (error) {
    summary.textContent = "Unavailable";
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = errorMessage(
      error,
      "The hibernation archive could not be loaded.",
    );
  }
}

async function clearAllArchives(): Promise<void> {
  const count = currentSnapshot?.tabCount ?? 0;
  if (count === 0) return;
  if (
    !globalThis.confirm(
      `Erase all ${count} hibernated tab${count === 1 ? "" : "s"}? You can undo this archive change. Saved browser bookmark copies will remain.`,
    )
  )
    return;
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "CLEAR_ARCHIVES",
    })) as { deleted?: number; error?: string } | undefined;
    if (typeof response?.deleted !== "number") {
      throw new Error(response?.error ?? "The archive could not be cleared.");
    }
    entryOrder = undefined;
    openSessionIds.clear();
    openWindowIds.clear();
    groupOpenState.clear();
    await refresh(
      `Erased ${response.deleted} hibernated tab${response.deleted === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    showStatus(errorMessage(error, "The archive could not be cleared."), true);
  } finally {
    setTransferBusy(false);
  }
}

async function restoreEveryArchive(): Promise<void> {
  const snapshot = currentSnapshot;
  if (snapshot === undefined || snapshot.tabCount === 0) return;
  const windowCount =
    snapshot.windows.length +
    snapshot.sessions.reduce(
      (total, session) => total + session.windows.length,
      0,
    );
  if (
    !globalThis.confirm(
      `Restore all ${snapshot.tabCount} hibernated tab${snapshot.tabCount === 1 ? "" : "s"} across ${windowCount} window${windowCount === 1 ? "" : "s"}? The archive entries will be consumed as they are restored.`,
    )
  )
    return;
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "RESTORE_ALL_ARCHIVES",
    })) as { error?: string; restored?: number } | undefined;
    if (typeof response?.restored !== "number") {
      throw new Error(response?.error ?? "The archive could not be restored.");
    }
    clearSelection();
    entryOrder = undefined;
    await refresh(
      `Restored ${response.restored} tab${response.restored === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    showStatus(errorMessage(error, "The archive could not be restored."), true);
  } finally {
    setTransferBusy(false);
  }
}

async function mergeSelected(destination: "session" | "window"): Promise<void> {
  const defaultName = destination === "session" ? "Session" : "Window";
  const name = globalThis.prompt(`Name the new ${destination}`, defaultName);
  if (name === null) return;
  await runSelectionAction(
    {
      destination,
      name,
      selection: selectionPayload(),
      type: "MERGE_ARCHIVE_SELECTION",
    },
    destination === "session"
      ? "Selected entries moved to a new session."
      : "Selected entries moved to a new window.",
  );
}

async function mergeSelection(): Promise<void> {
  const items = selectedArchiveItemReferences();
  if (items.length < 2) return;
  const highestRank = Math.max(...items.map(archiveItemRank));
  const destination = items.find(
    (item) => archiveItemRank(item) === highestRank,
  );
  if (destination === undefined) return;
  await runSelectionAction(
    { destination, items, type: "MERGE_ARCHIVE_ITEMS" },
    "Selected entries merged.",
  );
}

async function bookmarkSelection(): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage({
      selection: selectionPayload(),
      type: "BOOKMARK_ARCHIVE_SELECTION",
    })) as
      { bookmarked?: number; changed?: number; error?: string } | undefined;
    if (typeof response?.changed !== "number") {
      throw new Error(
        response?.error ?? "The selected entries could not be bookmarked.",
      );
    }
    clearSelection();
    await refresh(
      response.changed === 0
        ? "No new website bookmarks were needed."
        : `Saved ${response.changed} bookmark${response.changed === 1 ? "" : "s"} for the selected entries.`,
    );
  } catch (error) {
    showStatus(
      errorMessage(error, "The selected entries could not be bookmarked."),
      true,
    );
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function restoreSelection(): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage({
      selection: selectionPayload(),
      type: "RESTORE_ARCHIVE_SELECTION",
    })) as { error?: string; restored?: number } | undefined;
    if (typeof response?.restored !== "number") {
      throw new Error(
        response?.error ?? "The selected entries could not be restored.",
      );
    }
    clearSelection();
    entryOrder = undefined;
    await refresh(
      `${response.restored} selected tab${response.restored === 1 ? "" : "s"} restored.`,
    );
  } catch (error) {
    showStatus(
      errorMessage(error, "The selected entries could not be restored."),
      true,
    );
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function moveSelectedTabsOut(): Promise<void> {
  await runSelectionAction(
    { selection: selectionPayload(), type: "MOVE_ARCHIVE_TABS_OUT" },
    "Selected tabs moved out of their windows.",
  );
}

async function createSelectedGroup(): Promise<void> {
  const tabs = selectedArchiveTabs();
  const title = groupCreatorName.value.trim();
  if (title.length === 0) {
    groupCreatorName.focus();
    return;
  }
  groupCreator.hidePopover();
  await runGroupAction(
    {
      color: groupCreatorColor,
      tabIds: tabs.map((tab) => tab.bookmarkId),
      title,
      type: "CREATE_ARCHIVE_GROUP",
    },
    "Group created.",
  );
}

function openGroupCreator(): void {
  groupCreatorName.value = "Group";
  selectGroupCreatorColor("blue");
  groupCreator.showPopover();
  groupCreatorName.select();
}

function renderGroupCreatorColors(): void {
  groupCreatorColors.replaceChildren(
    ...GROUP_COLORS.map((color) => {
      const choice = document.createElement("button");
      choice.className = "archive-group-color-choice";
      choice.dataset.groupColor = color;
      choice.type = "button";
      choice.title = capitalize(color);
      choice.setAttribute("aria-label", capitalize(color));
      choice.setAttribute("role", "radio");
      choice.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectGroupCreatorColor(color);
      });
      return choice;
    }),
  );
  selectGroupCreatorColor(groupCreatorColor);
}

function selectGroupCreatorColor(color: `${chrome.tabGroups.Color}`): void {
  groupCreatorColor = color;
  groupCreatorCurrentColor.dataset.groupColor = color;
  groupCreatorColorDropdown.open = false;
  groupCreatorColors
    .querySelectorAll<HTMLButtonElement>(".archive-group-color-choice")
    .forEach((choice) =>
      choice.setAttribute(
        "aria-checked",
        String(choice.dataset.groupColor === color),
      ),
    );
}

async function ungroupSelectedTabs(): Promise<void> {
  const tabs = selectedArchiveTabs();
  const folderId = tabs[0]?.folderId;
  if (folderId === undefined || tabs.some((tab) => tab.folderId !== folderId)) {
    showStatus("Select grouped tabs from one hibernated window.", true);
    return;
  }
  await runGroupAction(
    {
      folderId,
      tabIds: tabs.map((tab) => tab.bookmarkId),
      type: "MOVE_ARCHIVE_TABS_TO_GROUP",
    },
    "Selected tabs removed from their group.",
  );
}

async function runGroupAction(
  message: Record<string, unknown>,
  successMessage: string,
): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage(message)) as
      { error?: string; movedTabs?: number } | undefined;
    if (typeof response?.movedTabs !== "number") {
      throw new Error(response?.error ?? "The group change failed.");
    }
    clearSelection();
    entryOrder = undefined;
    await refresh(successMessage);
  } catch (error) {
    showStatus(errorMessage(error, "The group change failed."), true);
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function moveSelectedWindowsOut(): Promise<void> {
  await runSelectionAction(
    { selection: selectionPayload(), type: "MOVE_ARCHIVE_WINDOWS_OUT" },
    "Selected windows moved out of their sessions.",
  );
}

async function runSelectionAction(
  message: Record<string, unknown>,
  successMessage: string,
): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage(message)) as
      { error?: string; movedTabs?: number } | undefined;
    if (typeof response?.movedTabs !== "number") {
      throw new Error(
        response?.error ?? "The selected entries could not be moved.",
      );
    }
    clearSelection();
    entryOrder = undefined;
    await refresh(successMessage);
  } catch (error) {
    showStatus(
      errorMessage(error, "The selected entries could not be moved."),
      true,
    );
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function duplicateSelection(): Promise<void> {
  await runBulkSelectionAction(
    "DUPLICATE_ARCHIVE_SELECTION",
    "duplicated",
    "Selected entries duplicated.",
  );
}

async function deleteSelection(): Promise<void> {
  if (!(await confirmArchiveDeletion(selectedDeletionSummary()))) return;
  await runBulkSelectionAction(
    "DELETE_ARCHIVE_SELECTION",
    "deleted",
    "Selected entries erased.",
  );
}

function selectedDeletionSummary(): ArchiveDeleteSummary {
  if (currentSnapshot === undefined) return {};
  const directCount =
    selectedSessionIds.size +
    selectedWindowIds.size +
    selectedGroupIds.size +
    selectedTabIds.size;
  const effective = effectiveArchiveSelection(currentSnapshot, selectionSets());

  if (directCount === 1 && selectedSessionIds.size === 1) {
    const session = currentSnapshot.sessions.find(({ sessionId }) =>
      selectedSessionIds.has(sessionId),
    );
    if (session !== undefined) {
      return {
        entry: { name: session.name ?? "Session", type: "session" },
        sessions: 1,
        tabs: effective.tabIds.size,
        windows: effective.windowIds.size,
      };
    }
  }

  if (directCount === 1 && selectedWindowIds.size === 1) {
    const folderId = [...selectedWindowIds][0];
    const window =
      folderId === undefined ? undefined : findSnapshotWindow(folderId);
    if (window !== undefined) {
      const isGroup = window.entryType === "group";
      return {
        entry: {
          name: window.name ?? (isGroup ? "Group" : "Window"),
          type: isGroup ? "group" : "window",
        },
        ...(isGroup ? { groups: 1 } : { windows: 1 }),
        tabs: effective.tabIds.size,
      };
    }
  }

  if (directCount === 1 && selectedGroupIds.size === 1) {
    const groupId = [...selectedGroupIds][0];
    const separator = groupId?.indexOf("\u0000") ?? -1;
    const folderId = separator < 0 ? undefined : groupId?.slice(0, separator);
    const groupKey = separator < 0 ? undefined : groupId?.slice(separator + 1);
    const group =
      folderId === undefined || groupKey === undefined
        ? undefined
        : findSnapshotWindow(folderId)?.groups?.find(
            ({ key }) => key === groupKey,
          );
    if (group !== undefined) {
      return {
        entry: { name: group.title ?? "Unnamed group", type: "group" },
        groups: 1,
        tabs: effective.tabIds.size,
      };
    }
  }

  if (directCount === 1 && selectedTabIds.size === 1) {
    const tab = selectedArchiveTabs()[0];
    if (tab !== undefined) {
      return {
        entry: { name: tab.title, type: "tab" },
        tabs: 1,
      };
    }
  }

  const selectedTopLevelGroups = [...selectedWindowIds].filter(
    (folderId) => findSnapshotWindow(folderId)?.entryType === "group",
  ).length;
  return {
    groups: selectedGroupIds.size + selectedTopLevelGroups,
    sessions: effective.sessionIds.size,
    tabs: effective.tabIds.size,
    windows: Math.max(0, effective.windowIds.size - selectedTopLevelGroups),
  };
}

async function runBulkSelectionAction(
  type: "DELETE_ARCHIVE_SELECTION" | "DUPLICATE_ARCHIVE_SELECTION",
  resultKey: "deleted" | "duplicated",
  successMessage: string,
): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage({
      selection: selectionPayload(),
      type,
    })) as Record<string, unknown> | undefined;
    if (typeof response?.[resultKey] !== "number")
      throw new Error("The selected entries could not be updated.");
    clearSelection();
    entryOrder = undefined;
    await refresh(successMessage);
  } catch (error) {
    showStatus(
      errorMessage(error, "The selected entries could not be updated."),
      true,
    );
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function exportArchiveJson(): Promise<void> {
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "EXPORT_ARCHIVES",
    })) as
      | {
          archive?: unknown;
          error?: string;
          formatVersion?: number;
          kind?: string;
          product?: string;
        }
      | undefined;
    if (
      response?.kind !== "htws-archive" ||
      !isSupportedProductName(response.product) ||
      typeof response.formatVersion !== "number" ||
      typeof response.archive !== "object" ||
      response.archive === null
    ) {
      throw new Error(response?.error ?? "The archive could not be exported.");
    }
    downloadJson(response, "htws-archives");
    showStatus("Hibernation archive exported.", false);
  } catch (error) {
    showStatus(errorMessage(error, "The archive export failed."), true);
  } finally {
    setTransferBusy(false);
  }
}

async function importArchiveJson(): Promise<void> {
  const file = archiveImportFile.files?.[0];
  archiveImportFile.value = "";
  if (file === undefined) return;
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      data: await readJsonFile(file),
      type: "IMPORT_ARCHIVES",
    })) as
      | {
          error?: string;
          importedSessions?: number;
          importedTabs?: number;
          importedWindows?: number;
          skippedDuplicates?: number;
        }
      | undefined;
    if (
      typeof response?.importedTabs !== "number" ||
      typeof response.importedWindows !== "number" ||
      typeof response.importedSessions !== "number"
    ) {
      throw new Error(response?.error ?? "The archive could not be imported.");
    }
    entryOrder = undefined;
    await refresh(
      `Imported ${response.importedTabs} tab${response.importedTabs === 1 ? "" : "s"}, ${response.importedWindows} window${response.importedWindows === 1 ? "" : "s"}, and ${response.importedSessions} session${response.importedSessions === 1 ? "" : "s"}.${response.skippedDuplicates ? ` ${response.skippedDuplicates} duplicate${response.skippedDuplicates === 1 ? " was" : "s were"} skipped.` : ""}`,
    );
  } catch (error) {
    showStatus(errorMessage(error, "The archive import failed."), true);
  } finally {
    setTransferBusy(false);
  }
}

function setTransferBusy(busy: boolean): void {
  transferBusy = busy;
  updateTransferControls();
}

function updateTransferControls(): void {
  exportArchives.disabled = transferBusy;
  importArchives.disabled = transferBusy;
  undoArchive.disabled =
    transferBusy || undoArchive.dataset.available !== "true";
  redoArchive.disabled =
    transferBusy || redoArchive.dataset.available !== "true";
  restoreAll.disabled = transferBusy || (currentSnapshot?.tabCount ?? 0) === 0;
  clearArchives.disabled =
    transferBusy || (currentSnapshot?.tabCount ?? 0) === 0;
}

function renderSnapshot(snapshot: ArchiveSnapshot): void {
  captureExpandedState();
  const sortOptions = { sortDirection, sortKey, typePriority } as const;
  entryOrder = reconcileArchiveEntryOrder(snapshot, entryOrder, sortOptions);
  const filtered = filterArchiveSnapshot(snapshot, textFilter.value);
  empty.hidden = filtered.snapshot.tabCount > 0;
  empty.textContent =
    snapshot.tabCount === 0
      ? "Nothing is hibernated. Use the popup or tab-strip menu to save tabs for later."
      : "No hibernated entries match this filter.";
  filterResults.textContent =
    textFilter.value.trim() === ""
      ? `${filtered.totalEntries} ${filtered.totalEntries === 1 ? "entry" : "entries"}`
      : `${filtered.matchCount} ${filtered.matchCount === 1 ? "hit" : "hits"} of ${filtered.totalEntries}`;
  renderArchiveManager(list, filtered.snapshot, actions, {
    dragDrop: {
      onDrop: (source, target, placement) =>
        void dragMove(source, target, placement),
    },
    entryOrder,
    groupOpenState,
    openFirst: !hasRendered,
    openSessionIds,
    openWindowIds,
    selection: {
      groupIds: selectedGroupIds,
      onChange: handleSelectionChange,
      sessionIds: selectedSessionIds,
      tabIds: selectedTabIds,
      windowIds: selectedWindowIds,
    },
    showFullUrl: true,
    sortDirection,
    sortKey,
    tableColumns: true,
    typePriority,
  });
  highlightFilterMatches(textFilter.value, filtered.matches);
  selectMatched.disabled =
    textFilter.value.trim() === "" || filtered.matchCount === 0;
  const allMatchesSelected = areAllMatchesSelected(filtered.matches);
  selectMatched.classList.toggle("is-pressed", allMatchesSelected);
  selectMatched.setAttribute("aria-pressed", String(allMatchesSelected));
  selectMatched.title = allMatchesSelected
    ? "Deselect every directly matched entry"
    : "Select every directly matched entry";
  hasRendered = true;
  updateSelectionControls();
}

async function dragMove(
  source: ArchiveItemReference,
  target: ArchiveItemReference | undefined,
  placement: "after" | "before" | "inside",
): Promise<void> {
  selectionBusy = true;
  updateSelectionControls();
  try {
    const response = (await chrome.runtime.sendMessage({
      placement,
      source,
      ...(target === undefined ? {} : { target }),
      type: "MOVE_ARCHIVE_ITEM",
    })) as { error?: string; movedTabs?: number } | undefined;
    if (typeof response?.movedTabs !== "number")
      throw new Error(
        response?.error ?? "The dragged entry could not be moved.",
      );
    entryOrder = undefined;
    await refresh("Archive item moved.");
  } catch (error) {
    showStatus(
      errorMessage(error, "The dragged entry could not be moved."),
      true,
    );
  } finally {
    selectionBusy = false;
    updateSelectionControls();
  }
}

async function changeHistory(direction: "redo" | "undo"): Promise<void> {
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      type: direction === "undo" ? "UNDO_ARCHIVE" : "REDO_ARCHIVE",
    })) as { changed?: boolean; error?: string; label?: string } | undefined;
    if (response?.changed !== true)
      throw new Error(response?.error ?? `Nothing to ${direction}.`);
    clearSelection();
    entryOrder = undefined;
    await refresh(
      `${direction === "undo" ? "Undid" : "Redid"} ${response.label ?? "archive change"}.`,
    );
  } catch (error) {
    showStatus(
      errorMessage(
        error,
        `The archive change could not be ${direction === "undo" ? "undone" : "redone"}.`,
      ),
      true,
    );
  } finally {
    setTransferBusy(false);
  }
}

async function updateHistoryControls(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_ARCHIVE_HISTORY",
  })) as { redoLabel?: string; undoLabel?: string } | undefined;
  undoArchive.dataset.available = String(response?.undoLabel !== undefined);
  redoArchive.dataset.available = String(response?.redoLabel !== undefined);
  undoArchive.title = response?.undoLabel
    ? `Undo: ${response.undoLabel}`
    : "Nothing to undo";
  redoArchive.title = response?.redoLabel
    ? `Redo: ${response.redoLabel}`
    : "Nothing to redo";
  updateTransferControls();
}

function readDraggedItem(
  transfer: DataTransfer | null,
): ArchiveItemReference | undefined {
  if (transfer === null) return undefined;
  try {
    const item = JSON.parse(
      transfer.getData("application/x-htws-item"),
    ) as Partial<ArchiveItemReference>;
    if (
      typeof item.id === "string" &&
      (item.type === "group" ||
        item.type === "session" ||
        item.type === "window" ||
        item.type === "tab") &&
      (item.type !== "group" || typeof item.groupKey === "string")
    )
      return item as ArchiveItemReference;
  } catch {
    return undefined;
  }
  return undefined;
}

function isArchiveDrag(transfer: DataTransfer | null): boolean {
  return (
    transfer !== null &&
    Array.from(transfer.types).includes("application/x-htws-item")
  );
}

function handleSelectionChange(
  type: "group" | "session" | "tab" | "window",
  id: string,
  selected: boolean,
  range: boolean,
): void {
  const target = { id, type } satisfies ArchiveSelectionReference;
  const entries = range
    ? inclusiveArchiveSelectionRange(
        visibleArchiveSelectionOrder(),
        selectionAnchor,
        target,
      )
    : [target];
  entries.forEach((entry) => setSelectionValue(entry.type, entry.id, selected));
  selectionAnchor = target;
  if (currentSnapshot !== undefined) renderSnapshot(currentSnapshot);
}

function setSelectionValue(
  type: "group" | "session" | "tab" | "window",
  id: string,
  selected: boolean,
): void {
  if (type === "group") {
    if (selected) selectedGroupIds.add(id);
    else selectedGroupIds.delete(id);
    return;
  }
  const selection =
    type === "session"
      ? selectedSessionIds
      : type === "window"
        ? selectedWindowIds
        : selectedTabIds;
  if (selected) selection.add(id);
  else selection.delete(id);
  if (type === "session") {
    const session = currentSnapshot?.sessions.find(
      (candidate) => candidate.sessionId === id,
    );
    session?.windows.forEach((window) => {
      selectedWindowIds.delete(window.folderId);
      window.groups?.forEach((group) =>
        selectedGroupIds.delete(`${window.folderId}\u0000${group.key}`),
      );
      window.tabs.forEach((tab) => selectedTabIds.delete(tab.bookmarkId));
    });
  } else if (type === "window") {
    const window = findSnapshotWindow(id);
    window?.groups?.forEach((group) =>
      selectedGroupIds.delete(`${window.folderId}\u0000${group.key}`),
    );
    window?.tabs.forEach((tab) => selectedTabIds.delete(tab.bookmarkId));
  }
}

function visibleArchiveSelectionOrder(): ArchiveSelectionReference[] {
  return [
    ...list.querySelectorAll<HTMLInputElement>(
      ".archive-selection-cell input[data-selection-id][data-selection-type]",
    ),
  ]
    .filter((checkbox) => checkbox.getClientRects().length > 0)
    .flatMap((checkbox) => {
      const type = checkbox.dataset.selectionType;
      const encodedId = checkbox.dataset.selectionId;
      if (
        encodedId === undefined ||
        (type !== "group" &&
          type !== "session" &&
          type !== "tab" &&
          type !== "window")
      )
        return [];
      return [{ id: decodeURIComponent(encodedId), type }];
    });
}

function selectFilterMatches(): void {
  if (currentSnapshot === undefined || textFilter.value.trim() === "") return;
  selectionAnchor = undefined;
  const matches = filterArchiveSnapshot(
    currentSnapshot,
    textFilter.value,
  ).matches;
  const deselect = areAllMatchesSelected(matches);
  if (deselect) {
    const next = deselectArchiveMatches(
      currentSnapshot,
      selectionSets(),
      matches,
    );
    replaceSelection(next);
  } else {
    const add = (source: Set<string>, target: Set<string>): void =>
      source.forEach((id) => target.add(id));
    add(matches.sessionIds, selectedSessionIds);
    add(matches.windowIds, selectedWindowIds);
    add(matches.tabIds, selectedTabIds);
    add(matches.groupIds, selectedGroupIds);
  }
  renderSnapshot(currentSnapshot);
}

function areAllMatchesSelected(
  matches: ReturnType<typeof filterArchiveSnapshot>["matches"],
): boolean {
  if (currentSnapshot === undefined) return false;
  const effective = effectiveArchiveSelection(currentSnapshot, selectionSets());
  const includesAll = (matches: Set<string>, selected: Set<string>): boolean =>
    [...matches].every((id) => selected.has(id));
  const count =
    matches.sessionIds.size +
    matches.windowIds.size +
    matches.tabIds.size +
    matches.groupIds.size;
  return (
    count > 0 &&
    includesAll(matches.sessionIds, effective.sessionIds) &&
    includesAll(matches.windowIds, effective.windowIds) &&
    includesAll(matches.tabIds, effective.tabIds) &&
    includesAll(matches.groupIds, effective.groupIds)
  );
}

function selectionSets() {
  return {
    groupIds: selectedGroupIds,
    sessionIds: selectedSessionIds,
    tabIds: selectedTabIds,
    windowIds: selectedWindowIds,
  };
}

function replaceSelection(next: ReturnType<typeof selectionSets>): void {
  const replace = (target: Set<string>, source: Set<string>): void => {
    target.clear();
    source.forEach((id) => target.add(id));
  };
  replace(selectedGroupIds, next.groupIds);
  replace(selectedSessionIds, next.sessionIds);
  replace(selectedTabIds, next.tabIds);
  replace(selectedWindowIds, next.windowIds);
}

function highlightFilterMatches(
  rawQuery: string,
  matches: ReturnType<typeof filterArchiveSnapshot>["matches"],
): void {
  const terms = rawQuery
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (terms.length === 0) return;
  list
    .querySelectorAll<HTMLElement>("[data-bookmark-id]")
    .forEach((row) =>
      row.classList.toggle(
        "is-direct-filter-match",
        matches.tabIds.has(row.dataset.bookmarkId ?? ""),
      ),
    );
  list
    .querySelectorAll<HTMLElement>("[data-folder-id]")
    .forEach((row) =>
      row.classList.toggle(
        "is-direct-filter-match",
        matches.windowIds.has(row.dataset.folderId ?? ""),
      ),
    );
  list
    .querySelectorAll<HTMLElement>("[data-session-id]")
    .forEach((row) =>
      row.classList.toggle(
        "is-direct-filter-match",
        matches.sessionIds.has(row.dataset.sessionId ?? ""),
      ),
    );
  list
    .querySelectorAll<HTMLElement>(".archive-group")
    .forEach((row) =>
      row.classList.toggle(
        "is-direct-filter-match",
        matches.groupIds.has(
          `${row.closest<HTMLElement>("[data-folder-id]")?.dataset.folderId ?? ""}\u0000${row.dataset.groupKey ?? ""}`,
        ),
      ),
    );
  const searchableText = list.querySelectorAll<HTMLElement>(
    ".archive-date, .archive-session-title, .archive-window-title, .archive-group-title, .archive-tab-title-line strong, .archive-tab-url, .archive-tab-group-name",
  );
  const nodes: Text[] = [];
  searchableText.forEach((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return terms.some((term) =>
          (node.textContent ?? "").toLocaleLowerCase().includes(term),
        )
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  });
  for (const node of nodes) {
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
    const parts = (node.textContent ?? "").split(pattern);
    if (parts.length < 2) continue;
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (terms.includes(part.toLocaleLowerCase())) {
        const mark = document.createElement("mark");
        mark.className = "archive-search-match";
        mark.textContent = part;
        fragment.append(mark);
      } else fragment.append(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  }
  list
    .querySelectorAll<HTMLElement>(
      ".archive-group-swatch, .archive-tab-group-dot",
    )
    .forEach((dot) => {
      const color = dot.dataset.groupColor?.toLocaleLowerCase() ?? "";
      dot.classList.toggle(
        "archive-search-match-dot",
        terms.some((term) => color.includes(term)),
      );
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function clearSelection(): void {
  selectedGroupIds.clear();
  selectedSessionIds.clear();
  selectedWindowIds.clear();
  selectedTabIds.clear();
  selectionAnchor = undefined;
}

function selectionPayload(): SelectionPayload {
  return {
    groupIds: [...selectedGroupIds],
    sessionIds: [...selectedSessionIds],
    tabIds: [...selectedTabIds],
    windowIds: [...selectedWindowIds],
  };
}

function sanitizeSelection(snapshot: ArchiveSnapshot): void {
  const sessionIds = new Set(
    snapshot.sessions.map((session) => session.sessionId),
  );
  const allWindows = [
    ...snapshot.windows,
    ...snapshot.sessions.flatMap((session) => session.windows),
  ];
  const windowIds = new Set(allWindows.map((window) => window.folderId));
  const tabIds = new Set([
    ...snapshot.tabs.map((tab) => tab.bookmarkId),
    ...allWindows.flatMap((window) => window.tabs.map((tab) => tab.bookmarkId)),
  ]);
  const groupIds = new Set(
    allWindows.flatMap((window) =>
      (window.groups ?? []).map(
        (group) => `${group.folderId}\u0000${group.key}`,
      ),
    ),
  );
  for (const id of selectedGroupIds) {
    if (!groupIds.has(id)) selectedGroupIds.delete(id);
  }
  for (const id of selectedSessionIds) {
    if (!sessionIds.has(id)) selectedSessionIds.delete(id);
  }
  for (const id of selectedWindowIds) {
    if (!windowIds.has(id)) selectedWindowIds.delete(id);
  }
  for (const id of selectedTabIds) {
    if (!tabIds.has(id)) selectedTabIds.delete(id);
  }
}

function updateSelectionControls(): void {
  const snapshot = currentSnapshot;
  if (snapshot === undefined) return;
  let selectedTabs = 0;
  let selectedEntries = 0;
  let canMoveTabsOut = false;
  let canMoveWindowsOut = false;
  for (const session of snapshot.sessions) {
    const sessionSelected = selectedSessionIds.has(session.sessionId);
    if (sessionSelected) selectedEntries += 1;
    for (const window of session.windows) {
      const windowSelected =
        sessionSelected || selectedWindowIds.has(window.folderId);
      if (windowSelected) {
        selectedEntries += 1;
        canMoveWindowsOut = true;
      }
      for (const tab of window.tabs) {
        const groupSelected =
          tab.groupKey !== undefined &&
          selectedGroupIds.has(`${window.folderId}\u0000${tab.groupKey}`);
        if (
          windowSelected ||
          groupSelected ||
          selectedTabIds.has(tab.bookmarkId)
        ) {
          selectedEntries += 1;
          selectedTabs += 1;
          canMoveTabsOut = true;
        }
      }
    }
  }
  for (const window of snapshot.windows) {
    const windowSelected = selectedWindowIds.has(window.folderId);
    if (windowSelected) selectedEntries += 1;
    for (const tab of window.tabs) {
      const groupSelected =
        tab.groupKey !== undefined &&
        selectedGroupIds.has(`${window.folderId}\u0000${tab.groupKey}`);
      if (
        windowSelected ||
        groupSelected ||
        selectedTabIds.has(tab.bookmarkId)
      ) {
        selectedEntries += 1;
        selectedTabs += 1;
        canMoveTabsOut = true;
      }
    }
  }
  for (const tab of snapshot.tabs) {
    if (selectedTabIds.has(tab.bookmarkId)) {
      selectedEntries += 1;
      selectedTabs += 1;
    }
  }
  const topLevelCount =
    snapshot.sessions.length + snapshot.windows.length + snapshot.tabs.length;
  const selectedTopLevel =
    snapshot.sessions.filter((session) =>
      selectedSessionIds.has(session.sessionId),
    ).length +
    snapshot.windows.filter((window) => selectedWindowIds.has(window.folderId))
      .length +
    snapshot.tabs.filter((tab) => selectedTabIds.has(tab.bookmarkId)).length;
  selectAllArchives.checked =
    topLevelCount > 0 && selectedTopLevel === topLevelCount;
  selectAllArchives.indeterminate =
    selectedEntries > 0 && !selectAllArchives.checked;
  selectionSummary.textContent = `${selectedTabs} tab${selectedTabs === 1 ? "" : "s"} selected`;
  const hasTabs = selectedTabs > 0;
  bookmarkSelected.disabled = selectionBusy || selectedEntries === 0;
  restoreSelected.disabled = selectionBusy || selectedEntries === 0;
  mergeSelectedWindow.disabled = selectionBusy || !hasTabs;
  mergeSelectedSession.disabled = selectionBusy || !hasTabs;
  moveTabsOut.disabled = selectionBusy || !canMoveTabsOut;
  moveTabsToGroup.disabled = selectionBusy || !hasTabs;
  ungroupTabs.disabled =
    selectionBusy ||
    !hasTabs ||
    selectedArchiveTabs().every((tab) => tab.groupKey === undefined);
  moveWindowsOut.disabled = selectionBusy || !canMoveWindowsOut;
  clearSelectionButton.disabled = selectionBusy || selectedEntries === 0;
  duplicateSelected.disabled = selectionBusy || selectedEntries === 0;
  deleteSelected.disabled = selectionBusy || selectedEntries === 0;
  mergeSelectedEntries.disabled =
    selectionBusy || selectedArchiveItemReferences().length < 2;
}

function selectedArchiveItemReferences(): ArchiveItemReference[] {
  const references: ArchiveItemReference[] = [];
  list
    .querySelectorAll<HTMLElement>("[data-drag-type][data-drag-id]")
    .forEach((element) => {
      const type = element.dataset.dragType as ArchiveItemReference["type"];
      const id = element.dataset.dragId;
      if (id === undefined) return;
      const groupKey = element.dataset.dragGroupKey;
      const selected =
        type === "session"
          ? selectedSessionIds.has(id)
          : type === "window"
            ? selectedWindowIds.has(id)
            : type === "tab"
              ? selectedTabIds.has(id)
              : selectedGroupIds.has(`${id}\u0000${groupKey ?? ""}`) ||
                (findSnapshotWindow(id)?.entryType === "group" &&
                  selectedWindowIds.has(id));
      if (!selected) return;
      references.push({
        id,
        ...(groupKey === undefined ? {} : { groupKey }),
        type,
      });
    });
  return references;
}

function archiveItemRank(item: ArchiveItemReference): number {
  return { group: 1, session: 3, tab: 0, window: 2 }[item.type];
}

function findSnapshotWindow(folderId: string) {
  return (
    currentSnapshot?.windows.find((window) => window.folderId === folderId) ??
    currentSnapshot?.sessions
      .flatMap((session) => session.windows)
      .find((window) => window.folderId === folderId)
  );
}

function selectedArchiveTabs(): ArchiveTabView[] {
  if (currentSnapshot === undefined) return [];
  const selected = new Map<string, ArchiveTabView>();
  const includeWindow = (window: ArchiveWindowView): void => {
    if (selectedWindowIds.has(window.folderId)) {
      window.tabs.forEach((tab) => selected.set(tab.bookmarkId, tab));
    }
    window.tabs.forEach((tab) => {
      const groupSelected =
        tab.groupKey !== undefined &&
        selectedGroupIds.has(`${window.folderId}\u0000${tab.groupKey}`);
      if (groupSelected || selectedTabIds.has(tab.bookmarkId))
        selected.set(tab.bookmarkId, tab);
    });
  };
  currentSnapshot.tabs.forEach((tab) => {
    if (selectedTabIds.has(tab.bookmarkId)) selected.set(tab.bookmarkId, tab);
  });
  currentSnapshot.windows.forEach(includeWindow);
  currentSnapshot.sessions.forEach((session) => {
    if (selectedSessionIds.has(session.sessionId)) {
      session.windows.forEach((window) =>
        window.tabs.forEach((tab) => selected.set(tab.bookmarkId, tab)),
      );
    } else session.windows.forEach(includeWindow);
  });
  return [...selected.values()];
}

function captureExpandedState(): void {
  if (!hasRendered) return;
  list
    .querySelectorAll<HTMLDetailsElement>(".archive-session")
    .forEach((item) => {
      const id = item.dataset.sessionId;
      if (id === undefined) return;
      if (item.open) openSessionIds.add(id);
      else openSessionIds.delete(id);
    });
  list
    .querySelectorAll<HTMLDetailsElement>(".archive-window")
    .forEach((item) => {
      const id = item.dataset.folderId;
      if (id === undefined) return;
      if (item.open) openWindowIds.add(id);
      else openWindowIds.delete(id);
    });
  list
    .querySelectorAll<HTMLDetailsElement>(".archive-group")
    .forEach((item) => {
      const folderId = item.dataset.folderId;
      const groupKey = item.dataset.groupKey;
      if (folderId === undefined || groupKey === undefined) return;
      groupOpenState.set(`${folderId}\u0000${groupKey}`, item.open);
    });
}

function updateSortHeaders(): void {
  tableHead.classList.toggle("name-sort-active", sortKey === "name");
  sortButtons.forEach((button) => {
    const active = button.dataset.sortKey === sortKey;
    const isType = button.dataset.sortKey === "type";
    button.setAttribute(
      "aria-sort",
      active ? (isType ? "other" : sortDirection) : "none",
    );
    const marker = button.querySelector<HTMLElement>(".sort-indicator");
    if (marker) {
      marker.textContent = "";
      if (active) marker.dataset.direction = sortDirection;
      else delete marker.dataset.direction;
    }
    const typeMarker = button.querySelector<HTMLElement>(".sort-type-marker");
    if (typeMarker) {
      typeMarker.textContent = active ? typeLabel(typePriority) : "";
    }
    if (isType) {
      button.dataset.typePriority = active ? typePriority : "";
      const nextType = nextTypePriority(typePriority);
      button.setAttribute(
        "aria-label",
        active
          ? `Type, ${typeLabel(typePriority)} first. Activate to group ${typeLabel(nextType)} first.`
          : "Sort by type, grouping Sessions first.",
      );
    }
    if (
      button.dataset.sortKey === "bookmarked" ||
      button.dataset.sortKey === "pinned"
    ) {
      button.classList.toggle("is-sort-active", active);
      button.dataset.sortDirection = active ? sortDirection : "";
    }
  });
}

function renderArchiveSummary(snapshot: ArchiveSnapshot): void {
  const tabs = summaryMetric(snapshot.tabCount, "tab");
  const windows = summaryMetric(snapshot.windows.length, "window");
  const sessions = summaryMetric(snapshot.sessions.length, "session");
  summary.replaceChildren(
    tabs,
    document.createTextNode(" - "),
    windows,
    document.createTextNode(" - "),
    sessions,
  );
  summary.setAttribute(
    "aria-label",
    [tabs, windows, sessions].map((metric) => metric.textContent).join(", "),
  );
}

function summaryMetric(
  count: number,
  type: "session" | "tab" | "window",
): HTMLSpanElement {
  const metric = document.createElement("span");
  metric.className = `archive-color-${type}`;
  metric.textContent = `${count} ${type}${count === 1 ? "" : "s"}`;
  return metric;
}

function typeLabel(type: TypePriority): string {
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}s`;
}

function nextTypePriority(current: TypePriority): TypePriority {
  const nextIndex = (typeCycle.indexOf(current) + 1) % typeCycle.length;
  return typeCycle[nextIndex] ?? "session";
}

function scheduleRefresh(): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 100);
}

async function getArchives(): Promise<ArchiveSnapshot> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_ARCHIVES",
  })) as ArchiveSnapshot | { error?: string } | undefined;
  if (
    response === undefined ||
    !Array.isArray((response as Partial<ArchiveSnapshot>).tabs) ||
    !Array.isArray((response as Partial<ArchiveSnapshot>).windows) ||
    !Array.isArray((response as Partial<ArchiveSnapshot>).sessions) ||
    typeof (response as Partial<ArchiveSnapshot>).tabCount !== "number"
  ) {
    throw new Error(
      (response as { error?: string } | undefined)?.error ??
        "The hibernation archive could not be loaded.",
    );
  }
  return response as ArchiveSnapshot;
}

async function requireCount(
  message: Record<string, unknown>,
  field: "deleted" | "restored",
): Promise<number> {
  const response = (await chrome.runtime.sendMessage(message)) as
    { deleted?: number; error?: string; restored?: number } | undefined;
  const count = response?.[field];
  if (count === undefined) {
    throw new Error(response?.error ?? "The archive action failed.");
  }
  return count;
}

function showStatus(message: string, error: boolean): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [role="textbox"]') !== null
  )
    return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "reset", "submit"].includes(
    target.type,
  );
}

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
