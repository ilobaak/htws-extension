import type {
  ArchiveSnapshot,
  ArchiveGroupView,
  ArchiveSessionView,
  ArchiveTabView,
  ArchiveWindowView,
} from "../background/hibernate-archive";
import { isBookmarkableUrl } from "../core/tab-url";
import { GROUP_COLORS } from "./group-colors";
import type { ArchiveDeleteSummary } from "./archive-delete-confirmation";

export interface ArchiveManagerActions {
  confirmDelete(summary: ArchiveDeleteSummary): Promise<boolean>;
  deleteGroup?(folderId: string, groupKey: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteTab(bookmarkId: string): Promise<void>;
  deleteWindow(folderId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  renameTab(bookmarkId: string, name: string): Promise<void>;
  renameWindow(folderId: string, name: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  restoreGroup?(folderId: string, groupKey: string): Promise<void>;
  restoreTab(bookmarkId: string): Promise<void>;
  restoreWindow(folderId: string): Promise<void>;
  showError(message: string): void;
  toggleBookmarkSession(sessionId: string): Promise<void>;
  toggleBookmarkTab(bookmarkId: string): Promise<void>;
  toggleBookmarkWindow(folderId: string): Promise<void>;
  togglePin?(item: ArchiveItemReference): Promise<void>;
  updateGroup?(
    folderId: string,
    groupKey: string,
    title: string | undefined,
    color: `${chrome.tabGroups.Color}`,
  ): Promise<void>;
}

export interface ArchiveManagerOptions {
  dragDrop?: ArchiveManagerDragDrop;
  entryOrder?: readonly string[];
  groupOpenState?: ReadonlyMap<string, boolean>;
  openFirst?: boolean;
  openSessionIds?: ReadonlySet<string>;
  openWindowIds?: ReadonlySet<string>;
  selection?: ArchiveManagerSelection;
  showFullUrl?: boolean;
  showRename?: boolean;
  sortDirection?: "ascending" | "descending";
  sortKey?: "bookmarked" | "date" | "name" | "pinned" | "type";
  tableColumns?: boolean;
  typePriority?: "group" | "session" | "tab" | "window";
}

export interface ArchiveItemReference {
  collapsed?: boolean;
  groupKey?: string;
  id: string;
  type: "group" | "session" | "tab" | "window";
}

export interface ArchiveManagerDragDrop {
  onDrop(
    source: ArchiveItemReference,
    target: ArchiveItemReference,
    placement: "after" | "before" | "inside",
  ): void;
}

export interface ArchiveManagerSelection {
  onChange(
    type: "group" | "session" | "tab" | "window",
    id: string,
    selected: boolean,
    range: boolean,
  ): void;
  groupIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
  tabIds: ReadonlySet<string>;
  windowIds: ReadonlySet<string>;
}

type ArchiveEntry =
  | { createdAt: number; session: ArchiveSessionView }
  | { createdAt: number; tab: ArchiveTabView }
  | { createdAt: number; window: ArchiveWindowView };

type ArchiveActionIcon = "bookmark" | "erase" | "rename" | "restore";

export function renderArchiveManager(
  container: HTMLElement,
  snapshot: ArchiveSnapshot,
  actions: ArchiveManagerActions,
  options: ArchiveManagerOptions = {},
): void {
  container.replaceChildren();
  const entries = orderedEntries(snapshot, options);
  let openedWindow = false;
  for (const entry of entries) {
    if ("session" in entry) {
      const shouldOpen: boolean =
        options.openSessionIds?.has(entry.session.sessionId) === true ||
        (options.openFirst === true && !openedWindow);
      container.append(
        createArchiveSession(
          entry.session,
          actions,
          shouldOpen,
          options.showFullUrl === true,
          options.tableColumns === true,
          options.showRename !== false,
          options.groupOpenState,
          options.openWindowIds,
          options.selection,
          options.dragDrop,
        ),
      );
      openedWindow ||= shouldOpen;
      continue;
    }
    if ("tab" in entry) {
      container.append(
        createArchiveTab(
          entry.tab,
          actions,
          options.showFullUrl === true,
          true,
          options.tableColumns === true,
          options.showRename !== false,
          options.selection,
          false,
          options.dragDrop,
        ),
      );
      continue;
    }
    const shouldOpen: boolean =
      options.openWindowIds?.has(entry.window.folderId) === true ||
      (options.openFirst === true && !openedWindow);
    container.append(
      createArchiveWindow(
        entry.window,
        actions,
        shouldOpen,
        options.showFullUrl === true,
        options.tableColumns === true,
        options.showRename !== false,
        false,
        options.groupOpenState,
        options.selection,
        false,
        options.dragDrop,
      ),
    );
    openedWindow ||= shouldOpen;
  }
}

export function getArchiveEntryOrder(
  snapshot: ArchiveSnapshot,
  options: ArchiveManagerOptions = {},
): string[] {
  const sortOptions = { ...options };
  delete sortOptions.entryOrder;
  return orderedEntries(snapshot, sortOptions).map(archiveEntryId);
}

export function reconcileArchiveEntryOrder(
  snapshot: ArchiveSnapshot,
  currentOrder: readonly string[] | undefined,
  options: ArchiveManagerOptions = {},
): string[] {
  const sortedOrder = getArchiveEntryOrder(snapshot, options);
  if (currentOrder === undefined) return sortedOrder;
  const currentIds = new Set(currentOrder);
  if (
    currentOrder.length !== sortedOrder.length ||
    sortedOrder.some((id) => !currentIds.has(id))
  ) {
    return sortedOrder;
  }
  return [...currentOrder];
}

function createArchiveSession(
  session: ArchiveSessionView,
  actions: ArchiveManagerActions,
  open: boolean,
  showFullUrl: boolean,
  tableColumns: boolean,
  showRename: boolean,
  groupOpenState?: ReadonlyMap<string, boolean>,
  openWindowIds?: ReadonlySet<string>,
  selection?: ArchiveManagerSelection,
  dragDrop?: ArchiveManagerDragDrop,
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "archive-session";
  details.dataset.sessionId = session.sessionId;
  const selected = selection?.sessionIds.has(session.sessionId) === true;
  details.classList.toggle("is-selected", selected);
  setSortData(
    details,
    session.createdAt,
    session.name ?? "Session",
    session.bookmarked,
    session.archivePinned,
    "session",
  );
  details.open = open;
  const summary = document.createElement("summary");
  attachDragDrop(
    summary,
    { id: session.sessionId, type: "session" },
    dragDrop,
    details,
  );
  attachRowSelection(
    summary,
    "session",
    session.sessionId,
    selected,
    false,
    selection,
  );
  const chevron = document.createElement("span");
  chevron.className = "archive-chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  title.className = "archive-session-title";
  title.textContent = tableColumns
    ? (session.name ?? "Session")
    : session.title;
  title.title = title.textContent;
  const tabCount = session.windows.reduce(
    (total, window) => total + window.tabs.length,
    0,
  );
  const count = document.createElement("span");
  count.className = "archive-window-count";
  count.textContent = `${session.windows.length} window${session.windows.length === 1 ? "" : "s"}, ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
  const actionBar = document.createElement("div");
  actionBar.className = "archive-session-actions";
  actionBar.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const rename = actionButton("rename", "rename");
  rename.setAttribute("aria-label", "Rename session");
  rename.addEventListener("click", () => {
    const name = globalThis.prompt(
      "Name this hibernated session",
      session.name ?? "",
    );
    if (name === null) return;
    void runAction(rename, "Renaming…", "Rename session", () =>
      actions.renameSession(session.sessionId, name),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const restore = actionButton("Restore session", "restore");
  restore.addEventListener("click", () => {
    void runAction(restore, "Restoring…", "Restore session", () =>
      actions.restoreSession(session.sessionId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const nameRestore = nameRestoreTarget(
    title,
    "Restore session",
    () => actions.restoreSession(session.sessionId),
    actions,
  );
  const erase = actionButton("Erase session", "erase", "danger-action");
  erase.addEventListener("click", () => {
    runConfirmedDelete(
      erase,
      {
        entry: { name: session.name ?? "Session", type: "session" },
        sessions: 1,
        tabs: tabCount,
        windows: session.windows.length,
      },
      "Erase session",
      () => actions.deleteSession(session.sessionId),
      actions,
    );
  });
  const bookmarkLabel = session.bookmarked
    ? "Remove session bookmarks"
    : "Bookmark session";
  const bookmark = actionButton(
    bookmarkLabel,
    "bookmark",
    "bookmark-action",
    session.bookmarked === true,
  );
  bookmark.addEventListener("click", () => {
    void runAction(bookmark, "Updating…", bookmarkLabel, () =>
      actions.toggleBookmarkSession(session.sessionId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const canBookmark = session.windows.some((window) =>
    window.tabs.some(canBookmarkTab),
  );
  if (showRename) actionBar.append(rename);
  actionBar.append(restore, erase);
  if (tableColumns) {
    const nameCell = document.createElement("div");
    nameCell.className = "archive-name-cell";
    nameCell.append(chevron, nameRestore, count);
    summary.append(
      createSelectionCell(
        "session",
        session.sessionId,
        session.name ?? "Session",
        selected,
        false,
        selection,
      ),
      createDateCell(session.createdAt, summary, dragDrop !== undefined),
      nameCell,
      actionBar,
      createTypeCell("Session"),
      createBookmarkCell(canBookmark ? bookmark : undefined),
      createPinCell(
        session.archivePinned === true,
        { id: session.sessionId, type: "session" },
        actions,
      ),
    );
  } else {
    if (canBookmark) actionBar.append(bookmark);
    summary.append(chevron, nameRestore, count, actionBar);
  }
  details.append(summary);
  const windows = document.createElement("div");
  windows.className = "archive-session-windows";
  pinnedFirst(session.windows).forEach((window) =>
    windows.append(
      createArchiveWindow(
        window,
        actions,
        openWindowIds?.has(window.folderId) === true,
        showFullUrl,
        tableColumns,
        showRename,
        true,
        groupOpenState,
        selection,
        selected,
        dragDrop,
      ),
    ),
  );
  details.append(windows);
  return details;
}

function createArchiveWindow(
  window: ArchiveWindowView,
  actions: ArchiveManagerActions,
  open: boolean,
  showFullUrl: boolean,
  tableColumns: boolean,
  showRename: boolean,
  nestedInSession = false,
  groupOpenState?: ReadonlyMap<string, boolean>,
  selection?: ArchiveManagerSelection,
  ancestorSelected = false,
  dragDrop?: ArchiveManagerDragDrop,
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "archive-window";
  const isGroupEntry = window.entryType === "group";
  const topLevelGroup = isGroupEntry ? window.groups?.[0] : undefined;
  details.classList.toggle("archive-window--group", isGroupEntry);
  if (topLevelGroup !== undefined) {
    details.dataset.groupColor = topLevelGroup.color;
  }
  details.classList.toggle("archive-window--session-child", nestedInSession);
  details.dataset.folderId = window.folderId;
  const selected =
    ancestorSelected || selection?.windowIds.has(window.folderId) === true;
  details.classList.toggle("is-selected", selected);
  setSortData(
    details,
    window.createdAt,
    window.name ?? (isGroupEntry ? "Group" : "Window"),
    window.bookmarked,
    window.archivePinned,
    isGroupEntry ? "group" : "window",
  );
  details.open = open;
  const summary = document.createElement("summary");
  attachDragDrop(
    summary,
    topLevelGroup === undefined
      ? { id: window.folderId, type: "window" }
      : {
          groupKey: topLevelGroup.key,
          id: window.folderId,
          type: "group",
        },
    dragDrop,
    details,
  );
  attachRowSelection(
    summary,
    "window",
    window.folderId,
    selected,
    ancestorSelected,
    selection,
  );
  const chevron = document.createElement("span");
  chevron.className = "archive-chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  title.className = "archive-window-title";
  const windowLabel = tableColumns
    ? (window.name ?? (isGroupEntry ? "Group" : "Window"))
    : windowTitleWithoutTabCount(window.title);
  title.textContent = windowLabel;
  title.title = windowLabel;
  const count = document.createElement("span");
  count.className = "archive-window-count";
  count.textContent = `${window.tabs.length} tab${window.tabs.length === 1 ? "" : "s"}`;
  const privateIndicator = window.incognito
    ? createPrivateIndicator("Private window")
    : undefined;

  const windowActions = document.createElement("div");
  windowActions.className = "archive-window-actions";
  windowActions.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const rename = actionButton("rename", "rename");
  rename.setAttribute(
    "aria-label",
    isGroupEntry ? "Rename group" : "Rename window",
  );
  rename.addEventListener("click", () => {
    const name = globalThis.prompt(
      isGroupEntry
        ? "Name this hibernated group"
        : "Name this hibernated window",
      window.name ?? "",
    );
    if (name === null) return;
    void runAction(rename, "Renaming…", "Rename", () =>
      actions.renameWindow(window.folderId, name),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const restore = actionButton(
    isGroupEntry ? "Restore group" : "Restore window",
    "restore",
  );
  restore.addEventListener("click", () => {
    void runAction(restore, "Restoring…", "Restore window", () =>
      actions.restoreWindow(window.folderId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const nameRestore = nameRestoreTarget(
    title,
    isGroupEntry ? "Restore group" : "Restore window",
    () => actions.restoreWindow(window.folderId),
    actions,
  );
  const bookmarkLabel = window.bookmarked ? "Remove bookmark" : "Bookmark";
  const bookmark = actionButton(
    bookmarkLabel,
    "bookmark",
    "bookmark-action",
    window.bookmarked === true,
  );
  bookmark.addEventListener("click", () => {
    void runAction(
      bookmark,
      window.bookmarked ? "Removing…" : "Saving…",
      bookmarkLabel,
      () => actions.toggleBookmarkWindow(window.folderId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const canBookmark = window.tabs.some(canBookmarkTab);
  const erase = actionButton(
    isGroupEntry ? "Erase group" : "Erase window",
    "erase",
    "danger-action",
  );
  erase.addEventListener("click", () => {
    runConfirmedDelete(
      erase,
      isGroupEntry
        ? {
            entry: { name: windowLabel, type: "group" },
            groups: 1,
            tabs: window.tabs.length,
          }
        : {
            entry: { name: windowLabel, type: "window" },
            tabs: window.tabs.length,
            windows: 1,
          },
      isGroupEntry ? "Erase group" : "Erase window",
      () => actions.deleteWindow(window.folderId),
      actions,
    );
  });
  if (topLevelGroup !== undefined && actions.updateGroup !== undefined) {
    windowActions.append(createGroupColorPicker(topLevelGroup, actions));
  }
  if (showRename) windowActions.append(rename);
  windowActions.append(restore, erase);
  if (tableColumns) {
    const nameCell = document.createElement("div");
    nameCell.className = "archive-name-cell";
    nameCell.append(chevron);
    if (topLevelGroup !== undefined) {
      const swatch = document.createElement("span");
      swatch.className = "archive-group-swatch";
      swatch.dataset.groupColor = topLevelGroup.color;
      swatch.title = capitalize(topLevelGroup.color);
      swatch.setAttribute("aria-hidden", "true");
      nameCell.append(swatch);
    }
    nameCell.append(nameRestore, count);
    if (privateIndicator) nameCell.append(privateIndicator);
    summary.append(
      createSelectionCell(
        "window",
        window.folderId,
        window.name ?? (isGroupEntry ? "Group" : "Window"),
        selected,
        ancestorSelected,
        selection,
      ),
      createDateCell(window.createdAt, summary, dragDrop !== undefined),
      nameCell,
      windowActions,
      createTypeCell(isGroupEntry ? "Group" : "Window"),
      createBookmarkCell(canBookmark ? bookmark : undefined),
      createPinCell(
        window.archivePinned === true,
        topLevelGroup === undefined
          ? { id: window.folderId, type: "window" }
          : {
              groupKey: topLevelGroup.key,
              id: window.folderId,
              type: "group",
            },
        actions,
      ),
    );
  } else {
    if (canBookmark) windowActions.append(bookmark);
    windowActions.append(erase);
    summary.append(chevron, nameRestore, count);
    if (privateIndicator) summary.append(privateIndicator);
    summary.append(windowActions);
  }
  details.append(summary);

  const list = document.createElement("div");
  list.className = "archive-tabs";
  const groupedTabIds = new Set(
    (window.groups ?? []).flatMap((group) =>
      group.tabs.map((tab) => tab.bookmarkId),
    ),
  );
  if (!isGroupEntry) {
    pinnedFirst(window.groups ?? []).forEach((group) =>
      list.append(
        createArchiveGroupRow(
          group,
          actions,
          showFullUrl,
          tableColumns,
          showRename,
          groupOpenState,
          selection,
          selected,
          dragDrop,
        ),
      ),
    );
    attachScopeDropZone(
      list,
      { id: window.folderId, type: "window" },
      dragDrop,
    );
  }
  pinnedFirst(
    window.tabs.filter(
      (tab) => isGroupEntry || !groupedTabIds.has(tab.bookmarkId),
    ),
  ).forEach((tab) =>
    list.append(
      createArchiveTab(
        tab,
        actions,
        showFullUrl,
        false,
        tableColumns,
        showRename,
        selection,
        selected,
        dragDrop,
      ),
    ),
  );
  details.append(list);
  return details;
}

function createArchiveGroupRow(
  group: ArchiveGroupView,
  actions: ArchiveManagerActions,
  showFullUrl: boolean,
  tableColumns: boolean,
  showRename: boolean,
  groupOpenState?: ReadonlyMap<string, boolean>,
  selection?: ArchiveManagerSelection,
  ancestorSelected = false,
  dragDrop?: ArchiveManagerDragDrop,
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "archive-group";
  details.dataset.groupColor = group.color;
  details.dataset.groupKey = group.key;
  details.dataset.folderId = group.folderId;
  const groupId = `${group.folderId}\u0000${group.key}`;
  details.open = groupOpenState?.get(groupId) ?? !group.collapsed;
  const selected =
    ancestorSelected || selection?.groupIds.has(groupId) === true;
  details.classList.toggle("is-selected", selected);
  setSortData(
    details,
    group.tabs[0]?.createdAt ?? 0,
    group.title ?? "Unnamed group",
    undefined,
    group.archivePinned,
    "group",
  );
  const summary = document.createElement("summary");
  attachDragDrop(
    summary,
    { groupKey: group.key, id: group.folderId, type: "group" },
    dragDrop,
    details,
  );
  attachRowSelection(
    summary,
    "group",
    groupId,
    selected,
    ancestorSelected,
    selection,
  );
  const chevron = document.createElement("span");
  chevron.className = "archive-chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  const swatch = document.createElement("span");
  swatch.className = "archive-group-swatch";
  swatch.dataset.groupColor = group.color;
  swatch.title = capitalize(group.color);
  swatch.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  title.className = "archive-group-title";
  title.textContent = group.title ?? "Unnamed group";
  title.title = title.textContent;
  const count = document.createElement("span");
  count.className = "archive-window-count";
  count.textContent = `${group.tabs.length} tab${group.tabs.length === 1 ? "" : "s"}`;
  const nameCell = document.createElement("div");
  nameCell.className = "archive-name-cell";
  nameCell.append(chevron, swatch, title, count);
  const actionBar = document.createElement("div");
  actionBar.className = "archive-group-actions";
  actionBar.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  if (actions.updateGroup !== undefined) {
    const rename = actionButton("rename", "rename");
    rename.setAttribute("aria-label", "Rename group");
    rename.addEventListener("click", () => {
      const next = globalThis.prompt(
        "Name this hibernated group",
        group.title ?? "",
      );
      if (next === null) return;
      void runAction(rename, "Renaming…", "Rename group", () =>
        actions.updateGroup!(group.folderId, group.key, next, group.color),
      ).catch((error) => actions.showError(errorMessage(error)));
    });
    const color = createGroupColorPicker(group, actions);
    actionBar.append(color);
    if (showRename) actionBar.append(rename);
  }
  if (actions.restoreGroup !== undefined) {
    const restore = actionButton("Restore group", "restore");
    restore.addEventListener("click", () => {
      void runAction(restore, "Restoring…", "Restore group", () =>
        actions.restoreGroup!(group.folderId, group.key),
      ).catch((error) => actions.showError(errorMessage(error)));
    });
    actionBar.append(restore);
    nameCell.insertBefore(
      nameRestoreTarget(
        title,
        "Restore group",
        () => actions.restoreGroup!(group.folderId, group.key),
        actions,
      ),
      count,
    );
  }
  if (actions.deleteGroup !== undefined) {
    const erase = actionButton("Erase group", "erase", "danger-action");
    erase.addEventListener("click", () => {
      runConfirmedDelete(
        erase,
        {
          entry: {
            name: group.title ?? "Unnamed group",
            type: "group",
          },
          groups: 1,
          tabs: group.tabs.length,
        },
        "Erase group",
        () => actions.deleteGroup!(group.folderId, group.key),
        actions,
      );
    });
    actionBar.append(erase);
  }
  if (tableColumns) {
    summary.append(
      createSelectionCell(
        "group",
        groupId,
        group.title ?? "Unnamed group",
        selected,
        ancestorSelected,
        selection,
      ),
      createDateCell(
        group.tabs[0]?.createdAt ?? 0,
        summary,
        dragDrop !== undefined,
      ),
      nameCell,
      actionBar,
      createTypeCell("Group"),
      createBookmarkCell(undefined),
      createPinCell(
        group.archivePinned === true,
        { groupKey: group.key, id: group.folderId, type: "group" },
        actions,
      ),
    );
  } else {
    summary.append(nameCell, actionBar);
  }
  details.append(summary);
  const list = document.createElement("div");
  list.className = "archive-group-tabs";
  pinnedFirst(group.tabs).forEach((tab) =>
    list.append(
      createArchiveTab(
        tab,
        actions,
        showFullUrl,
        false,
        tableColumns,
        showRename,
        selection,
        selected,
        dragDrop,
      ),
    ),
  );
  details.append(list);
  return details;
}

function createGroupColorPicker(
  group: ArchiveGroupView,
  actions: ArchiveManagerActions,
): HTMLDetailsElement {
  const picker = document.createElement("details");
  picker.className = "archive-group-color-dropdown";
  picker.addEventListener("click", (event) => event.stopPropagation());
  const trigger = document.createElement("summary");
  trigger.className = "archive-group-color-trigger";
  trigger.setAttribute(
    "aria-label",
    `Change color for ${group.title ?? "group"}`,
  );
  trigger.title = "Change group color";
  const current = document.createElement("span");
  current.className = "archive-group-color-current";
  current.dataset.groupColor = group.color;
  current.setAttribute("aria-hidden", "true");
  trigger.append(current);
  const menu = document.createElement("div");
  menu.className = "archive-group-color-menu";
  menu.setAttribute("role", "radiogroup");
  menu.setAttribute("aria-label", `Color for ${group.title ?? "group"}`);
  for (const value of GROUP_COLORS) {
    const choice = document.createElement("button");
    choice.className = "archive-group-color-choice";
    choice.dataset.groupColor = value;
    choice.type = "button";
    choice.title = capitalize(value);
    choice.setAttribute("aria-label", capitalize(value));
    choice.setAttribute("aria-checked", String(value === group.color));
    choice.setAttribute("role", "radio");
    choice.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (value === group.color) return;
      const choices = [
        ...menu.querySelectorAll<HTMLButtonElement>(
          ".archive-group-color-choice",
        ),
      ];
      choices.forEach((button) => (button.disabled = true));
      current.dataset.groupColor = value;
      choices.forEach((button) =>
        button.setAttribute(
          "aria-checked",
          String(button.dataset.groupColor === value),
        ),
      );
      try {
        await actions.updateGroup!(
          group.folderId,
          group.key,
          group.title?.trim() || undefined,
          value,
        );
        picker.open = false;
      } catch (error) {
        current.dataset.groupColor = group.color;
        choices.forEach((button) =>
          button.setAttribute(
            "aria-checked",
            String(button.dataset.groupColor === group.color),
          ),
        );
        actions.showError(errorMessage(error));
      } finally {
        choices.forEach((button) => (button.disabled = false));
      }
    });
    menu.append(choice);
  }
  picker.addEventListener("toggle", () => {
    if (picker.open) positionGroupColorMenu(trigger, menu);
  });
  picker.append(trigger, menu);
  return picker;
}

function positionGroupColorMenu(trigger: HTMLElement, menu: HTMLElement): void {
  const gap = 5;
  const viewportPadding = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right - menuRect.width),
    globalThis.innerWidth - menuRect.width - viewportPadding,
  );
  const below = triggerRect.bottom + gap;
  const top =
    below + menuRect.height <= globalThis.innerHeight - viewportPadding
      ? below
      : Math.max(viewportPadding, triggerRect.top - menuRect.height - gap);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function createArchiveTab(
  tab: ArchiveTabView,
  actions: ArchiveManagerActions,
  showFullUrl: boolean,
  standalone = false,
  tableColumns = false,
  showRename = true,
  selection?: ArchiveManagerSelection,
  ancestorSelected = false,
  dragDrop?: ArchiveManagerDragDrop,
): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "archive-tab";
  item.dataset.bookmarkId = tab.bookmarkId;
  attachDragDrop(item, { id: tab.bookmarkId, type: "tab" }, dragDrop);
  const selected =
    ancestorSelected || selection?.tabIds.has(tab.bookmarkId) === true;
  attachRowSelection(
    item,
    "tab",
    tab.bookmarkId,
    selected,
    ancestorSelected,
    selection,
  );
  item.classList.toggle("is-selected", selected);
  setSortData(
    item,
    tab.createdAt,
    tab.title,
    tab.bookmarked,
    tab.archivePinned,
    "tab",
  );
  item.classList.toggle("archive-tab--standalone", standalone);
  const copy = document.createElement("div");
  copy.className = "archive-tab-copy";
  const title = document.createElement("strong");
  title.textContent = tab.title;
  title.title = tab.title;
  const titleLine = document.createElement("div");
  titleLine.className = "archive-tab-title-line";
  titleLine.append(
    nameRestoreTarget(
      title,
      `Restore ${tab.title}`,
      () => actions.restoreTab(tab.bookmarkId),
      actions,
    ),
  );
  if (tab.incognito) titleLine.append(createPrivateIndicator("Private tab"));
  const url = document.createElement("small");
  url.className = "archive-tab-url";
  url.textContent = showFullUrl ? tab.url : displayHost(tab.url);
  url.title = tab.url;
  makeTextSelectable(url, item, dragDrop !== undefined);
  url.addEventListener("click", (event) => event.stopPropagation());
  copy.append(titleLine, url);
  if (
    tab.pinned ||
    tab.groupTitle !== undefined ||
    tab.groupColor !== undefined
  ) {
    const meta = document.createElement("div");
    meta.className = "archive-tab-meta";
    if (tab.pinned) meta.append(document.createTextNode("Pinned"));
    if (tab.groupTitle !== undefined || tab.groupColor !== undefined) {
      if (tab.pinned) meta.append(document.createTextNode(" - "));
      meta.append(document.createTextNode("Group: "));
      if (tab.groupColor !== undefined) {
        const dot = document.createElement("span");
        dot.className = "archive-tab-group-dot";
        dot.dataset.groupColor = tab.groupColor;
        dot.title = capitalize(tab.groupColor);
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", `${capitalize(tab.groupColor)} group`);
        meta.append(dot);
      }
      if (tab.groupTitle !== undefined) {
        if (tab.groupColor !== undefined)
          meta.append(document.createTextNode(" "));
        const groupName = document.createElement("span");
        groupName.className = "archive-tab-group-name";
        groupName.textContent = `“${tab.groupTitle}”`;
        meta.append(groupName);
      }
    }
    copy.append(meta);
  }

  const tabActions = document.createElement("div");
  tabActions.className = "archive-tab-actions";
  const rename = actionButton("rename", "rename");
  rename.setAttribute("aria-label", `Rename ${tab.title}`);
  rename.addEventListener("click", () => {
    const name = globalThis.prompt("Name this hibernated tab", tab.title);
    if (name === null) return;
    void runAction(rename, "Renaming…", "Rename tab", () =>
      actions.renameTab(tab.bookmarkId, name),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const restore = actionButton("Restore", "restore");
  restore.setAttribute("aria-label", `Restore ${tab.title}`);
  restore.addEventListener("click", () => {
    void runAction(restore, "Restoring…", "Restore", () =>
      actions.restoreTab(tab.bookmarkId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const bookmarkLabel = tab.bookmarked ? "Remove bookmark" : "Bookmark";
  const bookmark = actionButton(
    bookmarkLabel,
    "bookmark",
    "bookmark-action",
    tab.bookmarked === true,
  );
  bookmark.setAttribute("aria-label", `${bookmarkLabel} ${tab.title}`);
  bookmark.addEventListener("click", () => {
    void runAction(
      bookmark,
      tab.bookmarked ? "Removing…" : "Saving…",
      bookmarkLabel,
      () => actions.toggleBookmarkTab(tab.bookmarkId),
    ).catch((error) => actions.showError(errorMessage(error)));
  });
  const canBookmark = canBookmarkTab(tab);
  const erase = actionButton("Erase", "erase", "danger-action");
  erase.setAttribute("aria-label", `Erase ${tab.title}`);
  erase.addEventListener("click", () => {
    runConfirmedDelete(
      erase,
      { entry: { name: tab.title, type: "tab" }, tabs: 1 },
      "Erase",
      () => actions.deleteTab(tab.bookmarkId),
      actions,
    );
  });
  if (showRename) tabActions.append(rename);
  tabActions.append(restore, erase);
  if (tableColumns) {
    item.append(
      createSelectionCell(
        "tab",
        tab.bookmarkId,
        tab.title,
        selected,
        ancestorSelected,
        selection,
      ),
      createDateCell(tab.createdAt, item, dragDrop !== undefined),
      copy,
      tabActions,
      createTypeCell("Tab"),
      createBookmarkCell(canBookmark ? bookmark : undefined),
      createPinCell(
        tab.archivePinned === true,
        { id: tab.bookmarkId, type: "tab" },
        actions,
      ),
    );
  } else {
    if (canBookmark) tabActions.append(bookmark);
    tabActions.append(erase);
    item.append(copy, tabActions);
  }
  return item;
}

function canBookmarkTab(tab: ArchiveTabView): boolean {
  return tab.incognito !== true && isBookmarkableUrl(tab.url);
}

function createPrivateIndicator(label: string): HTMLSpanElement {
  const indicator = document.createElement("span");
  indicator.className = "archive-private-badge";
  indicator.textContent = "Private";
  indicator.title = `${label}. It will restore in a private/incognito window.`;
  indicator.setAttribute("aria-label", indicator.title);
  return indicator;
}

function makeTextSelectable(
  text: HTMLElement,
  draggableItem: HTMLElement,
  usesDragDrop: boolean,
): void {
  if (!usesDragDrop) return;
  text.addEventListener("pointerdown", () => {
    draggableItem.draggable = false;
    const restoreDragging = (): void => {
      draggableItem.draggable = true;
      globalThis.removeEventListener("pointerup", restoreDragging);
      globalThis.removeEventListener("pointercancel", restoreDragging);
    };
    globalThis.addEventListener("pointerup", restoreDragging);
    globalThis.addEventListener("pointercancel", restoreDragging);
  });
}

function attachDragDrop(
  element: HTMLElement,
  item: ArchiveItemReference,
  dragDrop: ArchiveManagerDragDrop | undefined,
  visualElement: HTMLElement = element,
): void {
  if (dragDrop === undefined) return;
  element.draggable = true;
  element.dataset.dragType = item.type;
  element.dataset.dragId = item.id;
  if (item.groupKey !== undefined) element.dataset.dragGroupKey = item.groupKey;
  element.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    visualElement.classList.add("is-dragging");
    const transferItem =
      item.type === "group" && visualElement.tagName === "DETAILS"
        ? { ...item, collapsed: !(visualElement as HTMLDetailsElement).open }
        : item;
    event.dataTransfer?.setData(
      "application/x-htws-item",
      JSON.stringify(transferItem),
    );
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  element.addEventListener("dragend", () => {
    visualElement.classList.remove("is-dragging");
    clearDropClasses();
  });
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const placement = dropPlacement(element, event.clientY);
    clearDropClasses();
    visualElement.classList.add(`drop-${placement}`);
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  element.addEventListener("dragleave", (event) => {
    if (
      event.relatedTarget instanceof Node &&
      element.contains(event.relatedTarget)
    )
      return;
    visualElement.classList.remove("drop-before", "drop-inside", "drop-after");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const source = readDraggedItem(event.dataTransfer);
    const placement = dropPlacement(element, event.clientY);
    clearDropClasses();
    if (
      source === undefined ||
      (source.type === item.type &&
        source.id === item.id &&
        source.groupKey === item.groupKey)
    )
      return;
    dragDrop.onDrop(source, item, placement);
  });
}

function attachScopeDropZone(
  element: HTMLElement,
  target: ArchiveItemReference,
  dragDrop: ArchiveManagerDragDrop | undefined,
): void {
  if (dragDrop === undefined) return;
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDropClasses();
    element.classList.add("drop-inside");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  element.addEventListener("dragleave", (event) => {
    if (
      event.relatedTarget instanceof Node &&
      element.contains(event.relatedTarget)
    )
      return;
    element.classList.remove("drop-inside");
  });
  element.addEventListener("drop", (event) => {
    const source = readDraggedItem(event.dataTransfer);
    if (source === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropClasses();
    dragDrop.onDrop(source, target, "inside");
  });
}

function dropPlacement(
  element: HTMLElement,
  clientY: number,
): "after" | "before" | "inside" {
  const rect = element.getBoundingClientRect();
  const position = (clientY - rect.top) / Math.max(rect.height, 1);
  if (position < 0.25) return "before";
  if (position > 0.75) return "after";
  return "inside";
}

function readDraggedItem(
  transfer: DataTransfer | null,
): ArchiveItemReference | undefined {
  if (transfer === null) return undefined;
  try {
    const value = JSON.parse(
      transfer.getData("application/x-htws-item"),
    ) as Partial<ArchiveItemReference>;
    if (
      typeof value.id === "string" &&
      (value.type === "group" ||
        value.type === "session" ||
        value.type === "window" ||
        value.type === "tab") &&
      (value.type !== "group" || typeof value.groupKey === "string")
    ) {
      return value as ArchiveItemReference;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function clearDropClasses(): void {
  document
    .querySelector(".hibernated-shell")
    ?.classList.remove("is-page-drop-target");
  document
    .querySelectorAll(".drop-before, .drop-inside, .drop-after")
    .forEach((element) =>
      element.classList.remove("drop-before", "drop-inside", "drop-after"),
    );
}

function createSelectionCell(
  type: "group" | "session" | "tab" | "window",
  id: string,
  label: string,
  selected: boolean,
  disabled: boolean,
  selection: ArchiveManagerSelection | undefined,
): HTMLLabelElement {
  const cell = document.createElement("label");
  cell.className = "archive-selection-cell";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected;
  checkbox.disabled = disabled || selection === undefined;
  checkbox.dataset.selectionId = encodeURIComponent(id);
  checkbox.dataset.selectionType = type;
  checkbox.setAttribute("aria-label", `Select ${type} ${label}`);
  checkbox.addEventListener("click", (event) => {
    selection?.onChange(type, id, checkbox.checked, event.shiftKey);
  });
  cell.addEventListener("click", (event) => event.stopPropagation());
  cell.append(checkbox);
  return cell;
}

function attachRowSelection(
  element: HTMLElement,
  type: "group" | "session" | "tab" | "window",
  id: string,
  selected: boolean,
  disabled: boolean,
  selection: ArchiveManagerSelection | undefined,
): void {
  if (selection === undefined || disabled) return;
  element.classList.add("archive-row-selectable");
  element.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest(".archive-chevron") !== null) return;
    if (
      event.target.closest(
        "a, button, input, label, select, textarea, [role='button'], [contenteditable='true'], .archive-date, .archive-tab-url",
      ) !== null
    )
      return;
    if (element.tagName === "SUMMARY") event.preventDefault();
    selection.onChange(type, id, !selected, event.shiftKey);
  });
}

function createDateCell(
  timestamp: number,
  draggableItem: HTMLElement,
  usesDragDrop: boolean,
): HTMLDivElement {
  const date = new Date(timestamp);
  const cell = document.createElement("div");
  cell.className = "archive-date-cell";
  const time = document.createElement("time");
  time.className = "archive-date";
  time.dateTime = date.toISOString();
  time.textContent = formatArchiveDate(date);
  time.title = date.toLocaleString();
  makeTextSelectable(time, draggableItem, usesDragDrop);
  time.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  cell.append(time);
  return cell;
}

function formatArchiveDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function createTypeCell(
  label: "Group" | "Session" | "Tab" | "Window",
): HTMLSpanElement {
  const type = document.createElement("span");
  type.className = "archive-type";
  type.textContent = label;
  return type;
}

function createBookmarkCell(
  button: HTMLButtonElement | undefined,
): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "archive-bookmark-cell";
  if (button !== undefined) cell.append(button);
  return cell;
}

function createPinCell(
  pinned: boolean,
  item: ArchiveItemReference,
  actions: ArchiveManagerActions,
): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "archive-pin-cell";
  if (actions.togglePin === undefined) return cell;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "archive-pin-action";
  button.classList.toggle("is-pinned", pinned);
  button.title = pinned ? "Unpin entry" : "Pin entry";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(pinned));
  button.append(createPinIcon(pinned));
  button.addEventListener("click", () => {
    void runIconAction(button, () => actions.togglePin!(item)).catch((error) =>
      actions.showError(errorMessage(error)),
    );
  });
  cell.append(button);
  return cell;
}

function createPinIcon(pinned: boolean): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("archive-action-icon", "archive-action-icon-pin");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    pinned
      ? "M7.5 3.5h9l-1.25 6 3.25 3.25v2H13v6.5l-2-2v-4.5H5.5v-2l3.25-3.25-1.25-6Z"
      : "m8.5 4 7 2.25-2.25 5 3.5 3.75-1.5 1.5-5-2-3.5 4-1.5-1.5 3.5-4-2.25-5L8.5 4Z",
  );
  icon.append(path);
  return icon;
}

function setSortData(
  element: HTMLElement,
  createdAt: number,
  name: string,
  bookmarked: true | undefined,
  archivePinned: true | undefined,
  type: "group" | "session" | "tab" | "window",
): void {
  element.dataset.createdAt = String(createdAt);
  element.dataset.name = name;
  element.dataset.bookmarked = String(bookmarked === true);
  element.dataset.pinned = String(archivePinned === true);
  element.dataset.type = type;
}

function compareEntries(
  left: ArchiveEntry,
  right: ArchiveEntry,
  options: ArchiveManagerOptions,
): number {
  const key = options.sortKey ?? "date";
  const direction = options.sortDirection === "ascending" ? 1 : -1;
  let comparison: number;
  if (key === "name") {
    comparison = entryName(left).localeCompare(entryName(right), undefined, {
      sensitivity: "base",
    });
  } else if (key === "bookmarked") {
    comparison = Number(entryBookmarked(left)) - Number(entryBookmarked(right));
  } else if (key === "pinned") {
    comparison = left.createdAt - right.createdAt;
  } else if (key === "type") {
    const priority = typePriorityOrder(options.typePriority ?? "session");
    comparison =
      priority.indexOf(entryType(left)) - priority.indexOf(entryType(right));
  } else {
    comparison = left.createdAt - right.createdAt;
  }
  if (comparison !== 0)
    return key === "type" ? comparison : comparison * direction;
  return (
    right.createdAt - left.createdAt ||
    entryName(left).localeCompare(entryName(right))
  );
}

function orderedEntries(
  snapshot: ArchiveSnapshot,
  options: ArchiveManagerOptions,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [
    ...snapshot.sessions.map((session) => ({
      createdAt: session.createdAt,
      session,
    })),
    ...snapshot.tabs.map((tab) => ({ createdAt: tab.createdAt, tab })),
    ...snapshot.windows.map((window) => ({
      createdAt: window.createdAt,
      window,
    })),
  ];
  const priorOrder = new Map(
    options.entryOrder?.map((id, index) => [id, index] as const) ?? [],
  );
  entries.sort((left, right) => {
    const pinnedComparison =
      Number(entryPinned(right)) - Number(entryPinned(left));
    if (pinnedComparison !== 0) return pinnedComparison;
    const leftIndex = priorOrder.get(archiveEntryId(left));
    const rightIndex = priorOrder.get(archiveEntryId(right));
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return compareEntries(left, right, options);
  });
  return entries;
}

function archiveEntryId(entry: ArchiveEntry): string {
  if ("session" in entry) return `session:${entry.session.sessionId}`;
  if ("tab" in entry) return `tab:${entry.tab.bookmarkId}`;
  return `window:${entry.window.folderId}`;
}

function entryName(entry: ArchiveEntry): string {
  if ("session" in entry) return entry.session.name ?? "Session";
  return "tab" in entry ? entry.tab.title : (entry.window.name ?? "Window");
}

function entryBookmarked(entry: ArchiveEntry): boolean {
  if ("session" in entry) return entry.session.bookmarked === true;
  return "tab" in entry
    ? entry.tab.bookmarked === true
    : entry.window.bookmarked === true;
}

function entryPinned(entry: ArchiveEntry): boolean {
  if ("session" in entry) return entry.session.archivePinned === true;
  return "tab" in entry
    ? entry.tab.archivePinned === true
    : entry.window.archivePinned === true;
}

function pinnedFirst<T extends { archivePinned?: true }>(values: T[]): T[] {
  return [...values].sort(
    (left, right) =>
      Number(right.archivePinned === true) -
      Number(left.archivePinned === true),
  );
}

function entryType(
  entry: ArchiveEntry,
): "group" | "session" | "tab" | "window" {
  if ("session" in entry) return "session";
  if ("tab" in entry) return "tab";
  return entry.window.entryType === "group" ? "group" : "window";
}

function typePriorityOrder(
  first: "group" | "session" | "tab" | "window",
): Array<"group" | "session" | "tab" | "window"> {
  const cycle: Array<"group" | "session" | "tab" | "window"> = [
    "session",
    "window",
    "tab",
    "group",
  ];
  const start = cycle.indexOf(first);
  return [...cycle.slice(start), ...cycle.slice(0, start)];
}

function actionButton(
  label: string,
  iconName: ArchiveActionIcon,
  className?: string,
  bookmarked = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  if (className) button.classList.add(className);
  if (iconName === "bookmark") {
    button.setAttribute("aria-pressed", String(bookmarked));
  }
  if (bookmarked) {
    button.classList.add("is-bookmarked");
  }
  button.append(createActionIcon(iconName));
  const labelElement = document.createElement("span");
  labelElement.className = "button-label";
  labelElement.textContent = label;
  button.append(labelElement);
  return button;
}

function nameRestoreTarget(
  title: HTMLElement,
  label: string,
  action: () => Promise<void>,
  actions: ArchiveManagerActions,
): HTMLSpanElement {
  const target = document.createElement("span");
  target.className = "archive-name-restore";
  target.tabIndex = 0;
  target.title = label;
  target.setAttribute("aria-label", label);
  target.setAttribute("role", "button");
  const icon = document.createElement("span");
  icon.className = "archive-hover-restore";
  icon.append(createActionIcon("restore"));
  target.append(title, icon);
  const restore = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    void runNameRestoreAction(target, action).catch((error) =>
      actions.showError(errorMessage(error)),
    );
  };
  target.addEventListener("click", restore);
  target.addEventListener("keydown", (event) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    restore(event);
  });
  return target;
}

async function runNameRestoreAction(
  target: HTMLElement,
  action: () => Promise<void>,
): Promise<void> {
  if (target.getAttribute("aria-busy") === "true") return;
  target.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    target.removeAttribute("aria-busy");
  }
}

function runConfirmedDelete(
  button: HTMLButtonElement,
  summary: ArchiveDeleteSummary,
  restingLabel: string,
  action: () => Promise<void>,
  actions: ArchiveManagerActions,
): void {
  void (async () => {
    if (!(await actions.confirmDelete(summary))) return;
    await runAction(button, "Erasing…", restingLabel, action);
  })().catch((error) => actions.showError(errorMessage(error)));
}

function createActionIcon(iconName: ArchiveActionIcon): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("archive-action-icon", `archive-action-icon-${iconName}`);
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  const paths: Record<ArchiveActionIcon, string[]> = {
    bookmark: ["M7 4h10v16l-5-3-5 3Z"],
    erase: [
      "M4 6.5h16",
      "M9 6.5V4h6v2.5",
      "M6.5 6.5 7.5 20h9l1-13.5",
      "M10 10v6.5M14 10v6.5",
    ],
    rename: ["M4 20h4L19 9l-4-4L4 16v4Z", "m13.5 6.5 4 4"],
    restore: [
      "M3.5 6.5h6l1.75-2h9.25v15H3.5v-13Z",
      "M3.5 9h17",
      "M7 6.75h.01M9.5 6.75h.01",
      "M12.5 6.75h5",
    ],
  };
  for (const pathData of paths[iconName]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  }
  return icon;
}

async function runAction(
  button: HTMLButtonElement,
  workingLabel: string,
  restingLabel: string,
  action: () => Promise<void>,
): Promise<void> {
  button.disabled = true;
  setButtonLabel(button, workingLabel);
  try {
    await action();
  } finally {
    button.disabled = false;
    setButtonLabel(button, restingLabel);
  }
}

async function runIconAction(
  button: HTMLButtonElement,
  action: () => Promise<void>,
): Promise<void> {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function setButtonLabel(button: HTMLButtonElement, label: string): void {
  const labelElement = button.querySelector<HTMLElement>(".button-label");
  if (labelElement) labelElement.textContent = label;
  else button.textContent = label;
}

function displayHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function windowTitleWithoutTabCount(title: string): string {
  return title.replace(/\s*(?:-|·|\u00c2\u00b7)\s*\d+\s+tabs?$/u, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The archive action could not be completed.";
}
