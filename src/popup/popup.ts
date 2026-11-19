import "./popup.css";
import "../shared/archive-manager.css";
import type { ArchiveSnapshot } from "../background/hibernate-archive";
import {
  renderArchiveManager,
  type ArchiveManagerActions,
} from "../shared/archive-manager";
import { downloadJson, readJsonFile } from "../shared/json-file";
import type { ExtensionStatus } from "../shared/messages";
import { PRODUCT_NAME } from "../shared/product";
import { confirmArchiveDeletion } from "../shared/archive-delete-confirmation";

const el = {
  action: get<HTMLParagraphElement>("action-note"),
  activityProtection: get<HTMLInputElement>("protect-activity"),
  activityProtectionRow: get<HTMLLabelElement>("protect-activity-row"),
  archiveEmpty: get<HTMLParagraphElement>("archive-empty"),
  archiveList: get<HTMLDivElement>("archive-list"),
  archiveSummary: get<HTMLSpanElement>("archive-summary"),
  archiveImportFile: get<HTMLInputElement>("archive-import-file"),
  currentTitle: get<HTMLElement>("current-tab-title"),
  currentUrl: get<HTMLElement>("current-tab-url"),
  currentGroupName: get<HTMLElement>("current-group-name"),
  hibernate: get<HTMLButtonElement>("hibernate-current"),
  groupSection: get<HTMLElement>("hibernate-group-section"),
  hibernateGroup: get<HTMLButtonElement>("hibernate-group"),
  hibernatedCount: get<HTMLSpanElement>("hibernated-count"),
  exportArchives: get<HTMLButtonElement>("export-archives"),
  hibernateWindow: get<HTMLButtonElement>("hibernate-window"),
  hibernateSession: get<HTMLButtonElement>("hibernate-session"),
  ignoreGroupProtection: get<HTMLInputElement>("ignore-group-protection"),
  ignoreSessionProtection: get<HTMLInputElement>("ignore-session-protection"),
  ignoreWindowProtection: get<HTMLInputElement>("ignore-window-protection"),
  importArchives: get<HTMLButtonElement>("import-archives"),
  meterOpen: get<HTMLSpanElement>("meter-open"),
  openActivity: get<HTMLButtonElement>("open-activity"),
  openCount: get<HTMLElement>("open-count"),
  openHibernated: get<HTMLButtonElement>("open-hibernated"),
  openHibernatedFooter: get<HTMLButtonElement>("open-hibernated-footer"),
  openOptions: get<HTMLButtonElement>("open-options"),
  protection: get<HTMLParagraphElement>("protection-line"),
  protect: get<HTMLInputElement>("protect-site"),
  protectLabel: get<HTMLSpanElement>("protect-site-label"),
  protectRow: get<HTMLLabelElement>("protect-site-row"),
  sessionName: get<HTMLInputElement>("session-name"),
  selectedTabList: get<HTMLDivElement>("selected-tab-list"),
  windowName: get<HTMLInputElement>("window-name"),
};

let currentTab: chrome.tabs.Tab | undefined;
let selectedTabs: chrome.tabs.Tab[] = [];
let siteMode: ExtensionStatus["siteProtectionMode"] = "none";
let archiveTransferBusy = false;
let currentGroupId: number = chrome.tabGroups.TAB_GROUP_ID_NONE;

el.openOptions.addEventListener(
  "click",
  () => void chrome.runtime.openOptionsPage(),
);
el.openActivity.addEventListener("click", () => void openPage("activity.html"));
el.openHibernated.addEventListener(
  "click",
  () => void openPage("hibernated.html"),
);
el.openHibernatedFooter.addEventListener(
  "click",
  () => void openPage("hibernated.html"),
);
el.hibernate.addEventListener("click", () => void hibernateTab());
el.hibernateGroup.addEventListener("click", () => void hibernateGroup());
el.hibernateWindow.addEventListener("click", () => void hibernateWindow());
el.hibernateSession.addEventListener("click", () => void hibernateSession());
el.exportArchives.addEventListener("click", () => void exportArchiveJson());
el.importArchives.addEventListener("click", () => el.archiveImportFile.click());
el.archiveImportFile.addEventListener("change", () => void importArchiveJson());
el.protect.addEventListener("change", () => void toggleProtection());
el.activityProtection.addEventListener(
  "change",
  () => void toggleActivityProtection(),
);
void initialize();

async function initialize(): Promise<void> {
  const [windowTabs, allTabs] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabs.query({}),
  ]);
  currentTab = windowTabs.find((tab) => tab.active);
  await renderCurrentGroup(currentTab);
  selectedTabs = windowTabs
    .filter((tab) => tab.highlighted)
    .sort((left, right) => left.index - right.index);
  if (selectedTabs.length === 0 && currentTab !== undefined) {
    selectedTabs = [currentTab];
  }
  try {
    const archives = await getArchives();
    renderArchives(archives);
    renderTabMeter(allTabs.length, archives.tabCount);
  } catch (error) {
    renderArchiveError(error, allTabs.length);
  }
  if (currentTab?.id === undefined) {
    setCurrentTabTitle("No active tab found");
    setCurrentTabUrl("No URL available");
    el.hibernate.disabled = true;
    el.hibernateGroup.disabled = true;
    el.hibernateWindow.disabled = true;
    el.hibernateSession.disabled = true;
    return;
  }
  renderCurrentSelection();
  try {
    const response = (await chrome.runtime.sendMessage({
      tabId: currentTab.id,
      type: "GET_STATUS",
    })) as (Partial<ExtensionStatus> & { error?: string }) | undefined;
    if (response?.hostAccess === undefined) {
      throw new Error(response?.error ?? "Current-tab status is unavailable.");
    }
    renderStatus(response as ExtensionStatus);
  } catch (error) {
    el.protection.textContent = "Protection status unavailable";
    showAction(
      errorMessage(
        error,
        "The tab can still be checked when you hibernate it.",
      ),
    );
    el.hibernate.disabled = false;
    el.hibernateWindow.disabled = false;
    el.hibernateSession.disabled = false;
  }
}

async function renderCurrentGroup(
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  currentGroupId = tab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE;
  el.groupSection.hidden =
    currentGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
  if (el.groupSection.hidden) return;
  try {
    const group = await chrome.tabGroups.get(currentGroupId);
    el.currentGroupName.textContent = `"${group.title?.trim() || "Unnamed group"}"`;
    el.hibernateGroup.disabled = false;
  } catch {
    currentGroupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    el.groupSection.hidden = true;
  }
}

async function openPage(path: string): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
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

async function refreshArchives(): Promise<void> {
  const [archives, allTabs] = await Promise.all([
    getArchives(),
    chrome.tabs.query({}),
  ]);
  renderArchives(archives);
  renderTabMeter(allTabs.length, archives.tabCount);
}

async function exportArchiveJson(): Promise<void> {
  setArchiveTransferBusy(true);
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
      response.product !== PRODUCT_NAME ||
      response.formatVersion !== 2 ||
      typeof response.archive !== "object" ||
      response.archive === null
    ) {
      throw new Error(response?.error ?? "The archive could not be exported.");
    }
    downloadJson(response, "htws-archives");
    showAction("Hibernation archive exported.");
  } catch (error) {
    showAction(errorMessage(error, "The archive export failed."));
  } finally {
    setArchiveTransferBusy(false);
  }
}

async function importArchiveJson(): Promise<void> {
  const file = el.archiveImportFile.files?.[0];
  el.archiveImportFile.value = "";
  if (file === undefined) return;
  setArchiveTransferBusy(true);
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
    await refreshArchives();
    showAction(
      `Imported ${response.importedTabs} tab${response.importedTabs === 1 ? "" : "s"}, ${response.importedWindows} window${response.importedWindows === 1 ? "" : "s"}, and ${response.importedSessions} session${response.importedSessions === 1 ? "" : "s"}.${response.skippedDuplicates ? ` ${response.skippedDuplicates} duplicate${response.skippedDuplicates === 1 ? " was" : "s were"} skipped.` : ""}`,
    );
  } catch (error) {
    showAction(errorMessage(error, "The archive import failed."));
  } finally {
    setArchiveTransferBusy(false);
  }
}

function setArchiveTransferBusy(busy: boolean): void {
  archiveTransferBusy = busy;
  el.exportArchives.disabled = archiveTransferBusy;
  el.importArchives.disabled = archiveTransferBusy;
}

async function hibernateTab(): Promise<void> {
  if (currentTab?.id === undefined) return;
  const tabIds = selectedTabs.flatMap((tab) =>
    tab.id === undefined ? [] : [tab.id],
  );
  const multiple = tabIds.length > 1;
  el.hibernate.disabled = true;
  el.hibernate.textContent = multiple ? "Hibernating tabs…" : "Hibernating…";
  showAction(
    multiple
      ? "Saving the selected tabs before closing them…"
      : "Saving this tab before closing it…",
  );
  try {
    const response = (await chrome.runtime.sendMessage(
      multiple
        ? { tabIds, type: "HIBERNATE_TABS" }
        : { tabId: currentTab.id, type: "HIBERNATE_TAB" },
    )) as { archived?: number; error?: string } | undefined;
    if (response?.archived !== undefined) return;
    throw new Error(
      response?.error ??
        (multiple
          ? "The selected tabs could not be hibernated."
          : "This tab could not be hibernated."),
    );
  } catch (error) {
    el.hibernate.disabled = false;
    el.hibernate.textContent = multiple ? "Hibernate tabs" : "Hibernate tab";
    showAction(
      errorMessage(
        error,
        multiple
          ? "The selected tabs could not be hibernated."
          : "This tab could not be hibernated.",
      ),
    );
  }
}

async function hibernateGroup(): Promise<void> {
  if (currentGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  el.hibernateGroup.disabled = true;
  el.hibernateGroup.textContent = "Hibernating…";
  showAction("Saving the complete group before closing it…");
  try {
    const response = (await chrome.runtime.sendMessage({
      groupId: currentGroupId,
      ignoreProtection: el.ignoreGroupProtection.checked,
      type: "HIBERNATE_GROUP",
    })) as
      { archived?: number; error?: string; skipped?: unknown[] } | undefined;
    if (response?.archived === undefined) {
      throw new Error(response?.error ?? "This group could not be hibernated.");
    }
    if (response.archived === 0) {
      el.hibernateGroup.disabled = false;
      el.hibernateGroup.textContent = "Hibernate group";
      showAction(
        "The group stayed open because at least one tab is protected. Select Ignore protection to hibernate it anyway.",
      );
      return;
    }
    showAction(`${response.archived} group tabs hibernated.`);
  } catch (error) {
    el.hibernateGroup.disabled = false;
    el.hibernateGroup.textContent = "Hibernate group";
    showAction(errorMessage(error, "This group could not be hibernated."));
  }
}

async function hibernateWindow(): Promise<void> {
  if (currentTab?.windowId === undefined) return;
  el.hibernateWindow.disabled = true;
  el.hibernateWindow.textContent = "Hibernating…";
  showAction("Saving safe tabs before closing them…");
  try {
    const response = (await chrome.runtime.sendMessage({
      ignoreProtection: el.ignoreWindowProtection.checked,
      name: el.windowName.value,
      type: "HIBERNATE_WINDOW",
      windowId: currentTab.windowId,
    })) as
      | {
          archived?: number;
          detail?: string;
          error?: string;
          skipped?: unknown[];
        }
      | undefined;
    if (response?.archived === undefined) {
      throw new Error(
        response?.error ?? "This window could not be hibernated.",
      );
    }
    el.hibernateWindow.disabled = false;
    el.hibernateWindow.textContent = "Hibernate this window";
    await initialize();
    showAction(
      response.skipped?.length
        ? `${response.archived} hibernated. ${response.detail ?? `${response.skipped.length} tab(s) left open.`}`
        : `${response.archived} tab${response.archived === 1 ? "" : "s"} hibernated.`,
    );
  } catch (error) {
    el.hibernateWindow.disabled = false;
    el.hibernateWindow.textContent = "Hibernate this window";
    showAction(errorMessage(error, "This window could not be hibernated."));
  }
}

async function hibernateSession(): Promise<void> {
  el.hibernateSession.disabled = true;
  el.hibernateSession.textContent = "Hibernating…";
  showAction("Saving the session locally…");
  try {
    const response = (await chrome.runtime.sendMessage({
      ignoreProtection: el.ignoreSessionProtection.checked,
      name: el.sessionName.value,
      type: "HIBERNATE_SESSION",
    })) as
      | {
          archived?: number;
          detail?: string;
          error?: string;
          skipped?: unknown[];
          windows?: number;
        }
      | undefined;
    if (response?.archived === undefined) {
      throw new Error(
        response?.error ?? "This session could not be hibernated.",
      );
    }
    el.hibernateSession.disabled = false;
    el.hibernateSession.textContent = "Hibernate session";
    await initialize();
    showAction(
      response.skipped?.length
        ? `${response.archived} hibernated across ${response.windows} window(s). ${response.detail ?? `${response.skipped.length} tab(s) left open.`}`
        : `${response.archived} tabs hibernated across ${response.windows} window(s).`,
    );
  } catch (error) {
    el.hibernateSession.disabled = false;
    el.hibernateSession.textContent = "Hibernate session";
    showAction(errorMessage(error, "This session could not be hibernated."));
  }
}

function renderTabMeter(openCount: number, hibernatedCount: number): void {
  const total = openCount + hibernatedCount;
  el.openCount.textContent = String(openCount);
  el.hibernatedCount.textContent = `${hibernatedCount} hibernated`;
  el.meterOpen.style.width = `${total === 0 ? 0 : (openCount / total) * 100}%`;
}

function renderArchives(snapshot: ArchiveSnapshot): void {
  el.archiveSummary.textContent = `${snapshot.tabCount} tab${snapshot.tabCount === 1 ? "" : "s"} - ${snapshot.windows.length} window${snapshot.windows.length === 1 ? "" : "s"} - ${snapshot.sessions.length} session${snapshot.sessions.length === 1 ? "" : "s"}`;
  el.archiveEmpty.hidden = snapshot.tabCount > 0;
  renderArchiveManager(el.archiveList, snapshot, archiveActions, {
    openFirst: true,
    showRename: false,
  });
}

function renderArchiveError(error: unknown, openCount: number): void {
  el.archiveList.replaceChildren();
  el.archiveSummary.textContent = "Unavailable";
  el.archiveEmpty.hidden = false;
  el.archiveEmpty.textContent = errorMessage(
    error,
    "The hibernation archive could not be loaded.",
  );
  el.openCount.textContent = String(openCount);
  el.hibernatedCount.textContent = "Unavailable";
  el.meterOpen.style.width = "100%";
}

const archiveActions: ArchiveManagerActions = {
  confirmDelete: confirmArchiveDeletion,
  async toggleBookmarkSession(sessionId) {
    const result = await toggleBookmark({
      sessionId,
      type: "TOGGLE_ARCHIVE_SESSION_BOOKMARK",
    });
    await refreshArchives();
    showAction(
      result.bookmarked
        ? `${result.changed} session bookmarks saved.`
        : "Saved session bookmarks removed; hibernation entry remains.",
    );
  },
  async toggleBookmarkTab(bookmarkId) {
    const result = await toggleBookmark({
      bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    await refreshArchives();
    showAction(
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
    await refreshArchives();
    showAction(
      result.bookmarked
        ? `${result.changed} bookmark${result.changed === 1 ? "" : "s"} saved.`
        : "Saved window bookmarks removed; hibernation entry remains.",
    );
  },
  async deleteTab(bookmarkId) {
    await requireWorkerCount(
      { bookmarkId, type: "DELETE_ARCHIVE_TAB" },
      "deleted",
    );
    await refreshArchives();
    showAction("Hibernated tab erased.");
  },
  async deleteSession(sessionId) {
    await requireWorkerCount(
      { sessionId, type: "DELETE_ARCHIVE_SESSION" },
      "deleted",
    );
    await refreshArchives();
    showAction("Hibernated session erased.");
  },
  async deleteWindow(folderId) {
    await requireWorkerCount(
      { folderId, type: "DELETE_ARCHIVE_WINDOW" },
      "deleted",
    );
    await refreshArchives();
    showAction("Hibernated window erased.");
  },
  async renameTab(bookmarkId, name) {
    const response = (await chrome.runtime.sendMessage({
      bookmarkId,
      name,
      type: "RENAME_ARCHIVE_TAB",
    })) as { error?: string; ok?: boolean } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Rename failed.");
    await refreshArchives();
    showAction("Tab renamed.");
  },
  async renameWindow(folderId, name) {
    const response = (await chrome.runtime.sendMessage({
      folderId,
      name,
      type: "RENAME_ARCHIVE_WINDOW",
    })) as { error?: string; ok?: boolean } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Rename failed.");
    await refreshArchives();
    showAction("Window renamed.");
  },
  async renameSession(sessionId, name) {
    const response = (await chrome.runtime.sendMessage({
      name,
      sessionId,
      type: "RENAME_ARCHIVE_SESSION",
    })) as { error?: string; ok?: boolean } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Rename failed.");
    await refreshArchives();
    showAction("Session renamed.");
  },
  async restoreTab(bookmarkId) {
    await requireWorkerCount(
      {
        bookmarkId,
        ...(currentTab?.windowId === undefined
          ? {}
          : { targetWindowId: currentTab.windowId }),
        type: "RESTORE_ARCHIVE_TAB",
      },
      "restored",
    );
    await refreshArchives();
    showAction("Tab restored.");
  },
  async restoreWindow(folderId) {
    const restored = await requireWorkerCount(
      { folderId, type: "RESTORE_ARCHIVE_WINDOW" },
      "restored",
    );
    await refreshArchives();
    showAction(`${restored} tab${restored === 1 ? "" : "s"} restored.`);
  },
  async restoreSession(sessionId) {
    const restored = await requireWorkerCount(
      { sessionId, type: "RESTORE_ARCHIVE_SESSION" },
      "restored",
    );
    await refreshArchives();
    showAction(`${restored} session tab${restored === 1 ? "" : "s"} restored.`);
  },
  showError(message) {
    showAction(message);
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

async function requireWorkerCount(
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

function renderStatus(status: ExtensionStatus): void {
  const reason = status.currentDecision?.decisionReason ?? "unavailable";
  const level = status.currentDecision?.protectionLevel ?? status.hostAccess;
  el.protection.textContent =
    selectedTabs.length > 1
      ? "Checks pinned, audible, protected-site, active-media, capture, and unsaved-form protections."
      : `${capitalize(level)} protection - ${humanize(reason)}`;
  siteMode = status.siteProtectionMode;
  el.protectRow.hidden =
    selectedTabs.length > 1 || reason === "unsupported-url";
  el.activityProtectionRow.hidden =
    selectedTabs.length > 1 || reason === "unsupported-url";
  el.protect.checked = siteMode !== "none";
  el.protectLabel.textContent =
    siteMode === "broader"
      ? "Manage site exclusion"
      : "Never hibernate this site";
  el.protectRow.title =
    siteMode === "broader"
      ? "Open Settings to manage this site's never-hibernate rule"
      : "Prevents this site from being hibernated";
  el.activityProtection.checked = status.hostAccess !== "none";
  el.activityProtection.disabled = status.hostAccess === "all";
  el.activityProtectionRow.title =
    status.hostAccess === "all"
      ? "Enabled for all sites in Settings. Tabs stay open while media is playing, a stream or Picture-in-Picture is active, or a form has unsaved changes."
      : "Prevents hibernation on this site while audio or video is playing, a stream or Picture-in-Picture is active, or a form has unsaved changes. Requires site access.";
  el.hibernate.disabled = false;
  if (selectedTabs.length === 1 && reason === "incognito-kept-open") {
    el.hibernate.disabled = true;
  }
  el.hibernateWindow.disabled = false;
  el.hibernateSession.disabled = false;
}

function renderCurrentSelection(): void {
  const multiple = selectedTabs.length > 1;
  el.selectedTabList.hidden = !multiple;
  el.currentUrl.hidden = multiple;
  el.protectRow.hidden = multiple;
  el.activityProtectionRow.hidden = multiple;
  el.hibernate.textContent = multiple ? "Hibernate tabs" : "Hibernate tab";
  el.hibernate.title = multiple
    ? "Hibernate the selected tabs that are not protected"
    : "Hibernate the current tab when it is not protected";
  if (!multiple) {
    setCurrentTabTitle(currentTab?.title ?? "Untitled tab");
    setCurrentTabUrl(
      currentTab?.pendingUrl ?? currentTab?.url ?? "URL unavailable",
    );
    el.selectedTabList.replaceChildren();
    return;
  }
  setCurrentTabTitle(`${selectedTabs.length} selected tabs`);
  el.protection.textContent =
    "Checks pinned, audible, protected-site, active-media, capture, and unsaved-form protections.";
  el.selectedTabList.replaceChildren(
    ...selectedTabs.map((tab) => {
      const row = document.createElement("div");
      row.className = "selected-tab-row";
      const title = document.createElement("strong");
      title.textContent = tab.title ?? "Untitled tab";
      title.title = title.textContent;
      const url = document.createElement("small");
      url.textContent = tab.pendingUrl ?? tab.url ?? "URL unavailable";
      url.title = url.textContent;
      row.append(title, url);
      return row;
    }),
  );
}

async function toggleProtection(): Promise<void> {
  if (currentTab?.id === undefined) return;
  if (siteMode === "broader") {
    el.protect.checked = true;
    return void chrome.runtime.openOptionsPage();
  }
  const protect = el.protect.checked;
  try {
    await chrome.runtime.sendMessage({
      protect,
      tabId: currentTab.id,
      type: "PROTECT_SITE",
    });
    await initialize();
  } catch (error) {
    el.protect.checked = !protect;
    showAction(errorMessage(error, "Site protection could not be changed."));
  }
}

async function toggleActivityProtection(): Promise<void> {
  if (!currentTab?.url || el.activityProtection.disabled) return;
  const url = new URL(currentTab.url);
  const origins = [`${url.protocol}//${url.host}/*`];
  const protect = el.activityProtection.checked;
  try {
    const changed = protect
      ? await chrome.permissions.request({ origins })
      : await chrome.permissions.remove({ origins });
    await initialize();
    if (!changed) {
      el.activityProtection.checked = !protect;
      showAction(
        protect
          ? "Site access was not granted."
          : "Site access could not be removed.",
      );
      return;
    }
    showAction(
      protect
        ? "Media and form protection enabled for this site."
        : "Media and form protection disabled for this site.",
    );
  } catch (error) {
    el.activityProtection.checked = !protect;
    showAction(
      errorMessage(error, "Media and form protection could not be changed."),
    );
  }
}

function setCurrentTabTitle(title: string): void {
  el.currentTitle.textContent = title;
  el.currentTitle.title = title;
}

function setCurrentTabUrl(url: string): void {
  el.currentUrl.textContent = url;
  el.currentUrl.title = url;
}

function showAction(message: string): void {
  el.action.textContent = message;
  el.action.title = message;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function humanize(value: string): string {
  return value.replaceAll("-", " ");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
