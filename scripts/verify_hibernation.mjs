/* global Blob, chrome, document, Event, getComputedStyle, HTMLAnchorElement, HTMLButtonElement, HTMLInputElement, HTMLSelectElement, Node, setTimeout */

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
const profilePath = await mkdtemp(resolve(tmpdir(), "htws-archive-"));
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><title>${request.url}</title><p>Archive test</p>`,
  );
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("The acceptance server did not expose a TCP port.");
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
  const extensionPage = await browser.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
  });

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const result = await extensionPage.evaluate(async (base) => {
    const countBookmarksByUrl = async (url) => {
      const tree = await chrome.bookmarks.getTree();
      let count = 0;
      const visit = (nodes) => {
        for (const node of nodes) {
          if (node.url === url) count += 1;
          if (node.children !== undefined) visit(node.children);
        }
      };
      visit(tree);
      return count;
    };
    await chrome.contextMenus.update("htws-hibernate-tab", {
      title: "Hibernate this tab",
    });
    await chrome.contextMenus.update("htws-hibernate-window", {
      title: "Hibernate this window",
    });
    await chrome.contextMenus.update("htws-hibernate-session", {
      title: "Hibernate this session",
    });
    await chrome.contextMenus.update("htws-never-hibernate-site", {
      title: "Never hibernate this site",
    });
    await chrome.storage.sync.set({
      settings: {
        activityRetentionDays: 90,
        autoHibernateGroupedTabs: "together",
        autoHibernateIncludeIncognito: false,
        autoHibernateIncludeInternalPages: false,
        autoHibernateMinutes: null,
        autoHibernateUnit: "minutes",
        incognitoBehavior: "keep-open",
        internalPageBehavior: "archive",
        protectAudible: true,
        protectModifiedFields: true,
        protectPinned: false,
        protectPlayingMedia: true,
        schemaVersion: 8,
      },
    });
    const urls = [`${base}/one`, `${base}/two`, `${base}/three`];
    const sourceWindow = await chrome.windows.create({
      focused: false,
      url: urls,
    });
    if (sourceWindow.id === undefined)
      throw new Error("Source window missing ID.");
    const tabs = (await chrome.tabs.query({ windowId: sourceWindow.id })).sort(
      (left, right) => left.index - right.index,
    );
    if (tabs.length !== 3 || tabs.some((tab) => tab.id === undefined)) {
      throw new Error("Source tabs were not created.");
    }
    await chrome.tabs.update(tabs[0].id, { pinned: true });
    const groupId = await chrome.tabs.group({
      createProperties: { windowId: sourceWindow.id },
      tabIds: [tabs[1].id, tabs[2].id],
    });
    await chrome.tabGroups.update(groupId, {
      collapsed: false,
      color: "blue",
      title: "Archive acceptance",
    });
    await chrome.tabs.update(tabs[1].id, { active: true });

    const hibernated = await chrome.runtime.sendMessage({
      name: "Acceptance window",
      type: "HIBERNATE_WINDOW",
      windowId: sourceWindow.id,
    });
    if (hibernated.archived !== 3) {
      throw new Error(
        `Expected three archived tabs: ${JSON.stringify(hibernated)}`,
      );
    }
    let archive;
    const deadline = Date.now() + 2_000;
    do {
      archive = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
      if (archive.tabCount === 3) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    } while (Date.now() < deadline);
    const archivedWindow = archive.windows?.[0];
    if (archivedWindow?.name !== "Acceptance window") {
      throw new Error(`Archive name missing: ${JSON.stringify(archive)}`);
    }
    const renamed = await chrome.runtime.sendMessage({
      folderId: archivedWindow.folderId,
      name: "Renamed acceptance window",
      type: "RENAME_ARCHIVE_WINDOW",
    });
    if (renamed.ok !== true) throw new Error("Archive rename failed.");
    const archivedUrls = archivedWindow?.tabs.map((tab) => tab.url);
    if (
      archive.tabCount !== 3 ||
      JSON.stringify(archivedUrls) !== JSON.stringify(urls)
    ) {
      const stored = await chrome.storage.local.get("hibernateArchiveStore");
      throw new Error(
        `Archive URLs are not durable: ${JSON.stringify({ archive, stored })}`,
      );
    }
    for (const url of urls) {
      if ((await countBookmarksByUrl(url)) !== 0) {
        throw new Error(`Hibernation leaked ${url} into browser bookmarks.`);
      }
    }

    const survivalUrl = `${base}/survives-disable`;
    const survivalWindow = await chrome.windows.create({
      focused: false,
      url: survivalUrl,
    });
    if (survivalWindow.id === undefined) {
      throw new Error("The persistence-test window was not created.");
    }
    const waitForSurvivalTab = async () => {
      const survivalDeadline = Date.now() + 5_000;
      while (Date.now() < survivalDeadline) {
        const [survivalTab] = await chrome.tabs.query({
          windowId: survivalWindow.id,
        });
        if (
          survivalTab?.status === "complete" &&
          survivalTab.url === survivalUrl
        ) {
          return true;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      return false;
    };
    const survivalReady = await waitForSurvivalTab();
    if (!survivalReady) {
      throw new Error("The persistence-test tab did not finish loading.");
    }
    const persisted = await chrome.runtime.sendMessage({
      type: "HIBERNATE_WINDOW",
      windowId: survivalWindow.id,
    });
    if (persisted.archived !== 1) {
      throw new Error(
        `Persistence archive failed: ${JSON.stringify(persisted)}`,
      );
    }
    const restored = await chrome.runtime.sendMessage({
      folderId: archivedWindow.folderId,
      type: "RESTORE_ARCHIVE_WINDOW",
    });
    if (restored.restored !== 3) {
      throw new Error(
        `Expected three restored tabs: ${JSON.stringify(restored)}`,
      );
    }
    const activity = await chrome.runtime.sendMessage({
      type: "GET_ACTIVITY_LOG",
    });
    const windowEntries = activity.filter((entry) => entry.target === "window");
    if (
      !windowEntries.some(
        (entry) =>
          entry.action === "restore" && entry.tabs.length === urls.length,
      )
    ) {
      throw new Error(
        `Window URLs missing from activity log: ${JSON.stringify(activity)}`,
      );
    }
    const allWindows = await chrome.windows.getAll({ populate: true });
    const restoredWindow = allWindows.find((candidate) => {
      const candidateUrls = candidate.tabs
        ?.slice()
        .sort((left, right) => left.index - right.index)
        .map((tab) => tab.url);
      return JSON.stringify(candidateUrls) === JSON.stringify(urls);
    });
    if (restoredWindow?.id === undefined || restoredWindow.tabs === undefined) {
      throw new Error("The restored window was not found.");
    }
    const restoredTabs = restoredWindow.tabs
      .slice()
      .sort((a, b) => a.index - b.index);
    const restoredGroup = await chrome.tabGroups.get(restoredTabs[1].groupId);
    const archiveConsumed = !(
      await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" })
    ).windows.some((entry) => entry.folderId === archivedWindow.folderId);

    const deleteWindow = await chrome.windows.create({
      focused: false,
      url: [`${base}/delete-one`, `${base}/delete-two`],
    });
    if (deleteWindow.id === undefined)
      throw new Error("Delete-test window missing ID.");
    const deletionArchive = await chrome.runtime.sendMessage({
      type: "HIBERNATE_WINDOW",
      windowId: deleteWindow.id,
    });
    let deletionSnapshot;
    let deletionWindow;
    const deletionDeadline = Date.now() + 2_000;
    do {
      deletionSnapshot = await chrome.runtime.sendMessage({
        type: "GET_ARCHIVES",
      });
      deletionWindow = deletionSnapshot.windows.find(
        (entry) => entry.folderId === deletionArchive.folderId,
      );
      if (deletionWindow?.tabs.length === 2) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    } while (Date.now() < deletionDeadline);
    if (deletionWindow?.tabs.length !== 2) {
      const deletionStore = await chrome.storage.local.get(
        "hibernateArchiveStore",
      );
      throw new Error(
        `Delete-test archive was not created: ${JSON.stringify({ deletionArchive, deletionSnapshot, deletionStore })}`,
      );
    }
    const bookmarkedTab = await chrome.runtime.sendMessage({
      bookmarkId: deletionWindow.tabs[0].bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    if (bookmarkedTab.bookmarked !== true || bookmarkedTab.changed !== 1) {
      throw new Error("Archived tab bookmark copy failed.");
    }
    const savedRoots = await chrome.bookmarks.search("HTWS Saved Bookmarks");
    const savedRoot = savedRoots.find(
      (node) => node.url === undefined && node.title === "HTWS Saved Bookmarks",
    );
    if (savedRoot === undefined) {
      throw new Error("The permanent bookmark folder was not created.");
    }
    const copiedTabUrl = deletionWindow.tabs[0].url;
    let savedRootChildren = await chrome.bookmarks.getChildren(savedRoot.id);
    const firstCopiedTab = savedRootChildren.find(
      (node) => node.url === copiedTabUrl,
    );
    if (firstCopiedTab === undefined) {
      throw new Error("The tab bookmark was not created in browser bookmarks.");
    }
    const unbookmarkedTab = await chrome.runtime.sendMessage({
      bookmarkId: deletionWindow.tabs[0].bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    const firstCopyRemoved = await chrome.bookmarks
      .get(firstCopiedTab.id)
      .then((nodes) => nodes.length === 0)
      .catch(() => true);
    if (unbookmarkedTab.bookmarked !== false || !firstCopyRemoved) {
      throw new Error(
        "The tab bookmark was not removed from browser bookmarks.",
      );
    }
    if ((await countBookmarksByUrl(copiedTabUrl)) !== 0) {
      throw new Error(
        "Unbookmarking left the URL in the browser bookmark collection.",
      );
    }
    const rebookmarkedTab = await chrome.runtime.sendMessage({
      bookmarkId: deletionWindow.tabs[0].bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    if (rebookmarkedTab.bookmarked !== true) {
      throw new Error("The tab could not be bookmarked again.");
    }
    const bookmarkedWindow = await chrome.runtime.sendMessage({
      folderId: deletionWindow.folderId,
      type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK",
    });
    if (
      bookmarkedWindow.bookmarked !== true ||
      bookmarkedWindow.changed !== 2
    ) {
      throw new Error("Archived window bookmark copy failed.");
    }
    let bookmarkedWindowSnapshot = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    let savedDeletionWindow = bookmarkedWindowSnapshot.windows.find(
      (entry) => entry.folderId === deletionWindow.folderId,
    );
    if (
      savedDeletionWindow?.bookmarked !== true ||
      !savedDeletionWindow.tabs.every((tab) => tab.bookmarked === true)
    ) {
      throw new Error(
        `Window bookmarks did not activate every tab: ${JSON.stringify(savedDeletionWindow)}`,
      );
    }
    const currentSavedRoot = (
      await chrome.bookmarks.search("HTWS Saved Bookmarks")
    ).find(
      (node) => node.url === undefined && node.title === "HTWS Saved Bookmarks",
    );
    if (currentSavedRoot === undefined) {
      throw new Error("The permanent bookmark folder was not recreated.");
    }
    savedRootChildren = await chrome.bookmarks.getChildren(currentSavedRoot.id);
    const copiedTab = savedRootChildren.find(
      (node) => node.url === copiedTabUrl,
    );
    const copiedFolder = savedRootChildren.find(
      (node) => node.url === undefined,
    );
    const copiedWindowTabs =
      copiedFolder === undefined
        ? []
        : await chrome.bookmarks.getChildren(copiedFolder.id);
    if (
      copiedTab !== undefined ||
      copiedWindowTabs.length !== 2 ||
      !copiedWindowTabs.every((node) =>
        deletionWindow.tabs.some((tab) => tab.url === node.url),
      )
    ) {
      throw new Error("Permanent bookmark copies did not preserve the URLs.");
    }
    const firstWindowBookmarkId = await chrome.storage.local
      .get("hibernateArchiveStore")
      .then((stored) => {
        const metadata =
          stored.hibernateArchiveStore?.windows?.[deletionWindow.folderId];
        return metadata?.tabs?.[deletionWindow.tabs[0].bookmarkId]
          ?.savedBookmarkId;
      });
    const removedWindowTab = await chrome.runtime.sendMessage({
      bookmarkId: deletionWindow.tabs[0].bookmarkId,
      type: "TOGGLE_ARCHIVE_TAB_BOOKMARK",
    });
    const removedWindowChild =
      typeof firstWindowBookmarkId === "string" &&
      (await chrome.bookmarks
        .get(firstWindowBookmarkId)
        .then((nodes) => nodes.length === 0)
        .catch(() => true));
    bookmarkedWindowSnapshot = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    savedDeletionWindow = bookmarkedWindowSnapshot.windows.find(
      (entry) => entry.folderId === deletionWindow.folderId,
    );
    if (
      removedWindowTab.bookmarked !== false ||
      !removedWindowChild ||
      savedDeletionWindow?.bookmarked === true ||
      savedDeletionWindow?.tabs[0]?.bookmarked === true ||
      savedDeletionWindow?.tabs[1]?.bookmarked !== true
    ) {
      throw new Error(
        `Removing a window child did not update browser and UI state: ${JSON.stringify({ removedWindowTab, removedWindowChild, savedDeletionWindow })}`,
      );
    }
    const repairedWindow = await chrome.runtime.sendMessage({
      folderId: deletionWindow.folderId,
      type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK",
    });
    bookmarkedWindowSnapshot = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    savedDeletionWindow = bookmarkedWindowSnapshot.windows.find(
      (entry) => entry.folderId === deletionWindow.folderId,
    );
    if (
      repairedWindow.bookmarked !== true ||
      savedDeletionWindow?.bookmarked !== true ||
      !savedDeletionWindow.tabs.every((tab) => tab.bookmarked === true)
    ) {
      throw new Error("Window bookmark repair did not restore every tab.");
    }
    const deletedTab = await chrome.runtime.sendMessage({
      bookmarkId: deletionWindow.tabs[0].bookmarkId,
      type: "DELETE_ARCHIVE_TAB",
    });
    if (deletedTab.deleted !== 1)
      throw new Error("Archived tab deletion failed.");
    const deletedWindow = await chrome.runtime.sendMessage({
      folderId: deletionWindow.folderId,
      type: "DELETE_ARCHIVE_WINDOW",
    });
    if (deletedWindow.deleted !== 1)
      throw new Error("Archived window deletion failed.");
    const standaloneSource = await chrome.windows.create({
      focused: false,
      url: `${base}/standalone`,
    });
    const [standaloneTab] = await chrome.tabs.query({
      windowId: standaloneSource.id,
    });
    const standaloneArchive = await chrome.runtime.sendMessage({
      tabId: standaloneTab.id,
      type: "HIBERNATE_TAB",
    });
    const standaloneSnapshot = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    if (
      standaloneArchive.archived !== 1 ||
      !standaloneSnapshot.tabs.some((tab) => tab.url === `${base}/standalone`)
    ) {
      throw new Error(
        `Individual hibernation was not exposed as a top-level tab: ${JSON.stringify(standaloneSnapshot)}`,
      );
    }
    await chrome.windows.create({
      focused: false,
      url: [`${base}/session-one`, `${base}/session-two`],
    });
    await chrome.windows.create({
      focused: false,
      url: `${base}/session-three`,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    const sessionResult = await chrome.runtime.sendMessage({
      name: "Acceptance session",
      type: "HIBERNATE_SESSION",
    });
    const sessionSnapshot = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    const archivedSession = sessionSnapshot.sessions.find(
      (session) => session.sessionId === sessionResult.sessionId,
    );
    if (
      sessionResult.archived < 3 ||
      sessionResult.windows < 2 ||
      archivedSession?.bookmarked === true ||
      archivedSession.windows.length !== sessionResult.windows
    ) {
      throw new Error(
        `Session hibernation failed: ${JSON.stringify({ sessionResult, archivedSession })}`,
      );
    }
    const automaticSessionBookmark = (
      await chrome.bookmarks.search("Acceptance session")
    ).find((node) => node.url === undefined);
    if (automaticSessionBookmark !== undefined) {
      throw new Error(
        "Session hibernation created bookmarks without an explicit action.",
      );
    }
    const bookmarkedSession = await chrome.runtime.sendMessage({
      sessionId: sessionResult.sessionId,
      type: "TOGGLE_ARCHIVE_SESSION_BOOKMARK",
    });
    if (
      bookmarkedSession.bookmarked !== true ||
      bookmarkedSession.changed !== sessionResult.archived
    ) {
      throw new Error("The explicit session bookmark action failed.");
    }
    const sessionBookmark = (
      await chrome.bookmarks.search("Acceptance session")
    ).find((node) => node.url === undefined);
    const sessionWindowFolders =
      sessionBookmark === undefined
        ? []
        : await chrome.bookmarks.getChildren(sessionBookmark.id);
    const sessionBookmarkTabs = (
      await Promise.all(
        sessionWindowFolders.map((folder) =>
          chrome.bookmarks.getChildren(folder.id),
        ),
      )
    ).flat();
    if (
      sessionWindowFolders.length !== sessionResult.windows ||
      sessionBookmarkTabs.filter((node) => node.url !== undefined).length !==
        sessionResult.archived
    ) {
      throw new Error("Session browser-bookmark hierarchy is incomplete.");
    }
    const renamedSession = await chrome.runtime.sendMessage({
      name: "Renamed acceptance session",
      sessionId: sessionResult.sessionId,
      type: "RENAME_ARCHIVE_SESSION",
    });
    const [renamedSessionFolder] = await chrome.bookmarks.get(
      sessionBookmark.id,
    );
    if (
      renamedSession.ok !== true ||
      !renamedSessionFolder.title.startsWith("Renamed acceptance session - ")
    ) {
      throw new Error("Renaming a session did not rename its bookmark folder.");
    }
    return {
      activeUrl: restoredTabs.find((tab) => tab.active)?.url,
      archiveConsumed,
      archivedUrls,
      group: { color: restoredGroup.color, title: restoredGroup.title },
      pinned: restoredTabs[0].pinned,
      permanentBookmarkUrl: copiedTabUrl,
      restoredUrls: restoredTabs.map((tab) => tab.url),
      sessionBookmarkUrl: sessionBookmarkTabs.find(
        (node) => node.url === `${base}/session-one`,
      )?.url,
      sessionId: sessionResult.sessionId,
    };
  }, baseUrl);

  const expectedUrls = [`${baseUrl}/one`, `${baseUrl}/two`, `${baseUrl}/three`];
  if (
    JSON.stringify(result.restoredUrls) !== JSON.stringify(expectedUrls) ||
    result.activeUrl !== expectedUrls[1] ||
    result.pinned !== true ||
    result.group.title !== "Archive acceptance" ||
    result.group.color !== "blue" ||
    result.archiveConsumed !== true ||
    typeof result.sessionBookmarkUrl !== "string"
  ) {
    throw new Error(`Hibernation contract failed: ${JSON.stringify(result)}`);
  }

  const newFeatureContract = await extensionPage.evaluate(async (base) => {
    const storedSettings = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...storedSettings.settings, protectPinned: true },
    });
    const urls = [`${base}/forced-protected`, `${base}/ordinary`];
    const sourceWindow = await chrome.windows.create({
      focused: false,
      url: urls,
    });
    if (sourceWindow.id === undefined) {
      throw new Error("The protection-override window has no ID.");
    }
    let sourceTabs = [];
    const sourceTabsDeadline = Date.now() + 5_000;
    while (Date.now() < sourceTabsDeadline) {
      sourceTabs = (
        await chrome.tabs.query({ windowId: sourceWindow.id })
      ).sort((left, right) => left.index - right.index);
      if (
        sourceTabs.length === urls.length &&
        sourceTabs.every((tab) => urls.includes(tab.pendingUrl ?? tab.url))
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (sourceTabs.length !== urls.length) {
      throw new Error("The protection-override tabs were not ready.");
    }
    if (sourceTabs[0]?.id === undefined) {
      throw new Error("The protected acceptance tab has no ID.");
    }
    await chrome.tabs.update(sourceTabs[0].id, { pinned: true });
    const protectedResult = await chrome.runtime.sendMessage({
      name: "Protected acceptance",
      type: "HIBERNATE_WINDOW",
      windowId: sourceWindow.id,
    });
    const forcedResult = await chrome.runtime.sendMessage({
      ignoreProtection: true,
      name: "Forced acceptance",
      type: "HIBERNATE_WINDOW",
      windowId: sourceWindow.id,
    });
    const archive = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const archivedTabs = [
      ...archive.tabs,
      ...archive.windows.flatMap((window) => window.tabs),
      ...archive.sessions.flatMap((session) =>
        session.windows.flatMap((window) => window.tabs),
      ),
    ].filter((tab) => urls.includes(tab.url));
    const bookmarked = await chrome.runtime.sendMessage({
      selection: {
        sessionIds: [],
        tabIds: archivedTabs.map((tab) => tab.bookmarkId),
        windowIds: [],
      },
      type: "BOOKMARK_ARCHIVE_SELECTION",
    });
    const countSavedUrls = async () => {
      const tree = await chrome.bookmarks.getTree();
      let count = 0;
      const visit = (nodes) => {
        for (const node of nodes) {
          if (urls.includes(node.url)) count += 1;
          if (node.children !== undefined) visit(node.children);
        }
      };
      visit(tree);
      return count;
    };
    const savedAfterBookmark = await countSavedUrls();
    const undo = await chrome.runtime.sendMessage({ type: "UNDO_ARCHIVE" });
    const savedAfterUndo = await countSavedUrls();
    const redo = await chrome.runtime.sendMessage({ type: "REDO_ARCHIVE" });
    const savedAfterRedo = await countSavedUrls();
    await chrome.storage.sync.set({
      settings: { ...storedSettings.settings, protectPinned: false },
    });
    return {
      archivedTabs: archivedTabs.length,
      bookmarked,
      forcedResult,
      protectedResult,
      redo,
      savedAfterBookmark,
      savedAfterRedo,
      savedAfterUndo,
      undo,
    };
  }, baseUrl);
  if (
    newFeatureContract.protectedResult?.archived !== 1 ||
    newFeatureContract.protectedResult?.skipped?.length !== 1 ||
    newFeatureContract.forcedResult?.archived !== 1 ||
    newFeatureContract.forcedResult?.skipped?.length !== 0 ||
    newFeatureContract.archivedTabs !== 2 ||
    newFeatureContract.bookmarked?.changed !== 2 ||
    newFeatureContract.savedAfterBookmark !== 2 ||
    newFeatureContract.undo?.changed !== true ||
    newFeatureContract.savedAfterUndo !== 0 ||
    newFeatureContract.redo?.changed !== true ||
    newFeatureContract.savedAfterRedo !== 2
  ) {
    throw new Error(
      `Protection override or Bookmark Selected failed: ${JSON.stringify(newFeatureContract)}`,
    );
  }

  const popupContractPage = await browser.newPage();
  await popupContractPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "networkidle0",
  });
  await popupContractPage.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  const popupHierarchyContract = await popupContractPage.evaluate(() => {
    const session = document.querySelector(".archive-session");
    const sessionGutter = session?.querySelector(".archive-session-windows");
    const window = document.querySelector(".archive-window");
    const tabGutter = window?.querySelector(".archive-tabs");
    const protection = document.querySelector("#protection-line");
    const url = document.querySelector("#current-tab-url");
    return {
      ignoreTooltips: [
        "#ignore-group-protection",
        "#ignore-window-protection",
        "#ignore-session-protection",
      ].every(
        (selector) =>
          document
            .querySelector(selector)
            ?.closest("label")
            ?.getAttribute("title") ===
          "Forces hibernation ignoring any protection settings.",
      ),
      protectionCopy:
        document.querySelector("#protect-activity-row span")?.textContent ===
          "Protect site's media and forms" &&
        (document.querySelector("#protect-site-row")?.getAttribute("title")
          ?.length ?? 0) > 0,
      sessionGutterMatches:
        sessionGutter !== null &&
        session !== null &&
        getComputedStyle(session).backgroundColor ===
          getComputedStyle(session.querySelector(":scope > summary"))
            .backgroundColor &&
        getComputedStyle(sessionGutter).backgroundColor ===
          getComputedStyle(session.querySelector(":scope > summary"))
            .backgroundColor &&
        getComputedStyle(sessionGutter).borderLeftStyle === "solid" &&
        getComputedStyle(sessionGutter).borderLeftWidth === "2px" &&
        getComputedStyle(sessionGutter).borderLeftColor ===
          getComputedStyle(
            sessionGutter.querySelector(":scope > .archive-window > summary"),
          ).borderTopColor &&
        sessionGutter.getBoundingClientRect().left >
          session.getBoundingClientRect().left + 20,
      tabGutterMatches:
        tabGutter !== null &&
        window !== null &&
        getComputedStyle(window).backgroundColor ===
          getComputedStyle(window.querySelector(":scope > summary"))
            .backgroundColor &&
        getComputedStyle(tabGutter).backgroundColor ===
          getComputedStyle(window.querySelector(":scope > summary"))
            .backgroundColor &&
        getComputedStyle(tabGutter).borderLeftStyle === "solid" &&
        getComputedStyle(tabGutter).borderLeftWidth === "2px" &&
        getComputedStyle(tabGutter).borderLeftColor ===
          getComputedStyle(tabGutter.querySelector(":scope > .archive-tab"))
            .borderTopColor &&
        tabGutter.getBoundingClientRect().left >
          window.getBoundingClientRect().left + 20,
      titleAndUrlOrder:
        document
          .querySelector(".current-tab-heading")
          ?.compareDocumentPosition(
            document.querySelector(".current-tab-panel"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING &&
        url !== null &&
        protection !== null &&
        url.getBoundingClientRect().bottom <=
          protection.getBoundingClientRect().top,
    };
  });
  if (
    !popupHierarchyContract.ignoreTooltips ||
    !popupHierarchyContract.protectionCopy ||
    !popupHierarchyContract.sessionGutterMatches ||
    !popupHierarchyContract.tabGutterMatches ||
    !popupHierarchyContract.titleAndUrlOrder
  ) {
    throw new Error(
      `Popup hierarchy contract failed: ${JSON.stringify(popupHierarchyContract)}`,
    );
  }
  await popupContractPage.close();

  const hibernatedPage = await browser.newPage();
  await hibernatedPage.goto(
    `chrome-extension://${extensionId}/hibernated.html`,
    { waitUntil: "networkidle0" },
  );
  await hibernatedPage.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  const archiveUi = await hibernatedPage.evaluate(() => ({
    bookmarkActions: document.querySelectorAll(".bookmark-action").length,
    mainTitleMatches:
      Number.parseFloat(
        getComputedStyle(document.querySelector("h1")).fontSize,
      ) === 48,
    chevrons: document.querySelectorAll(".archive-chevron").length,
    countDuplicatedInTitle: /\d+\s+tabs?$/u.test(
      document.querySelector(".archive-window-title")?.textContent ?? "",
    ),
    tableRows: document.querySelectorAll(".archive-window").length,
    standaloneRows: document.querySelectorAll(".archive-tab--standalone")
      .length,
    columnHeaders: document.querySelectorAll("[data-sort-key]").length,
    columnsSeparated:
      getComputedStyle(
        document.querySelector(".archive-table-head > :first-child"),
      ).borderRightStyle === "solid",
    headersCentered: [
      ...document.querySelectorAll(".archive-table-head > *"),
    ].every((heading) => getComputedStyle(heading).textAlign === "center"),
    columnsAligned: (() => {
      const headings = [
        ...document.querySelectorAll(".archive-table-head > *"),
      ];
      const firstRow = document.querySelector("#archive-list > *:first-child");
      const cells =
        firstRow !== null
          ? firstRow.matches(".archive-tab")
            ? [...firstRow.children]
            : [...(firstRow.querySelector(":scope > summary")?.children ?? [])]
          : [];
      return (
        headings.length === cells.length &&
        headings.every(
          (heading, index) =>
            Math.abs(
              heading.getBoundingClientRect().left -
                cells[index].getBoundingClientRect().left,
            ) < 1,
        )
      );
    })(),
    tableBackgroundTransparent:
      getComputedStyle(document.querySelector(".archive-table-shell"))
        .backgroundColor === "rgba(0, 0, 0, 0)",
    tableSidesRemoved: (() => {
      const shell = getComputedStyle(
        document.querySelector(".archive-table-shell"),
      );
      const heading = getComputedStyle(
        document.querySelector(".archive-table-head"),
      );
      return (
        shell.borderLeftStyle === "none" &&
        shell.borderRightStyle === "none" &&
        heading.boxShadow !== "none"
      );
    })(),
    dateTimeVisible: [...document.querySelectorAll(".archive-date")].every(
      (time) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(time.textContent ?? ""),
    ),
    dateTextProminent: [...document.querySelectorAll(".archive-date")].every(
      (time) => {
        const style = getComputedStyle(time);
        return (
          Number.parseFloat(style.fontSize) >= 16 &&
          Number.parseFloat(style.fontWeight) >= 600 &&
          style.color === "rgb(41, 71, 85)"
        );
      },
    ),
    datesSelectable: [...document.querySelectorAll(".archive-date")].every(
      (time) => {
        const style = getComputedStyle(time);
        return style.userSelect === "text" && style.cursor === "text";
      },
    ),
    sessionRows: document.querySelectorAll(".archive-session").length,
    typeCells: document.querySelectorAll(".archive-type").length,
    typeCellsCentered: [...document.querySelectorAll(".archive-type")].every(
      (type) => getComputedStyle(type).textAlign === "center",
    ),
    semanticTypeColors: (() => {
      const colors = ["session", "window", "tab", "group"].map(
        (type) =>
          getComputedStyle(
            document.querySelector(`.archive-${type} .archive-type`),
          ).color,
      );
      return new Set(colors).size === 4;
    })(),
    allEntrySideWalls: [
      ...document.querySelectorAll(
        ".archive-session > summary, .archive-window > summary, .archive-group > summary, .archive-tab",
      ),
    ].every((row) => getComputedStyle(row).boxShadow !== "none"),
    semanticRowSurfaces: (() => {
      const surfaces = [
        ".archive-session > summary",
        ".archive-window > summary",
        ".archive-group > summary",
        ".archive-tab",
      ].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundColor,
      );
      return new Set(surfaces).size === 4;
    })(),
    tabTitlesColored: (() => {
      const title = document.querySelector(".archive-tab-copy strong");
      const type = document.querySelector(".archive-tab .archive-type");
      return (
        title !== null &&
        type !== null &&
        getComputedStyle(title).color === getComputedStyle(type).color
      );
    })(),
    windowUsesOrange: (() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--archive-window-color)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return (
        getComputedStyle(
          document.querySelector(".archive-window .archive-type"),
        ).color === expected
      );
    })(),
    coloredHeadingTypes:
      document.querySelectorAll("h1 [class^='archive-color-']").length === 3,
    enlargedColoredSummary:
      document.querySelectorAll("#archive-summary [class^='archive-color-']")
        .length === 3 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector("#archive-summary")).fontSize,
      ) >= 16,
    namesHaveHoverText: [
      ...document.querySelectorAll(
        ".archive-session-title, .archive-window-title, .archive-tab-copy strong",
      ),
    ].every((name) => name.getAttribute("title") === name.textContent),
    windowActionsInHeader:
      document.querySelector(
        ".archive-window summary > .archive-window-actions",
      ) !== null,
    tabRenameActions:
      document.querySelectorAll(
        ".archive-tab-actions .archive-action-icon-rename",
      ).length === document.querySelectorAll(".archive-tab").length,
    renameTooltips: [
      ...document.querySelectorAll(".archive-action-icon-rename"),
    ].every((icon) => {
      const button = icon.closest("button");
      return (
        button?.title === "rename" &&
        button.getAttribute("aria-label")?.startsWith("Rename") === true
      );
    }),
    transferActions:
      document.querySelector("#export-archives") !== null &&
      document.querySelector("#import-archives") !== null &&
      document.querySelector("#restore-all")?.disabled === false &&
      document.querySelector("#clear-archives") !== null,
    historyAndDragControls:
      document.querySelector("#undo-archive") !== null &&
      document.querySelector("#redo-archive") !== null &&
      document.querySelector("#undo-archive .history-action-icon") !== null &&
      document.querySelector("#redo-archive .history-action-icon") !== null &&
      document.querySelector("#archive-root-drop-zone") !== null &&
      document.querySelectorAll('[draggable="true"]').length ===
        document.querySelectorAll(
          ".archive-session > summary, .archive-window > summary, .archive-group > summary, .archive-tab",
        ).length,
    bulkActionCopy:
      document.querySelector("#bookmark-selected")?.textContent?.trim() ===
        "Bookmark Selected" &&
      document.querySelector("#bookmark-selected")?.getAttribute("title")
        ?.length > 0 &&
      document.querySelector("#restore-selected")?.textContent?.trim() ===
        "Restore Selected" &&
      document.querySelector("#restore-selected .selection-action-icon") !==
        null &&
      document.querySelector(
        "#delete-selected .selection-action-icon-trash",
      ) !== null &&
      document.querySelector("#merge-selected-window")?.textContent?.trim() ===
        "Move To New Window" &&
      document.querySelector("#merge-selected-session")?.textContent?.trim() ===
        "Move To New Session" &&
      document.querySelector("#merge-selected")?.textContent?.trim() ===
        "Merge Selected" &&
      document.querySelector("#move-tabs-to-group")?.textContent?.trim() ===
        "Move To New Group" &&
      document.querySelector("#create-tab-group") === null &&
      document.querySelector("#restore-all")?.getAttribute("title")?.length >
        0 &&
      document.querySelector("#clear-archives")?.getAttribute("title")?.length >
        0,
    selectionControls:
      document.querySelector("#select-all-archives") !== null &&
      document.querySelector("#bookmark-selected") !== null &&
      document.querySelector("#restore-selected") !== null &&
      document.querySelector("#merge-selected-window") !== null &&
      document.querySelector("#merge-selected-session") !== null &&
      document.querySelector("#move-tabs-out") !== null &&
      document.querySelector("#move-windows-out") !== null &&
      document.querySelector("#duplicate-selected") !== null &&
      document.querySelector("#delete-selected") !== null &&
      document.querySelector("#select-matched") !== null &&
      document.querySelectorAll(".archive-selection-cell input").length ===
        document.querySelectorAll(
          ".archive-session, .archive-window, .archive-group, .archive-tab",
        ).length,
    pinControls:
      document.querySelector(
        '[data-sort-key="pinned"] .archive-pin-header-icon-outline',
      ) !== null &&
      document.querySelector(
        '[data-sort-key="pinned"] .archive-pin-header-icon-filled',
      ) !== null &&
      document.querySelectorAll(".archive-pin-cell .archive-pin-action")
        .length ===
        document.querySelectorAll(
          ".archive-session, .archive-window, .archive-group, .archive-tab",
        ).length,
    bookmarkHeaderIsIconOnly:
      document
        .querySelector('[data-sort-key="bookmarked"]')
        ?.textContent?.trim() === "" &&
      document.querySelector(
        '[data-sort-key="bookmarked"] .archive-bookmark-header-icon-outline',
      ) !== null &&
      document.querySelector(
        '[data-sort-key="bookmarked"] .archive-bookmark-header-icon-filled',
      ) !== null,
    clearAllBelowImport: (() => {
      const importButton = document.querySelector("#import-archives");
      const clearButton = document.querySelector("#clear-archives");
      return (
        importButton !== null &&
        clearButton !== null &&
        clearButton.getBoundingClientRect().top >=
          importButton.getBoundingClientRect().bottom
      );
    })(),
    textFilter:
      document.querySelector("#archive-text-filter") !== null &&
      document.querySelector("#archive-filter-results")?.textContent?.length >
        0,
    typographyEnlarged:
      Number.parseFloat(
        getComputedStyle(document.querySelector("header p")).fontSize,
      ) >= 18 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".archive-tab-copy strong"))
          .fontSize,
      ) >= 16 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".archive-tab-copy small"))
          .fontSize,
      ) >= 15,
    nestedTabIndentMatchesWindow: (() => {
      const list = document.querySelector(
        ".archive-session .archive-window .archive-tabs",
      );
      const row = list
        ?.closest(".archive-window")
        ?.querySelector(":scope > summary");
      return (
        list !== null &&
        row !== null &&
        getComputedStyle(list).backgroundColor ===
          getComputedStyle(row).backgroundColor
      );
    })(),
    disclosureSize:
      Number.parseFloat(
        getComputedStyle(document.querySelector(".archive-chevron")).fontSize,
      ) >= 24,
    enlargedTableText:
      Number.parseFloat(
        getComputedStyle(
          document.querySelector(".archive-table-head > :first-child"),
        ).fontSize,
      ) >= 13 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".archive-tab-copy strong"))
          .fontSize,
      ) >= 13,
    enlargedActionIcons:
      document
        .querySelector(
          ".archive-session-actions .archive-action-icon, .archive-window-actions .archive-action-icon, .archive-group-actions .archive-action-icon, .archive-tab-actions .archive-action-icon",
        )
        ?.getBoundingClientRect().width >= 30,
    enlargedPinIcons:
      document
        .querySelector(".archive-action-icon-pin")
        ?.getBoundingClientRect().width >= 26,
    enlargedUnpinnedIcon:
      document
        .querySelector(
          ".archive-pin-action:not(.is-pinned) .archive-action-icon-pin",
        )
        ?.getBoundingClientRect().width >= 30,
    hoverRestoreControls: (() => {
      const controls = [...document.querySelectorAll(".archive-name-restore")];
      const entries = document.querySelectorAll(
        ".archive-session, .archive-window, .archive-group, .archive-tab",
      ).length;
      const first = controls[0];
      if (!(first instanceof globalThis.HTMLElement)) return false;
      const icon = first.querySelector(".archive-hover-restore");
      if (!(icon instanceof globalThis.HTMLElement)) return false;
      const hidden = getComputedStyle(icon).opacity === "0";
      first.focus();
      first
        .getAnimations({ subtree: true })
        .forEach((animation) => animation.finish());
      const keyboardVisible =
        getComputedStyle(icon).opacity === "1" &&
        getComputedStyle(first).backgroundColor !== "rgba(0, 0, 0, 0)";
      first.blur();
      const transfer = new globalThis.DataTransfer();
      first.dispatchEvent(
        new globalThis.DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
      const dragsFromName =
        transfer.getData("application/x-htws-item").length > 0;
      first.dispatchEvent(
        new globalThis.DragEvent("dragend", { bubbles: true }),
      );
      const semantic = controls.every(
        (control) =>
          control.getAttribute("role") === "button" &&
          control.getAttribute("aria-label")?.startsWith("Restore") === true &&
          control.querySelector("strong") !== null &&
          control.querySelector(".archive-action-icon-restore") !== null,
      );
      return {
        controlCount: controls.length,
        dragsFromName,
        entryCount: entries,
        hidden,
        keyboardVisible,
        semantic,
        valid:
          controls.length === entries &&
          semantic &&
          hidden &&
          keyboardVisible &&
          dragsFromName,
      };
    })(),
    groupActionsSingleRow: (() => {
      const actions = document.querySelector(".archive-group-actions");
      if (actions === null) return false;
      return (
        getComputedStyle(actions).flexWrap === "nowrap" &&
        actions.scrollWidth <= actions.clientWidth
      );
    })(),
    stablePinIcon:
      document.querySelector(".archive-pin-action")?.textContent?.trim() ===
        "" && document.querySelector(".archive-pin-action svg") !== null,
    restoreUsesWindowIcon:
      document.querySelector(".archive-action-icon-restore")
        ?.childElementCount === 4,
    sortIndicatorStyled: (() => {
      const indicator = document.querySelector(
        '.archive-table-head [data-sort-key="date"] .sort-indicator',
      );
      if (indicator === null) return false;
      const style = getComputedStyle(indicator);
      return (
        indicator.getBoundingClientRect().width >= 22 &&
        style.backgroundColor !== "rgba(0, 0, 0, 0)"
      );
    })(),
    actionsBeforeType: (() => {
      const actions = document.querySelector(".actions-heading");
      const type = document.querySelector('[data-sort-key="type"]');
      return (
        actions !== null &&
        type !== null &&
        actions.getBoundingClientRect().left < type.getBoundingClientRect().left
      );
    })(),
    nameActionsSeamless: (() => {
      const name = document.querySelector('[data-sort-key="name"]');
      const actions = document.querySelector(".actions-heading");
      return (
        actions?.textContent?.trim() === "" &&
        name !== null &&
        getComputedStyle(name).borderRightStyle === "none"
      );
    })(),
    actionDividers: [
      ...document.querySelectorAll(
        ".archive-session-actions, .archive-window-actions, .archive-group-actions, .archive-tab-actions",
      ),
    ].every((actions) => getComputedStyle(actions).borderLeftStyle === "solid"),
  }));
  if (
    archiveUi.tableRows < 1 ||
    archiveUi.standaloneRows < 1 ||
    archiveUi.chevrons < archiveUi.tableRows ||
    archiveUi.bookmarkActions < 2 ||
    !archiveUi.mainTitleMatches ||
    archiveUi.columnHeaders !== 5 ||
    !archiveUi.columnsSeparated ||
    !archiveUi.headersCentered ||
    !archiveUi.columnsAligned ||
    !archiveUi.tableBackgroundTransparent ||
    !archiveUi.tableSidesRemoved ||
    !archiveUi.dateTimeVisible ||
    !archiveUi.dateTextProminent ||
    archiveUi.countDuplicatedInTitle ||
    !archiveUi.namesHaveHoverText ||
    archiveUi.sessionRows < 1 ||
    archiveUi.typeCells < 3 ||
    !archiveUi.typeCellsCentered ||
    !archiveUi.semanticTypeColors ||
    !archiveUi.allEntrySideWalls ||
    !archiveUi.semanticRowSurfaces ||
    !archiveUi.tabTitlesColored ||
    !archiveUi.windowUsesOrange ||
    !archiveUi.coloredHeadingTypes ||
    !archiveUi.enlargedColoredSummary ||
    !archiveUi.windowActionsInHeader ||
    !archiveUi.tabRenameActions ||
    !archiveUi.renameTooltips ||
    !archiveUi.transferActions ||
    !archiveUi.historyAndDragControls ||
    !archiveUi.bulkActionCopy ||
    !archiveUi.selectionControls ||
    !archiveUi.pinControls ||
    !archiveUi.bookmarkHeaderIsIconOnly ||
    !archiveUi.clearAllBelowImport ||
    !archiveUi.textFilter ||
    !archiveUi.typographyEnlarged ||
    !archiveUi.nestedTabIndentMatchesWindow ||
    !archiveUi.disclosureSize ||
    !archiveUi.enlargedTableText ||
    !archiveUi.enlargedActionIcons ||
    !archiveUi.enlargedPinIcons ||
    !archiveUi.enlargedUnpinnedIcon ||
    !archiveUi.hoverRestoreControls.valid ||
    !archiveUi.groupActionsSingleRow ||
    !archiveUi.stablePinIcon ||
    !archiveUi.restoreUsesWindowIcon ||
    !archiveUi.sortIndicatorStyled ||
    !archiveUi.actionsBeforeType ||
    !archiveUi.nameActionsSeamless ||
    !archiveUi.actionDividers
  ) {
    throw new Error(
      `Hibernated table controls are incomplete: ${JSON.stringify(archiveUi)}`,
    );
  }
  const rowSelectionClickContract = await hibernatedPage.evaluate(async () => {
    document.querySelector("#clear-selection")?.click();
    const first = document.querySelector(".archive-tab--standalone");
    const bookmarkId = first?.getAttribute("data-bookmark-id");
    if (!bookmarkId) return undefined;
    const row = () =>
      document.querySelector(
        `[data-bookmark-id="${globalThis.CSS.escape(bookmarkId)}"]`,
      );
    const selected = () =>
      row()?.querySelector(":scope > .archive-selection-cell input")
        ?.checked === true;
    const initialRow = row();
    const dateCell = initialRow?.querySelector(".archive-date-cell");
    const date = initialRow?.querySelector(".archive-date");
    const url = initialRow?.querySelector(".archive-tab-url");
    if (
      !(dateCell instanceof globalThis.HTMLElement) ||
      !(date instanceof globalThis.HTMLElement) ||
      !(url instanceof globalThis.HTMLElement)
    )
      return undefined;
    const compactDateTarget =
      date.getBoundingClientRect().height <
      dateCell.getBoundingClientRect().height * 0.6;
    date.click();
    url.click();
    const textClicksIgnored = !selected();
    row()?.querySelector(".archive-date-cell")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dateCellSelected = selected();
    row()?.querySelector(".archive-date-cell")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dateCellDeselected = !selected();
    row()?.querySelector(".archive-type")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rowSelected = selected();
    row()?.querySelector(".archive-type")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rowDeselected = !selected();
    return {
      compactDateTarget,
      dateCellDeselected,
      dateCellSelected,
      rowDeselected,
      rowSelected,
      textClicksIgnored,
    };
  });
  if (
    !rowSelectionClickContract?.compactDateTarget ||
    !rowSelectionClickContract.textClicksIgnored ||
    !rowSelectionClickContract.dateCellSelected ||
    !rowSelectionClickContract.dateCellDeselected ||
    !rowSelectionClickContract.rowSelected ||
    !rowSelectionClickContract.rowDeselected
  ) {
    throw new Error(
      `Row click selection failed: ${JSON.stringify(rowSelectionClickContract)}`,
    );
  }
  const hierarchicalSelection = await hibernatedPage.evaluate(() => {
    const session = document.querySelector(".archive-session");
    const checkbox = session?.querySelector(
      ":scope > summary .archive-selection-cell input",
    );
    if (!(checkbox instanceof HTMLInputElement)) return undefined;
    checkbox.click();
    const selectedSession = document.querySelector(".archive-session");
    const descendants = [
      ...(selectedSession?.querySelectorAll(
        ".archive-window .archive-selection-cell input, .archive-tab .archive-selection-cell input",
      ) ?? []),
    ];
    const result = {
      descendantsSelected: descendants.every(
        (item) => item.checked && item.disabled,
      ),
      mergeEnabled:
        document.querySelector("#merge-selected-window")?.disabled === false &&
        document.querySelector("#merge-selected-session")?.disabled === false,
      highlighted:
        selectedSession?.classList.contains("is-selected") === true &&
        [...(selectedSession?.querySelectorAll(".is-selected") ?? [])].length >
          0,
      summary: document.querySelector("#selection-summary")?.textContent,
    };
    document.querySelector("#clear-selection")?.click();
    return result;
  });
  if (
    !hierarchicalSelection?.descendantsSelected ||
    !hierarchicalSelection.mergeEnabled ||
    !hierarchicalSelection.highlighted ||
    !hierarchicalSelection.summary?.includes("tab")
  ) {
    throw new Error(
      `Hierarchical selection failed: ${JSON.stringify(hierarchicalSelection)}`,
    );
  }
  const rangeSelection = await hibernatedPage.evaluate(() => {
    const visibleCheckboxes = () =>
      [
        ...document.querySelectorAll(
          ".archive-selection-cell input[data-selection-id][data-selection-type]",
        ),
      ].filter((item) => item.getClientRects().length > 0);
    const topLevel = [
      ...document.querySelectorAll(
        "#archive-list > .archive-session > summary .archive-selection-cell input, #archive-list > .archive-window > summary .archive-selection-cell input, #archive-list > .archive-tab .archive-selection-cell input",
      ),
    ].filter((item) => item.getClientRects().length > 0 && !item.disabled);
    if (topLevel.length < 2) return { available: false };
    const key = (item) =>
      `${item.dataset.selectionType}:${item.dataset.selectionId}`;
    const order = visibleCheckboxes().map(key);
    const anchor = topLevel[0];
    const targetKey = key(topLevel.at(-1));
    const anchorKey = key(anchor);
    anchor.click();
    const target = visibleCheckboxes().find((item) => key(item) === targetKey);
    if (!(target instanceof HTMLInputElement)) return { available: false };
    target.dispatchEvent(
      new globalThis.MouseEvent("click", { bubbles: true, shiftKey: true }),
    );
    const checked = new Map(
      visibleCheckboxes().map((item) => [key(item), item.checked]),
    );
    const first = order.indexOf(anchorKey);
    const last = order.indexOf(targetKey);
    const expected = order.slice(
      Math.min(first, last),
      Math.max(first, last) + 1,
    );
    const result = {
      available: true,
      expected: expected.length,
      selected: expected.filter((id) => checked.get(id) === true).length,
    };
    document.querySelector("#clear-selection")?.click();
    return result;
  });
  if (
    !rangeSelection.available ||
    rangeSelection.expected < 2 ||
    rangeSelection.selected !== rangeSelection.expected
  ) {
    throw new Error(
      `Shift-click range selection failed: ${JSON.stringify(rangeSelection)}`,
    );
  }
  const deletionShortcutContract = await hibernatedPage.evaluate(async () => {
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, confirmSelectedDeletion: true },
    });
    const checkbox = [
      ...document.querySelectorAll(".archive-selection-cell input"),
    ].find((item) => !item.disabled && item.getClientRects().length > 0);
    const filter = document.querySelector("#archive-text-filter");
    if (
      !(checkbox instanceof HTMLInputElement) ||
      !(filter instanceof HTMLInputElement)
    )
      return undefined;
    checkbox.click();
    filter.focus();
    filter.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const editableIgnored =
      document.querySelector("#delete-selection-dialog") === null;
    filter.blur();
    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector("#delete-selection-dialog");
    if (!(dialog instanceof globalThis.HTMLDialogElement)) return undefined;
    const deleteOpened = dialog.open;
    dialog.querySelector('button[value="cancel"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Backspace",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const backspaceOpened = dialog.open;
    const hasSuppressChoice =
      dialog.querySelector("#delete-selection-suppress") !== null;
    dialog.querySelector('button[value="cancel"]')?.click();
    document.querySelector("#clear-selection")?.click();
    return {
      backspaceOpened,
      deleteOpened,
      editableIgnored,
      hasSuppressChoice,
    };
  });
  if (
    !deletionShortcutContract?.editableIgnored ||
    !deletionShortcutContract.deleteOpened ||
    !deletionShortcutContract.backspaceOpened ||
    !deletionShortcutContract.hasSuppressChoice
  ) {
    throw new Error(
      `Deletion keyboard shortcut contract failed: ${JSON.stringify(deletionShortcutContract)}`,
    );
  }
  const sharedDeletionDialog = await hibernatedPage.evaluate(async () => {
    const waitForDialog = async () => {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const candidate = document.querySelector("#delete-selection-dialog");
        if (candidate instanceof globalThis.HTMLDialogElement && candidate.open)
          return candidate;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return undefined;
    };
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, confirmSelectedDeletion: true },
    });
    document.querySelector("#clear-selection")?.click();
    const tabRow = document.querySelector(".archive-tab--standalone");
    const tabTitle = tabRow
      ?.querySelector(".archive-tab-title-line strong")
      ?.textContent?.trim();
    const rowErase = tabRow?.querySelector(
      ".archive-tab-actions .danger-action",
    );
    if (!(rowErase instanceof HTMLButtonElement) || !tabTitle) return undefined;
    rowErase.click();
    const rowDialog = await waitForDialog();
    if (rowDialog === undefined) return undefined;
    const rowMessage = rowDialog.querySelector("#delete-selection-message");
    const rowNamedTab =
      rowMessage?.textContent?.trim() === `Tab: “${tabTitle}”`;
    const rowUsesSharedDialog =
      rowDialog.querySelector("#delete-selection-suppress") !== null;
    const heading = rowDialog.querySelector("h2");
    const suppressLabel = rowDialog.querySelector(".delete-confirm-suppress");
    const actions = rowDialog.querySelector(".delete-confirm-actions");
    const suppress = rowDialog.querySelector("#delete-selection-suppress");
    const cancel = actions?.querySelector('button[value="cancel"]');
    const confirm = actions?.querySelector('button[value="confirm"]');
    const baseSuppressBackground =
      suppressLabel === null
        ? undefined
        : getComputedStyle(suppressLabel).backgroundColor;
    if (suppress instanceof HTMLInputElement) suppress.focus();
    suppressLabel
      ?.getAnimations({ subtree: true })
      .forEach((animation) => animation.finish());
    const suppressHighlight =
      suppressLabel !== null &&
      getComputedStyle(suppressLabel).backgroundColor !==
        baseSuppressBackground;
    if (cancel instanceof HTMLButtonElement) cancel.focus();
    cancel
      ?.getAnimations({ subtree: true })
      .forEach((animation) => animation.finish());
    const cancelHighlight =
      cancel !== null &&
      getComputedStyle(cancel).backgroundColor !== "rgb(248, 251, 252)";
    if (confirm instanceof HTMLButtonElement) confirm.focus();
    confirm
      ?.getAnimations({ subtree: true })
      .forEach((animation) => animation.finish());
    const confirmHighlight =
      confirm !== null &&
      getComputedStyle(confirm).backgroundColor !== "rgb(248, 251, 252)";
    const dialogTypography =
      heading?.textContent?.trim() === "Delete Entry?" &&
      Number.parseFloat(getComputedStyle(heading).fontSize) >= 29 &&
      rowMessage !== null &&
      Number.parseFloat(getComputedStyle(rowMessage).fontSize) >= 19 &&
      suppressLabel !== null &&
      Number.parseFloat(getComputedStyle(suppressLabel).fontSize) >= 16 &&
      actions !== null &&
      Math.abs(
        suppressLabel.getBoundingClientRect().top -
          actions.getBoundingClientRect().top,
      ) <= 8 &&
      [...actions.querySelectorAll("button")].every(
        (button) => Number.parseFloat(getComputedStyle(button).fontSize) >= 17,
      ) &&
      cancel?.title === "" &&
      confirm?.title === "" &&
      suppressLabel?.title ===
        "This setting can be changed in the Settings page." &&
      suppressHighlight &&
      cancelHighlight &&
      confirmHighlight &&
      rowMessage.textContent?.includes("undo") === false;
    rowDialog.querySelector('button[value="cancel"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const verifyNamedContainer = async (selector, type, countTypes) => {
      const row = document.querySelector(selector);
      const title = row
        ?.querySelector(`.archive-${type}-title`)
        ?.textContent?.trim();
      const erase = row?.querySelector(
        `:scope > summary .archive-${type}-actions .danger-action`,
      );
      if (!(erase instanceof HTMLButtonElement) || !title) return false;
      erase.click();
      const dialog = await waitForDialog();
      if (dialog === undefined) return false;
      const message = dialog.querySelector("#delete-selection-message");
      const valid =
        message?.textContent
          ?.trim()
          .startsWith(
            `${type.charAt(0).toUpperCase()}${type.slice(1)}: “${title}”`,
          ) === true &&
        countTypes.every(
          (countType) =>
            message.querySelector(`.archive-delete-count-${countType}`) !==
            null,
        ) &&
        message.textContent?.includes("undo") === false;
      dialog.querySelector('button[value="cancel"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return valid;
    };
    const namedSession = await verifyNamedContainer(
      ".archive-session",
      "session",
      ["window", "tab"],
    );
    const namedWindow = await verifyNamedContainer(
      ".archive-window:not(.archive-window--group)",
      "window",
      ["tab"],
    );

    const selectable = [
      ...document.querySelectorAll(".archive-selection-cell input"),
    ].filter(
      (item) =>
        item instanceof HTMLInputElement &&
        !item.disabled &&
        item.getClientRects().length > 0,
    );
    if (selectable.length < 2) return undefined;
    selectable[0].click();
    const second = [
      ...document.querySelectorAll(".archive-selection-cell input"),
    ].find(
      (item) =>
        item instanceof HTMLInputElement &&
        !item.checked &&
        !item.disabled &&
        item.getClientRects().length > 0,
    );
    if (!(second instanceof HTMLInputElement)) return undefined;
    second.click();
    document.querySelector("#delete-selected")?.click();
    const aggregateDialog = await waitForDialog();
    if (aggregateDialog === undefined) return undefined;
    const aggregateMessage = aggregateDialog.querySelector(
      "#delete-selection-message",
    );
    const coloredCounts = [
      ...(aggregateMessage?.querySelectorAll(".archive-delete-count") ?? []),
    ];
    const aggregateUsesCounts =
      coloredCounts.length > 0 &&
      coloredCounts.every(
        (count) =>
          getComputedStyle(count).color !==
          getComputedStyle(aggregateMessage).color,
      ) &&
      aggregateMessage?.textContent?.includes(" · ") === true &&
      aggregateMessage.textContent.includes("undo") === false;
    aggregateDialog.querySelector('button[value="cancel"]')?.click();
    document.querySelector("#clear-selection")?.click();
    return {
      aggregateUsesCounts,
      dialogTypography,
      namedSession,
      namedWindow,
      rowNamedTab,
      rowUsesSharedDialog,
    };
  });
  if (
    !sharedDeletionDialog?.rowNamedTab ||
    !sharedDeletionDialog.rowUsesSharedDialog ||
    !sharedDeletionDialog.dialogTypography ||
    !sharedDeletionDialog.namedSession ||
    !sharedDeletionDialog.namedWindow ||
    !sharedDeletionDialog.aggregateUsesCounts
  ) {
    throw new Error(
      `Shared deletion dialog failed: ${JSON.stringify(sharedDeletionDialog)}`,
    );
  }
  const deletionWarningSuppression = await hibernatedPage.evaluate(async () => {
    const waitFor = async (predicate, timeout = 5_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return undefined;
    };
    const firstSelectable = () =>
      [...document.querySelectorAll(".archive-selection-cell input")].find(
        (item) => !item.disabled && item.getClientRects().length > 0,
      );
    const before = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const first = firstSelectable();
    if (before.tabCount < 1 || !(first instanceof HTMLInputElement))
      return undefined;
    first.click();
    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    const dialog = await waitFor(() => {
      const candidate = document.querySelector("#delete-selection-dialog");
      return candidate instanceof globalThis.HTMLDialogElement && candidate.open
        ? candidate
        : undefined;
    });
    if (!(dialog instanceof globalThis.HTMLDialogElement)) return undefined;
    const suppress = dialog.querySelector("#delete-selection-suppress");
    if (!(suppress instanceof HTMLInputElement)) return undefined;
    suppress.checked = true;
    dialog.querySelector('button[value="confirm"]')?.click();
    const afterWarning = await waitFor(async () => {
      const [archives, stored] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }),
        chrome.storage.sync.get("settings"),
      ]);
      return archives.tabCount < before.tabCount &&
        stored.settings?.confirmSelectedDeletion === false
        ? archives
        : undefined;
    });
    if (afterWarning === undefined) return undefined;
    const firstUndo = await chrome.runtime.sendMessage({
      type: "UNDO_ARCHIVE",
    });
    if (
      !(await waitFor(async () => {
        const archives = await chrome.runtime.sendMessage({
          type: "GET_ARCHIVES",
        });
        return archives.tabCount === before.tabCount;
      }))
    )
      return undefined;
    if (!(await waitFor(() => firstSelectable()))) return undefined;
    firstSelectable().click();
    document.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Backspace",
      }),
    );
    const afterSuppressed = await waitFor(async () => {
      const archives = await chrome.runtime.sendMessage({
        type: "GET_ARCHIVES",
      });
      return archives.tabCount < before.tabCount ? archives : undefined;
    });
    const bypassedDialog = !dialog.open;
    const secondUndo = await chrome.runtime.sendMessage({
      type: "UNDO_ARCHIVE",
    });
    await waitFor(async () => {
      const archives = await chrome.runtime.sendMessage({
        type: "GET_ARCHIVES",
      });
      return archives.tabCount === before.tabCount;
    });
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, confirmSelectedDeletion: true },
    });
    return {
      bypassedDialog,
      firstUndo: firstUndo?.changed,
      secondUndo: secondUndo?.changed,
      suppressed: afterSuppressed !== undefined,
      warningDeleted: afterWarning.tabCount < before.tabCount,
    };
  });
  if (
    !deletionWarningSuppression?.warningDeleted ||
    deletionWarningSuppression.firstUndo !== true ||
    !deletionWarningSuppression.suppressed ||
    !deletionWarningSuppression.bypassedDialog ||
    deletionWarningSuppression.secondUndo !== true
  ) {
    throw new Error(
      `Deletion warning suppression failed: ${JSON.stringify(deletionWarningSuppression)}`,
    );
  }
  const restoreAllWarning = await hibernatedPage.evaluate(async () => {
    const before = (await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }))
      .tabCount;
    let warning = "";
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = (message) => {
      warning = String(message);
      return false;
    };
    document.querySelector("#restore-all")?.click();
    globalThis.confirm = originalConfirm;
    const after = (await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }))
      .tabCount;
    return { after, before, warning };
  });
  if (
    restoreAllWarning.after !== restoreAllWarning.before ||
    !restoreAllWarning.warning.includes("Restore all")
  ) {
    throw new Error(
      `Restore All warning contract failed: ${JSON.stringify(restoreAllWarning)}`,
    );
  }
  const clearAllWarning = await hibernatedPage.evaluate(async () => {
    const before = (await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }))
      .tabCount;
    let warning = "";
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = (message) => {
      warning = String(message);
      return false;
    };
    document.querySelector("#clear-archives")?.click();
    globalThis.confirm = originalConfirm;
    const after = (await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }))
      .tabCount;
    return { after, before, warning };
  });
  if (
    clearAllWarning.before <= 0 ||
    clearAllWarning.after !== clearAllWarning.before ||
    !clearAllWarning.warning.includes("can undo")
  ) {
    throw new Error(
      `Clear All warning contract failed: ${JSON.stringify(clearAllWarning)}`,
    );
  }
  const historyContract = await hibernatedPage.evaluate(async () => {
    const allTabs = (snapshot) => [
      ...snapshot.tabs,
      ...snapshot.windows.flatMap((window) => window.tabs),
      ...snapshot.sessions.flatMap((session) =>
        session.windows.flatMap((window) => window.tabs),
      ),
    ];
    const before = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const tab = allTabs(before)[0];
    const renamed = `${tab.title} history-check`;
    await chrome.runtime.sendMessage({
      bookmarkId: tab.bookmarkId,
      name: renamed,
      type: "RENAME_ARCHIVE_TAB",
    });
    const status = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVE_HISTORY",
    });
    const undo = await chrome.runtime.sendMessage({ type: "UNDO_ARCHIVE" });
    const afterUndo = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    const redo = await chrome.runtime.sendMessage({ type: "REDO_ARCHIVE" });
    const afterRedo = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVES",
    });
    await chrome.runtime.sendMessage({ type: "UNDO_ARCHIVE" });
    return {
      original: tab.title,
      redoChanged: redo.changed,
      redoTitle: allTabs(afterRedo).find(
        (candidate) => candidate.bookmarkId === tab.bookmarkId,
      )?.title,
      renamed,
      undoChanged: undo.changed,
      undoLabel: status.undoLabel,
      undoTitle: allTabs(afterUndo).find(
        (candidate) => candidate.bookmarkId === tab.bookmarkId,
      )?.title,
    };
  });
  if (
    historyContract.undoChanged !== true ||
    historyContract.redoChanged !== true ||
    historyContract.undoLabel !== "Rename Tab" ||
    historyContract.undoTitle !== historyContract.original ||
    historyContract.redoTitle !== historyContract.renamed
  ) {
    throw new Error(
      `Archive history contract failed: ${JSON.stringify(historyContract)}`,
    );
  }
  const nestedUngroupContract = await hibernatedPage.evaluate(async () => {
    const before = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const windows = [
      ...before.windows,
      ...before.sessions.flatMap((session) => session.windows),
    ];
    const group = windows
      .flatMap((window) => window.groups ?? [])
      .find((candidate) => candidate.tabs.length > 0);
    const tab = group?.tabs[0];
    if (group === undefined || tab === undefined) return { available: false };
    const groupRow = [...document.querySelectorAll(".archive-group")].find(
      (row) => row.dataset.groupKey === group.key,
    );
    const target = groupRow?.parentElement;
    if (target === undefined || target === null) return { available: false };
    const transfer = new globalThis.DataTransfer();
    transfer.setData(
      "application/x-htws-item",
      JSON.stringify({ id: tab.bookmarkId, type: "tab" }),
    );
    target.dispatchEvent(
      new globalThis.DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    target.dispatchEvent(
      new globalThis.DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    let after;
    let movedTab;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      after = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
      const afterWindows = [
        ...after.windows,
        ...after.sessions.flatMap((session) => session.windows),
      ];
      movedTab = afterWindows
        .flatMap((window) => window.tabs)
        .find((candidate) => candidate.bookmarkId === tab.bookmarkId);
      if (movedTab?.groupKey === undefined) break;
    }
    const ungrouped = movedTab?.groupKey === undefined;
    if (ungrouped) await chrome.runtime.sendMessage({ type: "UNDO_ARCHIVE" });
    return { available: true, ungrouped };
  });
  if (
    nestedUngroupContract.available !== true ||
    nestedUngroupContract.ungrouped !== true
  ) {
    throw new Error(
      `Nested drag ungroup contract failed: ${JSON.stringify(nestedUngroupContract)}`,
    );
  }
  const pageDropContract = await hibernatedPage.evaluate(async () => {
    const before = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const nestedTab =
      before.windows[0]?.tabs[0] ?? before.sessions[0]?.windows[0]?.tabs[0];
    if (nestedTab === undefined) return { available: false };
    const transfer = new globalThis.DataTransfer();
    transfer.setData(
      "application/x-htws-item",
      JSON.stringify({ id: nestedTab.bookmarkId, type: "tab" }),
    );
    const target = document.querySelector("#page-status");
    target.dispatchEvent(
      new globalThis.DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    target.dispatchEvent(
      new globalThis.DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    let after;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      after = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
      if (after.tabs.some((tab) => tab.bookmarkId === nestedTab.bookmarkId))
        break;
    }
    const history = await chrome.runtime.sendMessage({
      type: "GET_ARCHIVE_HISTORY",
    });
    const movedToRoot =
      after?.tabs.some((tab) => tab.bookmarkId === nestedTab.bookmarkId) ===
      true;
    if (movedToRoot) await chrome.runtime.sendMessage({ type: "UNDO_ARCHIVE" });
    return {
      available: true,
      movedToRoot,
      undoLabel: history.undoLabel,
    };
  });
  if (
    pageDropContract.available !== true ||
    pageDropContract.movedToRoot !== true ||
    pageDropContract.undoLabel !== "Drag Move"
  ) {
    throw new Error(
      `Page-wide drag detach contract failed: ${JSON.stringify(pageDropContract)}`,
    );
  }
  const archiveTransferContract = await hibernatedPage.evaluate(async () => {
    let exportedBlob;
    let exportedName;
    URL.createObjectURL = (blob) => {
      exportedBlob = blob;
      return "blob:archive-acceptance";
    };
    HTMLAnchorElement.prototype.click = function captureDownload() {
      exportedName = this.download;
    };
    document.querySelector("#export-archives")?.click();
    for (
      let attempt = 0;
      attempt < 50 && !(exportedBlob instanceof Blob);
      attempt += 1
    ) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
    if (!(exportedBlob instanceof Blob)) return { exportFailed: true };
    const exported = JSON.parse(await exportedBlob.text());
    const imported = await chrome.runtime.sendMessage({
      data: exported,
      type: "IMPORT_ARCHIVES",
    });
    return {
      filename: exportedName,
      formatVersion: exported?.formatVersion,
      importedTabs: imported?.importedTabs,
      nestedEntries: exported?.archive?.entries?.every(
        (entry) =>
          entry.type === "tab" ||
          (entry.type === "window" && Array.isArray(entry.tabs)) ||
          (entry.type === "session" && Array.isArray(entry.windows)),
      ),
      skippedDuplicates: imported?.skippedDuplicates,
    };
  });
  if (
    archiveTransferContract.formatVersion !== 2 ||
    !archiveTransferContract.filename?.endsWith(".json") ||
    archiveTransferContract.importedTabs !== 0 ||
    archiveTransferContract.nestedEntries !== true ||
    !(archiveTransferContract.skippedDuplicates > 0)
  ) {
    throw new Error(
      `Archive transfer failed: ${JSON.stringify(archiveTransferContract)}`,
    );
  }
  await hibernatedPage.reload({ waitUntil: "networkidle0" });
  await hibernatedPage.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  await hibernatedPage.hover('[data-sort-key="name"]');
  const nameHoverWorks = await hibernatedPage.evaluate(() => {
    const nameHeader = document.querySelector('[data-sort-key="name"]');
    const actionsHeader = document.querySelector(".actions-heading");
    const tableHeader = document.querySelector(".archive-table-head");
    if (!nameHeader || !actionsHeader || !tableHeader) return false;
    const nameBackground = getComputedStyle(nameHeader).backgroundColor;
    return (
      nameBackground === getComputedStyle(actionsHeader).backgroundColor &&
      nameBackground !== getComputedStyle(tableHeader).backgroundColor
    );
  });
  if (!nameHoverWorks) {
    throw new Error("Name hover did not include the Actions column.");
  }
  await hibernatedPage.click('[data-sort-key="name"]');
  const nameSortWorks = await hibernatedPage.evaluate(() => {
    const names = [...document.querySelectorAll("#archive-list > *")].map(
      (entry) => entry.getAttribute("data-name") ?? "",
    );
    const nameHeader = document.querySelector('[data-sort-key="name"]');
    const actionsHeader = document.querySelector(".actions-heading");
    return (
      names.every(
        (name, index) =>
          index === 0 ||
          names[index - 1].localeCompare(name, undefined, {
            sensitivity: "base",
          }) <= 0,
      ) &&
      nameHeader !== null &&
      actionsHeader !== null &&
      getComputedStyle(nameHeader).backgroundColor ===
        getComputedStyle(actionsHeader).backgroundColor
    );
  });
  if (!nameSortWorks)
    throw new Error("Name sorting did not reorder the table.");
  await hibernatedPage.click('[data-sort-key="type"]');
  const typeSortWorks = await hibernatedPage.evaluate(() => {
    const types = [...document.querySelectorAll("#archive-list > *")].map(
      (entry) => entry.getAttribute("data-type") ?? "",
    );
    const ranks = { session: 0, window: 1, tab: 2 };
    const typeHeader = document.querySelector('[data-sort-key="type"]');
    const rowsAreSorted = types.every(
      (type, index) => index === 0 || ranks[types[index - 1]] <= ranks[type],
    );
    return {
      works:
        rowsAreSorted &&
        typeHeader !== null &&
        typeHeader.textContent?.trim() === "Type: Sessions" &&
        getComputedStyle(typeHeader).whiteSpace === "nowrap" &&
        typeHeader.scrollWidth <= typeHeader.clientWidth &&
        getComputedStyle(typeHeader).backgroundColor !==
          getComputedStyle(document.querySelector(".archive-table-head"))
            .backgroundColor,
      types,
      label: typeHeader?.textContent?.trim(),
      whiteSpace: typeHeader ? getComputedStyle(typeHeader).whiteSpace : null,
      width: typeHeader
        ? { scroll: typeHeader.scrollWidth, client: typeHeader.clientWidth }
        : null,
    };
  });
  if (!typeSortWorks.works) {
    throw new Error(
      `Type sorting did not cycle the archive rows: ${JSON.stringify(typeSortWorks)}`,
    );
  }
  await hibernatedPage.click('[data-sort-key="type"]');
  const windowFirstSortWorks = await hibernatedPage.evaluate(() => {
    const types = [...document.querySelectorAll("#archive-list > *")].map(
      (entry) => entry.getAttribute("data-type") ?? "",
    );
    const ranks = { window: 0, tab: 1, session: 2 };
    return {
      label: document
        .querySelector('[data-sort-key="type"]')
        ?.textContent?.trim(),
      sorted: types.every(
        (type, index) => index === 0 || ranks[types[index - 1]] <= ranks[type],
      ),
      types,
    };
  });
  await hibernatedPage.click('[data-sort-key="type"]');
  const tabFirstSortWorks = await hibernatedPage.evaluate(() => {
    const types = [...document.querySelectorAll("#archive-list > *")].map(
      (entry) => entry.getAttribute("data-type") ?? "",
    );
    const ranks = { tab: 0, session: 1, window: 2 };
    return {
      label: document
        .querySelector('[data-sort-key="type"]')
        ?.textContent?.trim(),
      sorted: types.every(
        (type, index) => index === 0 || ranks[types[index - 1]] <= ranks[type],
      ),
      types,
    };
  });
  if (
    !windowFirstSortWorks.sorted ||
    windowFirstSortWorks.label !== "Type: Windows" ||
    !tabFirstSortWorks.sorted ||
    tabFirstSortWorks.label !== "Type: Tabs"
  ) {
    throw new Error(
      `Type sorting did not cycle through all three priorities: ${JSON.stringify({ tabFirstSortWorks, windowFirstSortWorks })}`,
    );
  }
  await hibernatedPage.click('[data-sort-key="bookmarked"]');
  const bookmarkedSortState = await hibernatedPage.evaluate(() => {
    const header = document.querySelector('[data-sort-key="bookmarked"]');
    return {
      background: header ? getComputedStyle(header).backgroundColor : "",
      hasArrow: header?.querySelector(".sort-indicator") !== null,
      arrowDirection: header
        ?.querySelector(".sort-indicator")
        ?.getAttribute("data-direction"),
      filledIconVisible:
        header?.querySelector(".archive-bookmark-header-icon-filled") !==
          null &&
        getComputedStyle(
          header.querySelector(".archive-bookmark-header-icon-filled"),
        ).display !== "none",
      notSquished: header !== null && header.scrollWidth <= header.clientWidth,
    };
  });
  if (
    bookmarkedSortState.background !== "rgb(244, 200, 75)" ||
    !bookmarkedSortState.hasArrow ||
    bookmarkedSortState.arrowDirection !== "descending" ||
    !bookmarkedSortState.notSquished ||
    !bookmarkedSortState.filledIconVisible
  ) {
    throw new Error(
      `Bookmarked sort state is incomplete: ${JSON.stringify(bookmarkedSortState)}`,
    );
  }
  await hibernatedPage.click('[data-sort-key="bookmarked"]');
  const bookmarkedReverseState = await hibernatedPage.evaluate(() => {
    const header = document.querySelector('[data-sort-key="bookmarked"]');
    return {
      ariaSort: header?.getAttribute("aria-sort"),
      background: header ? getComputedStyle(header).backgroundColor : "",
      arrowDirection: header
        ?.querySelector(".sort-indicator")
        ?.getAttribute("data-direction"),
      outlineIconVisible:
        header?.querySelector(".archive-bookmark-header-icon-outline") !==
          null &&
        getComputedStyle(
          header.querySelector(".archive-bookmark-header-icon-outline"),
        ).display !== "none",
    };
  });
  if (
    bookmarkedReverseState.ariaSort !== "ascending" ||
    bookmarkedReverseState.arrowDirection !== "ascending" ||
    !bookmarkedReverseState.outlineIconVisible ||
    bookmarkedReverseState.background === "rgb(244, 200, 75)"
  ) {
    throw new Error(
      `Bookmarked reverse sort stayed highlighted: ${JSON.stringify(bookmarkedReverseState)}`,
    );
  }
  const archiveFilterContract = await hibernatedPage.evaluate(() => {
    const filter = document.querySelector("#archive-text-filter");
    if (!(filter instanceof HTMLInputElement)) return undefined;
    filter.value = "127.0.0.1";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    const visibleRows = document.querySelectorAll("#archive-list > *").length;
    const hitLabel = document.querySelector(
      "#archive-filter-results",
    )?.textContent;
    return { hitLabel, visibleRows };
  });
  if (
    !(archiveFilterContract?.visibleRows > 0) ||
    !archiveFilterContract.hitLabel?.includes("hit")
  ) {
    throw new Error(
      `Archive filtering failed: ${JSON.stringify(archiveFilterContract)}`,
    );
  }
  await hibernatedPage.click("#select-matched");
  const matchedSelected = await hibernatedPage.evaluate(() => ({
    pressed:
      document
        .querySelector("#select-matched")
        ?.getAttribute("aria-pressed") === "true",
    selectedTabs: document.querySelectorAll(
      ".archive-tab .archive-selection-cell input:checked",
    ).length,
  }));
  await hibernatedPage.evaluate(() => {
    const checkbox = document.querySelector(
      ".archive-tab .archive-selection-cell input:checked",
    );
    if (checkbox instanceof HTMLInputElement) checkbox.click();
  });
  const manuallyDeselected = await hibernatedPage.evaluate(
    () =>
      document
        .querySelector("#select-matched")
        ?.getAttribute("aria-pressed") === "false",
  );
  await hibernatedPage.click("#select-matched");
  const reselected = await hibernatedPage.evaluate(
    () =>
      document
        .querySelector("#select-matched")
        ?.getAttribute("aria-pressed") === "true",
  );
  await hibernatedPage.click("#select-matched");
  const deselected = await hibernatedPage.evaluate(() => ({
    pressed:
      document
        .querySelector("#select-matched")
        ?.getAttribute("aria-pressed") === "false",
    selectedTabs: document.querySelectorAll(
      ".archive-tab .archive-selection-cell input:checked",
    ).length,
  }));
  if (
    !matchedSelected.pressed ||
    matchedSelected.selectedTabs < 1 ||
    !manuallyDeselected ||
    !reselected ||
    !deselected.pressed ||
    deselected.selectedTabs !== 0
  ) {
    throw new Error(
      `Select Matched toggle failed: ${JSON.stringify({ deselected, manuallyDeselected, matchedSelected, reselected })}`,
    );
  }
  await hibernatedPage.evaluate(() => {
    const filter = document.querySelector("#archive-text-filter");
    if (!(filter instanceof HTMLInputElement)) return;
    filter.value = "";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await hibernatedPage.evaluate(() => {
    const row = document.querySelector(".archive-list > .archive-window");
    if (row && "open" in row) row.open = true;
  });
  const orderBeforeBookmark = await hibernatedPage.$$eval(
    "#archive-list > *",
    (entries) =>
      entries.map(
        (entry) =>
          entry.getAttribute("data-session-id") ??
          entry.getAttribute("data-folder-id") ??
          entry.getAttribute("data-bookmark-id"),
      ),
  );
  const windowBookmark = await hibernatedPage.$(
    ".archive-list > .archive-window > summary .bookmark-action",
  );
  if (windowBookmark === null) {
    throw new Error("The window bookmark action is missing from its row.");
  }
  await windowBookmark.click();
  await hibernatedPage.waitForFunction(() => {
    const button = document.querySelector(
      ".archive-list > .archive-window > summary .bookmark-action",
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const bookmarkUiState = await hibernatedPage.evaluate(() => {
    const row = document.querySelector(".archive-list > .archive-window");
    const button = row?.querySelector(":scope > summary .bookmark-action");
    return {
      bookmarked: button?.classList.contains("is-bookmarked") === true,
      nestedTabsBookmarked: [
        ...(row?.querySelectorAll(".archive-tab .bookmark-action") ?? []),
      ].every((tabButton) => tabButton.classList.contains("is-bookmarked")),
      disclosureOpen: row?.hasAttribute("open") === true,
      order: [...document.querySelectorAll("#archive-list > *")].map(
        (entry) =>
          entry.getAttribute("data-session-id") ??
          entry.getAttribute("data-folder-id") ??
          entry.getAttribute("data-bookmark-id"),
      ),
    };
  });
  if (
    !bookmarkUiState.bookmarked ||
    !bookmarkUiState.nestedTabsBookmarked ||
    !bookmarkUiState.disclosureOpen ||
    JSON.stringify(bookmarkUiState.order) !==
      JSON.stringify(orderBeforeBookmark)
  ) {
    throw new Error(
      `A bookmarked window did not retain its row and saved state: ${JSON.stringify(bookmarkUiState)}`,
    );
  }
  const renamedWindowBookmark = await hibernatedPage.evaluate(async () => {
    const row = document.querySelector(".archive-list > .archive-window");
    const folderId = row?.getAttribute("data-folder-id");
    if (!folderId) return { ok: false, title: undefined };
    const response = await chrome.runtime.sendMessage({
      folderId,
      name: "Renamed acceptance window",
      type: "RENAME_ARCHIVE_WINDOW",
    });
    const stored = await chrome.storage.local.get("hibernateArchiveStore");
    const savedFolderId =
      stored.hibernateArchiveStore?.windows?.[folderId]?.savedFolderId;
    const [savedFolder] = savedFolderId
      ? await chrome.bookmarks.get(savedFolderId)
      : [];
    return { ok: response?.ok === true, title: savedFolder?.title };
  });
  if (
    !renamedWindowBookmark.ok ||
    !renamedWindowBookmark.title?.startsWith("Renamed acceptance window - ")
  ) {
    throw new Error(
      `Renaming a window did not rename its bookmark folder: ${JSON.stringify(renamedWindowBookmark)}`,
    );
  }
  const removeWindowBookmark = await hibernatedPage.$(
    ".archive-list > .archive-window > summary .bookmark-action",
  );
  if (removeWindowBookmark === null) {
    throw new Error("The bookmarked window lost its bookmark action.");
  }
  await removeWindowBookmark.click();
  await hibernatedPage.waitForFunction(() => {
    const button = document.querySelector(
      ".archive-list > .archive-window > summary .bookmark-action",
    );
    return (
      button instanceof HTMLButtonElement &&
      !button.disabled &&
      !button.classList.contains("is-bookmarked")
    );
  });

  const selectableUrlContract = await hibernatedPage.evaluate(() => {
    const url = document.querySelector(".archive-tab-url");
    const item = url?.closest(".archive-tab");
    if (
      !(url instanceof globalThis.HTMLElement) ||
      !(item instanceof globalThis.HTMLElement)
    ) {
      return false;
    }
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(url);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectedText = selection?.toString();
    selection?.removeAllRanges();
    const draggableBeforePointer = item.draggable;
    url.dispatchEvent(
      new globalThis.PointerEvent("pointerdown", { bubbles: true }),
    );
    const draggableDuringSelection = item.draggable;
    globalThis.dispatchEvent(new globalThis.PointerEvent("pointerup"));
    return (
      getComputedStyle(url).userSelect === "text" &&
      getComputedStyle(url).cursor === "text" &&
      selectedText === url.textContent &&
      url.getAttribute("title") === url.textContent &&
      draggableBeforePointer &&
      !draggableDuringSelection &&
      item.draggable
    );
  });
  if (!selectableUrlContract) {
    throw new Error("Hibernated URLs are not selectable full-URL text.");
  }

  const selectableDateContract = await hibernatedPage.evaluate(() => {
    const time = document.querySelector(".archive-date");
    const item = time?.closest(".archive-tab, summary");
    if (
      !(time instanceof globalThis.HTMLElement) ||
      !(item instanceof globalThis.HTMLElement)
    ) {
      return false;
    }
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(time);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectedText = selection?.toString();
    selection?.removeAllRanges();
    const draggableBeforePointer = item.draggable;
    time.dispatchEvent(
      new globalThis.PointerEvent("pointerdown", { bubbles: true }),
    );
    const draggableDuringSelection = item.draggable;
    globalThis.dispatchEvent(new globalThis.PointerEvent("pointerup"));
    return (
      getComputedStyle(time).userSelect === "text" &&
      getComputedStyle(time).cursor === "text" &&
      selectedText === time.textContent &&
      draggableBeforePointer &&
      !draggableDuringSelection &&
      item.draggable
    );
  });
  if (!selectableDateContract) {
    throw new Error("Hibernated dates are not selectable text.");
  }

  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "networkidle0",
  });
  await popupPage.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  const popupUi = await popupPage.evaluate(() => {
    const summary = document.querySelector(".archive-window summary");
    const tab = document.querySelector(".archive-window .archive-tab");
    const nestedList = tab?.closest(".archive-tabs");
    const tabActions = document.querySelector(".archive-tab-actions");
    const iconNames = ["restore", "bookmark", "erase"];
    return {
      checkboxBelowHibernate:
        document
          .querySelector("#hibernate-current")
          ?.compareDocumentPosition(
            document.querySelector("#protect-site-row"),
          ) === Node.DOCUMENT_POSITION_FOLLOWING,
      activityCheckboxBelowSiteCheckbox:
        document
          .querySelector("#protect-site-row")
          ?.compareDocumentPosition(
            document.querySelector("#protect-activity-row"),
          ) === Node.DOCUMENT_POSITION_FOLLOWING,
      iconSetComplete: iconNames.every(
        (name) =>
          document.querySelector(
            `.archive-window-actions .archive-action-icon-${name}`,
          ) !== null,
      ),
      renameActionsRemoved:
        document.querySelector(".popup-shell .archive-action-icon-rename") ===
        null,
      semanticRowColors: (() => {
        const surfaces = [
          ".archive-session > summary",
          ".archive-window > summary",
          ".archive-tab",
        ].map(
          (selector) =>
            getComputedStyle(document.querySelector(selector)).backgroundColor,
        );
        const titles = [
          ".archive-session-title",
          ".archive-window-title",
          ".archive-tab-copy strong",
        ].map(
          (selector) =>
            getComputedStyle(document.querySelector(selector)).color,
        );
        return new Set(surfaces).size === 3 && new Set(titles).size === 3;
      })(),
      archivePaletteShifted:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--archive-window-color")
          .includes(" 68)") &&
        getComputedStyle(document.documentElement)
          .getPropertyValue("--archive-tab-color")
          .includes(" 220)"),
      popupUrlsHaveFullHoverText: [
        ...document.querySelectorAll(".archive-tab-url"),
      ].every(
        (url) =>
          url.getAttribute("title")?.startsWith("http") &&
          url.getAttribute("title") !== url.textContent,
      ),
      labelsHidden: [
        ...document.querySelectorAll(".archive-window-actions .button-label"),
      ].every((label) => getComputedStyle(label).display === "none"),
      nestedTabAttached:
        tab !== null &&
        summary !== null &&
        nestedList !== null &&
        nestedList.getBoundingClientRect().left >
          summary.getBoundingClientRect().left + 20 &&
        getComputedStyle(nestedList).borderLeftStyle === "solid" &&
        getComputedStyle(nestedList).borderLeftWidth === "2px" &&
        getComputedStyle(nestedList).borderLeftColor ===
          getComputedStyle(nestedList.querySelector(":scope > .archive-tab"))
            .borderTopColor,
      standaloneTabPresent:
        document.querySelector(".archive-tab--standalone") !== null,
      tabActionsRightAligned:
        tab !== null &&
        tabActions !== null &&
        getComputedStyle(tabActions).justifyContent === "flex-end" &&
        Math.abs(
          tab.getBoundingClientRect().right -
            tabActions.getBoundingClientRect().right,
        ) < 16,
      titlesPresent: [
        ...document.querySelectorAll(".archive-window-actions button"),
      ].every((button) => button.getAttribute("title")?.trim()),
      hibernateHelpPresent: ["hibernate-window", "hibernate-session"].every(
        (id) => document.getElementById(id)?.getAttribute("title")?.trim(),
      ),
      hibernateButtonsCompact: ["hibernate-window", "hibernate-session"].every(
        (id) =>
          document.getElementById(id)?.getBoundingClientRect().height <= 34,
      ),
      archiveTransferControls: (() => {
        const heading = document.querySelector(".archive-section-heading");
        const actions = document.querySelector(
          ".popup-archive-transfer-actions",
        );
        const table = document.querySelector(".archive-table-shell");
        const exportButton = document.querySelector("#export-archives");
        const importButton = document.querySelector("#import-archives");
        return (
          heading !== null &&
          actions !== null &&
          table !== null &&
          exportButton?.getAttribute("title")?.trim() !== "" &&
          importButton?.getAttribute("title")?.trim() !== "" &&
          heading.compareDocumentPosition(actions) ===
            Node.DOCUMENT_POSITION_FOLLOWING &&
          actions.compareDocumentPosition(table) ===
            Node.DOCUMENT_POSITION_FOLLOWING &&
          getComputedStyle(actions).justifyContent === "flex-end"
        );
      })(),
    };
  });
  if (
    !popupUi.checkboxBelowHibernate ||
    !popupUi.activityCheckboxBelowSiteCheckbox ||
    !popupUi.iconSetComplete ||
    !popupUi.renameActionsRemoved ||
    !popupUi.semanticRowColors ||
    !popupUi.archivePaletteShifted ||
    !popupUi.popupUrlsHaveFullHoverText ||
    !popupUi.labelsHidden ||
    !popupUi.nestedTabAttached ||
    !popupUi.standaloneTabPresent ||
    !popupUi.tabActionsRightAligned ||
    !popupUi.titlesPresent ||
    !popupUi.hibernateHelpPresent ||
    !popupUi.hibernateButtonsCompact ||
    !popupUi.archiveTransferControls
  ) {
    throw new Error(
      `Popup archive controls are incomplete: ${JSON.stringify(popupUi)}`,
    );
  }
  const popupTabBookmark = await popupPage.$(
    ".archive-list > .archive-tab--standalone .archive-tab-actions .bookmark-action",
  );
  if (popupTabBookmark === null) {
    throw new Error("The popup tab bookmark action is missing.");
  }
  const popupArchiveBookmarkId = await popupPage.evaluate(() =>
    document
      .querySelector(
        ".archive-list > .archive-tab--standalone .archive-tab-actions .bookmark-action",
      )
      ?.closest(".archive-tab")
      ?.getAttribute("data-bookmark-id"),
  );
  await popupTabBookmark.click();
  await popupPage.waitForFunction(
    'document.querySelector(".archive-list > .archive-tab--standalone .archive-tab-actions .bookmark-action")?.classList.contains("is-bookmarked") === true',
  );
  const popupSavedBookmarkId = await popupPage.evaluate(
    async (archiveBookmarkId) => {
      const stored = await chrome.storage.local.get("hibernateArchiveStore");
      const windows = stored.hibernateArchiveStore?.windows ?? {};
      for (const metadata of Object.values(windows)) {
        const tab = metadata?.tabs?.[archiveBookmarkId];
        if (tab?.savedBookmarkId) return tab.savedBookmarkId;
      }
      return undefined;
    },
    popupArchiveBookmarkId,
  );
  const popupBookmarkExists =
    typeof popupSavedBookmarkId === "string" &&
    (await popupPage.evaluate(
      async (bookmarkId) =>
        (await chrome.bookmarks.get(bookmarkId)).length === 1,
      popupSavedBookmarkId,
    ));
  if (!popupBookmarkExists) {
    throw new Error("The popup did not create the tab's browser bookmark.");
  }
  const renamedTabBookmark = await popupPage.evaluate(
    async ({ archiveBookmarkId, savedBookmarkId }) => {
      const response = await chrome.runtime.sendMessage({
        bookmarkId: archiveBookmarkId,
        name: "Renamed acceptance tab",
        type: "RENAME_ARCHIVE_TAB",
      });
      const [savedBookmark] = await chrome.bookmarks.get(savedBookmarkId);
      const snapshot = await chrome.runtime.sendMessage({
        type: "GET_ARCHIVES",
      });
      const archivedTab = snapshot.tabs.find(
        (tab) => tab.bookmarkId === archiveBookmarkId,
      );
      return {
        archiveTitle: archivedTab?.title,
        ok: response?.ok === true,
        title: savedBookmark?.title,
      };
    },
    {
      archiveBookmarkId: popupArchiveBookmarkId,
      savedBookmarkId: popupSavedBookmarkId,
    },
  );
  if (
    !renamedTabBookmark.ok ||
    renamedTabBookmark.title !== "Renamed acceptance tab" ||
    renamedTabBookmark.archiveTitle !== "Renamed acceptance tab"
  ) {
    throw new Error(
      `Renaming a tab did not rename its browser bookmark: ${JSON.stringify(renamedTabBookmark)}`,
    );
  }
  await popupPage.evaluate(() => {
    const button = document.querySelector(
      ".archive-list > .archive-tab--standalone .archive-tab-actions .bookmark-action",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("The popup remove-bookmark action disappeared.");
    }
    button.click();
  });
  await popupPage.waitForFunction(
    'document.querySelector(".archive-list > .archive-tab--standalone .archive-tab-actions .bookmark-action")?.classList.contains("is-bookmarked") === false',
  );
  const popupBookmarkRemoved = await popupPage.evaluate(
    async (bookmarkId) =>
      chrome.bookmarks
        .get(bookmarkId)
        .then((nodes) => nodes.length === 0)
        .catch(() => true),
    popupSavedBookmarkId,
  );
  if (!popupBookmarkRemoved) {
    throw new Error("The popup did not remove the tab's browser bookmark.");
  }
  const recentEvent = await popupPage.evaluate(() => {
    const status = document.querySelector(".popup-nav #action-note");
    return {
      text: status?.textContent,
      title: status?.getAttribute("title"),
    };
  });
  if (
    recentEvent.text !== "Saved bookmark removed; hibernation entry remains." ||
    recentEvent.title !== recentEvent.text
  ) {
    throw new Error(
      `The popup footer did not retain the latest event: ${JSON.stringify(recentEvent)}`,
    );
  }

  const failedProtectedImport = await hibernatedPage.evaluate(async () =>
    chrome.runtime.sendMessage({
      data: {
        entries: [
          {
            action: "hibernate",
            detail: "Skipped because the tab was protected.",
            id: "acceptance-protected-hibernation-failure",
            occurredAt: Date.now(),
            outcome: "failure",
            tabs: [
              {
                title: "Protected tab",
                url: "https://example.com/protected",
              },
            ],
            target: "tab",
          },
        ],
        exportedAt: new Date().toISOString(),
        formatVersion: 1,
        kind: "htws-activity",
        product: "Hibernate Tabs, Windows, and Sessions",
      },
      type: "IMPORT_ACTIVITY_LOG",
    }),
  );
  if (failedProtectedImport?.imported !== 1) {
    throw new Error(
      `The protected-tab failure fixture was not imported: ${JSON.stringify(failedProtectedImport)}`,
    );
  }

  const activityPage = await browser.newPage();
  await activityPage.goto(`chrome-extension://${extensionId}/activity.html`, {
    waitUntil: "networkidle0",
  });
  await activityPage.waitForFunction(
    'document.querySelectorAll(".activity-entry").length > 0',
  );
  const activityUi = await activityPage.evaluate(() => ({
    dateSort: document.querySelector('[data-sort-key="date"]') !== null,
    exportEnabled: document.querySelector("#export-log")?.disabled === false,
    headerProminent:
      Number.parseFloat(
        getComputedStyle(document.querySelector("h1")).fontSize,
      ) >= 48 &&
      Number.parseFloat(
        getComputedStyle(
          document.querySelector(
            "header p:not(.product-name):not(.retention-summary)",
          ),
        ).fontSize,
      ) >= 17,
    productName:
      document.querySelector(".product-name")?.textContent?.trim() ===
      "Hibernate Tabs, Windows, and Sessions",
    headerBoxed: (() => {
      const header = document.querySelector("header");
      const style = getComputedStyle(header);
      return (
        style.borderTopWidth === "1px" &&
        style.borderRadius !== "0px" &&
        document.querySelector(".eyebrow") === null &&
        Number.parseFloat(
          getComputedStyle(document.querySelector("h1")).marginBottom,
        ) <= 2
      );
    })(),
    importEnabled: document.querySelector("#import-log")?.disabled === false,
    transferButtonsUseIcons:
      document.querySelector("#export-log")?.textContent?.trim() === "Export" &&
      document.querySelector("#import-log")?.textContent?.trim() === "Import" &&
      document.querySelector("#export-log .transfer-action-icon") !== null &&
      document.querySelector("#import-log .transfer-action-icon") !== null,
    transferIconDirections:
      document.querySelector("#export-log svg path")?.getAttribute("d") ===
        "M12 15V4" &&
      document.querySelector("#import-log svg path")?.getAttribute("d") ===
        "M12 3v11",
    filterHitCount:
      document.querySelector("#filter-results")?.textContent?.length > 0,
    retentionVisible:
      document.querySelector("#retention-summary")?.textContent?.length > 0,
    retentionVariable:
      document
        .querySelector(".retention-variable")
        ?.getAttribute("data-tooltip")
        ?.includes('"Activity History"') === true,
    retentionProminent:
      Number.parseFloat(
        getComputedStyle(document.querySelector(".retention-summary")).fontSize,
      ) >= 24 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".retention-variable"))
          .fontSize,
      ) >
        Number.parseFloat(
          getComputedStyle(document.querySelector(".retention-summary"))
            .fontSize,
        ),
    sortIndicatorLarge:
      document.querySelector(".sort-indicator")?.getBoundingClientRect()
        .width >= 22,
    textFilter: document.querySelector("#activity-text-filter") !== null,
    typeFilter:
      document.querySelectorAll("#activity-type-filter option").length === 6,
    failedHibernationHasNoRestore: (() => {
      const failures = [
        ...document.querySelectorAll(
          '.activity-entry[data-action="hibernate"][data-outcome="failure"]',
        ),
      ];
      return (
        failures.length > 0 &&
        failures.every(
          (entry) => entry.querySelector(".entry-actions button") === null,
        )
      );
    })(),
    singleRestoreOnly: [...document.querySelectorAll(".entry-actions")].every(
      (actions) => {
        const buttons = [...actions.querySelectorAll("button")];
        return (
          buttons.length <= 1 &&
          buttons.every((button) => button.textContent?.trim() === "Restore")
        );
      },
    ),
    noUndoCopy: !document.body.textContent?.includes("Undo hibernation"),
  }));
  if (Object.values(activityUi).some((value) => value !== true)) {
    throw new Error(
      `The activity controls are incomplete: ${JSON.stringify(activityUi)}`,
    );
  }
  const activityCountBeforeLiveUpdate = await activityPage.$$eval(
    ".activity-entry",
    (items) => items.length,
  );
  const liveUpdateHibernation = await activityPage.evaluate(async (base) => {
    const tab = await chrome.tabs.create({
      active: false,
      url: `${base}/activity-live-update`,
    });
    if (tab.id === undefined) return undefined;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(tab.id);
      if (current.status === "complete") break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    return chrome.runtime.sendMessage({
      tabId: tab.id,
      type: "HIBERNATE_TAB",
    });
  }, baseUrl);
  if (liveUpdateHibernation?.archived !== 1) {
    throw new Error(
      `The live-update tab could not be hibernated: ${JSON.stringify(liveUpdateHibernation)}`,
    );
  }
  await activityPage.waitForFunction(
    (before) => document.querySelectorAll(".activity-entry").length > before,
    {},
    activityCountBeforeLiveUpdate,
  );
  const exportContract = await activityPage.evaluate(async () => {
    let exportedBlob;
    let exportedName;
    URL.createObjectURL = (blob) => {
      exportedBlob = blob;
      return "blob:activity-acceptance";
    };
    HTMLAnchorElement.prototype.click = function captureDownload() {
      exportedName = this.download;
    };
    document.querySelector("#export-log")?.click();
    if (!(exportedBlob instanceof Blob)) return undefined;
    const payload = JSON.parse(await exportedBlob.text());
    return {
      entryCount: payload.entries?.length,
      filename: exportedName,
      formatVersion: payload.formatVersion,
      groupedWindows: payload.entries?.some(
        (entry) => Array.isArray(entry.windows) && entry.windows.length > 0,
      ),
    };
  });
  if (
    !(exportContract?.entryCount > 0) ||
    exportContract.formatVersion !== 1 ||
    exportContract.groupedWindows !== true ||
    !exportContract.filename?.endsWith(".json")
  ) {
    throw new Error(
      `Activity JSON export failed: ${JSON.stringify(exportContract)}`,
    );
  }
  const activityImportContract = await activityPage.evaluate(async () => {
    const entries = await chrome.runtime.sendMessage({
      type: "GET_ACTIVITY_LOG",
    });
    return chrome.runtime.sendMessage({
      data: {
        entries,
        exportedAt: new Date().toISOString(),
        formatVersion: 1,
        kind: "htws-activity",
        product: "Hibernate Tabs, Windows, and Sessions",
      },
      type: "IMPORT_ACTIVITY_LOG",
    });
  });
  if (
    activityImportContract?.imported !== 0 ||
    !(activityImportContract?.skippedDuplicates > 0)
  ) {
    throw new Error(
      `Activity import failed: ${JSON.stringify(activityImportContract)}`,
    );
  }
  const optionsPage = await browser.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "networkidle0",
  });
  await optionsPage.select("#activity-retention", "custom");
  await optionsPage.evaluate(() => {
    const input = document.querySelector("#activity-retention-custom");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Custom activity retention input is missing.");
    }
    input.value = "45";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await optionsPage.waitForFunction(async () => {
    const stored = await chrome.storage.sync.get("settings");
    return stored.settings?.activityRetentionDays === 45;
  });
  await optionsPage.select("#activity-retention", "7");
  await optionsPage.waitForFunction(async () => {
    const stored = await chrome.storage.sync.get("settings");
    return stored.settings?.activityRetentionDays === 7;
  });
  const deletionWarningToggle = await optionsPage.evaluate(async () => {
    const input = document.querySelector("#confirm-selected-deletion");
    if (!(input instanceof HTMLInputElement)) return undefined;
    const initial = input.checked;
    input.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const disabled = (await chrome.storage.sync.get("settings")).settings
      ?.confirmSelectedDeletion;
    input.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const enabled = (await chrome.storage.sync.get("settings")).settings
      ?.confirmSelectedDeletion;
    return { disabled, enabled, initial };
  });
  if (
    deletionWarningToggle?.initial !== true ||
    deletionWarningToggle.disabled !== false ||
    deletionWarningToggle.enabled !== true
  ) {
    throw new Error(
      `Deletion warning setting failed: ${JSON.stringify(deletionWarningToggle)}`,
    );
  }
  await activityPage.evaluate(async () => {
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, internalPageBehavior: "keep-open" },
    });
  });
  await optionsPage.select("#internal-page-behavior", "archive");
  await optionsPage.waitForFunction(async () => {
    const stored = await chrome.storage.sync.get("settings");
    return stored.settings?.internalPageBehavior === "archive";
  });
  await activityPage.waitForFunction(
    'document.querySelector("#retention-summary")?.textContent?.includes("7 days")',
  );
  const activityFilterContract = await activityPage.evaluate(() => {
    const type = document.querySelector("#activity-type-filter");
    const text = document.querySelector("#activity-text-filter");
    if (!(type instanceof HTMLSelectElement)) return undefined;
    if (!(text instanceof HTMLInputElement)) return undefined;
    type.value = "restore";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    text.value = "127.0.0.1";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const visible = [...document.querySelectorAll(".activity-entry")];
    return {
      allRestore: visible.every(
        (entry) => entry.getAttribute("data-action") === "restore",
      ),
      count: visible.length,
      hitLabel: document.querySelector("#filter-results")?.textContent,
    };
  });
  if (
    !activityFilterContract?.allRestore ||
    !(activityFilterContract.count > 0) ||
    !activityFilterContract.hitLabel?.includes("hit")
  ) {
    throw new Error(
      `Activity filtering failed: ${JSON.stringify(activityFilterContract)}`,
    );
  }
  const exactRestore = await activityPage.evaluate(async () => {
    const activity = await chrome.runtime.sendMessage({
      type: "GET_ACTIVITY_LOG",
    });
    const hibernatedTab = activity.find(
      (entry) =>
        entry.action === "hibernate" &&
        entry.target === "tab" &&
        entry.outcome !== "failure" &&
        entry.archiveId,
    );
    if (!hibernatedTab) return undefined;
    return chrome.runtime.sendMessage({
      entryId: hibernatedTab.id,
      type: "RESTORE_ACTIVITY_ENTRY",
    });
  });
  if (exactRestore?.fallback !== false || exactRestore.restored !== 1) {
    throw new Error(
      `Activity archive-first restore failed: ${JSON.stringify(exactRestore)}`,
    );
  }
  const fallbackRecovery = await activityPage.evaluate(async () => {
    const activity = await chrome.runtime.sendMessage({
      type: "GET_ACTIVITY_LOG",
    });
    const restoredEntry = activity.find(
      (entry) => entry.action === "restore" && entry.tabs.length > 0,
    );
    if (!restoredEntry) return undefined;
    return chrome.runtime.sendMessage({
      entryId: restoredEntry.id,
      type: "RESTORE_ACTIVITY_ENTRY",
    });
  });
  if (fallbackRecovery?.fallback !== true || !(fallbackRecovery.restored > 0)) {
    throw new Error(
      `Activity URL fallback recovery failed: ${JSON.stringify(fallbackRecovery)}`,
    );
  }

  const internalArchiveContract = await activityPage.evaluate(async () => {
    const settings = await chrome.storage.sync.get("settings");
    const internalWindow = await chrome.windows.create({
      url: "brave://bookmarks/",
    });
    if (internalWindow.id === undefined) return undefined;
    const [internalTab] = await chrome.tabs.query({
      windowId: internalWindow.id,
    });
    if (internalTab?.id === undefined) return undefined;
    const response = await chrome.runtime.sendMessage({
      ignoreProtection: true,
      type: "HIBERNATE_WINDOW",
      windowId: internalWindow.id,
    });
    const originalTabClosed = await chrome.tabs
      .get(internalTab.id)
      .then(() => false)
      .catch(() => true);
    const archives = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const archivedWindow = archives.windows.find((window) =>
      window.tabs.some(
        (tab) =>
          tab.url.startsWith("brave://") || tab.url.startsWith("chrome://"),
      ),
    );
    const activity = await chrome.runtime.sendMessage({
      type: "GET_ACTIVITY_LOG",
    });
    const success = activity.find(
      (entry) =>
        entry.action === "hibernate" &&
        entry.target === "window" &&
        entry.outcome === "success" &&
        entry.tabs.some(
          (tab) =>
            tab.url.startsWith("brave://") || tab.url.startsWith("chrome://"),
        ),
    );
    return {
      activityRecordedInternalUrl: success?.tabs.some(
        (tab) =>
          tab.url.startsWith("brave://") || tab.url.startsWith("chrome://"),
      ),
      archived: response?.archived,
      defaultBehavior: settings.settings?.internalPageBehavior ?? "archive",
      folderId: archivedWindow?.folderId,
      originalTabClosed,
    };
  });
  if (
    internalArchiveContract?.archived !== 1 ||
    internalArchiveContract.defaultBehavior !== "archive" ||
    !internalArchiveContract.folderId ||
    !internalArchiveContract.originalTabClosed ||
    !internalArchiveContract.activityRecordedInternalUrl
  ) {
    throw new Error(
      `Internal browser page archiving failed: ${JSON.stringify(internalArchiveContract)}`,
    );
  }
  await hibernatedPage.reload({ waitUntil: "networkidle0" });
  const internalBookmarkControlsHidden = await hibernatedPage.evaluate(
    (folderId) => {
      const window = document.querySelector(
        `.archive-window[data-folder-id="${globalThis.CSS.escape(folderId)}"]`,
      );
      return (
        window !== null &&
        window.querySelector(".archive-bookmark-cell button") === null &&
        window.querySelector(".archive-tab .archive-bookmark-cell button") ===
          null
      );
    },
    internalArchiveContract.folderId,
  );
  if (!internalBookmarkControlsHidden) {
    throw new Error("Internal archive entries exposed bookmark controls.");
  }
  const internalRestoreContract = await activityPage.evaluate(
    async (folderId) => {
      const response = await chrome.runtime.sendMessage({
        folderId,
        type: "RESTORE_ARCHIVE_WINDOW",
      });
      const internalTab = (await chrome.tabs.query({})).find(
        (tab) =>
          (tab.url?.startsWith("brave://") ||
            tab.url?.startsWith("chrome://")) &&
          tab.url.includes("bookmarks"),
      );
      if (internalTab?.windowId !== undefined) {
        await chrome.windows.remove(internalTab.windowId);
      }
      return {
        restored: response?.restored,
        restoredUrl: internalTab?.url,
      };
    },
    internalArchiveContract.folderId,
  );
  if (
    internalRestoreContract.restored !== 1 ||
    !internalRestoreContract.restoredUrl
  ) {
    throw new Error(
      `Internal browser page restoration failed: ${JSON.stringify(internalRestoreContract)}`,
    );
  }
  await activityPage.evaluate(async () => {
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, internalPageBehavior: "keep-open" },
    });
  });
  const keepOpenContract = await activityPage.evaluate(async () => {
    const window = await chrome.windows.create({ url: "brave://extensions/" });
    if (window.id === undefined) return undefined;
    const [tab] = await chrome.tabs.query({ windowId: window.id });
    const response = await chrome.runtime.sendMessage({
      ignoreProtection: true,
      type: "HIBERNATE_WINDOW",
      windowId: window.id,
    });
    const remainedOpen =
      tab?.id !== undefined &&
      (await chrome.tabs
        .get(tab.id)
        .then(() => true)
        .catch(() => false));
    await chrome.windows.remove(window.id);
    return { error: response?.error, remainedOpen };
  });
  if (
    !keepOpenContract?.remainedOpen ||
    !keepOpenContract.error?.includes("configured to keep internal")
  ) {
    throw new Error(
      `Keep-open internal-page behavior failed: ${JSON.stringify(keepOpenContract)}`,
    );
  }
  await activityPage.evaluate(async () => {
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: {
        ...stored.settings,
        internalPageBehavior: "close-and-log",
      },
    });
  });
  const closeAndLogContract = await activityPage.evaluate(async () => {
    const window = await chrome.windows.create({ url: "brave://extensions/" });
    if (window.id === undefined) return undefined;
    const [tab] = await chrome.tabs.query({ windowId: window.id });
    const response = await chrome.runtime.sendMessage({
      ignoreProtection: true,
      type: "HIBERNATE_WINDOW",
      windowId: window.id,
    });
    const closed =
      tab?.id !== undefined &&
      (await chrome.tabs
        .get(tab.id)
        .then(() => false)
        .catch(() => true));
    return {
      archived: response?.archived,
      closed,
      detail: response?.detail,
    };
  });
  if (
    closeAndLogContract?.archived !== 0 ||
    !closeAndLogContract.closed ||
    !closeAndLogContract.detail?.includes("without an archive entry")
  ) {
    throw new Error(
      `Close-and-log internal-page behavior failed: ${JSON.stringify(closeAndLogContract)}`,
    );
  }
  await activityPage.evaluate(async () => {
    const stored = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({
      settings: { ...stored.settings, internalPageBehavior: "archive" },
    });
  });

  const restoreSelectedContract = await activityPage.evaluate(async () => {
    const before = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const session = before.sessions[0];
    const window = session?.windows[0] ?? before.windows[0];
    const tab = window?.tabs[0] ?? before.tabs[0];
    const selection = {
      groupIds: [],
      sessionIds: session === undefined ? [] : [session.sessionId],
      tabIds: tab === undefined ? [] : [tab.bookmarkId],
      windowIds: window === undefined ? [] : [window.folderId],
    };
    const response = await chrome.runtime.sendMessage({
      selection,
      type: "RESTORE_ARCHIVE_SELECTION",
    });
    const after = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    return {
      afterTabs: after.tabCount,
      beforeTabs: before.tabCount,
      restored: response?.restored,
    };
  });
  if (
    !(restoreSelectedContract.restored > 0) ||
    restoreSelectedContract.afterTabs !==
      restoreSelectedContract.beforeTabs - restoreSelectedContract.restored
  ) {
    throw new Error(
      `Restore Selected failed or restored overlapping descendants twice: ${JSON.stringify(restoreSelectedContract)}`,
    );
  }

  const persistentDataBeforeRestart = await activityPage.evaluate(async () => {
    const [archives, activity] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }),
      chrome.runtime.sendMessage({ type: "GET_ACTIVITY_LOG" }),
    ]);
    return {
      activityEntries: activity.length,
      archiveTabs: archives.tabCount,
    };
  });
  await browser.close();
  browser = undefined;
  browser = await puppeteer.launch({
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--user-data-dir=${profilePath}`,
    ],
    executablePath: bravePath,
    headless: true,
  });
  await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      target.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 15_000 },
  );
  const persistencePage = await browser.newPage();
  await persistencePage.goto(
    `chrome-extension://${extensionId}/activity.html`,
    { waitUntil: "networkidle0" },
  );
  const persistentDataAfterRestart = await persistencePage.evaluate(
    async () => {
      const [archives, activity] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_ARCHIVES" }),
        chrome.runtime.sendMessage({ type: "GET_ACTIVITY_LOG" }),
      ]);
      return {
        activityEntries: activity.length,
        archiveTabs: archives.tabCount,
      };
    },
  );
  if (
    persistentDataAfterRestart.activityEntries !==
      persistentDataBeforeRestart.activityEntries ||
    persistentDataAfterRestart.archiveTabs !==
      persistentDataBeforeRestart.archiveTabs
  ) {
    throw new Error(
      `Local archive or activity data changed across restart: ${JSON.stringify({ persistentDataAfterRestart, persistentDataBeforeRestart })}`,
    );
  }

  const extensionsPage = await browser.newPage();
  await extensionsPage.goto("brave://extensions/", {
    waitUntil: "domcontentloaded",
  });
  const toggledOff = await extensionsPage.evaluate(async (id) => {
    const extensions = await chrome.developerPrivate.getExtensionsInfo();
    if (!extensions.some((extension) => extension.id === id)) return false;
    await chrome.management.setEnabled(id, false);
    return true;
  }, extensionId);
  if (!toggledOff) {
    throw new Error("The acceptance profile could not disable the extension.");
  }
  await waitForTargetRemoval(browser, extensionId);
  await browser.close();
  browser = undefined;
  browser = await puppeteer.launch({
    args: [
      `--disable-extensions-except=${resolve(profilePath, "disabled-extension-placeholder")}`,
      `--user-data-dir=${profilePath}`,
    ],
    executablePath: bravePath,
    headless: true,
  });
  if (
    browser
      .targets()
      .some((target) =>
        target.url().startsWith(`chrome-extension://${extensionId}/`),
      )
  ) {
    throw new Error(
      "An extension remained active during the persistence test.",
    );
  }
  const bookmarksPage = await browser.newPage();
  await bookmarksPage.goto("brave://bookmarks/", {
    waitUntil: "domcontentloaded",
  });
  const bookmarksPersisted = await bookmarksPage.evaluate(
    async (expectedUrls) => {
      const tree = await chrome.bookmarks.getTree();
      const found = new Set();
      const collectUrls = (nodes) => {
        for (const node of nodes) {
          if (expectedUrls.includes(node.url)) found.add(node.url);
          if (node.children !== undefined) collectUrls(node.children);
        }
      };
      collectUrls(tree);
      return expectedUrls.every((url) => found.has(url));
    },
    [result.permanentBookmarkUrl, result.sessionBookmarkUrl],
  );
  if (!bookmarksPersisted) {
    throw new Error(
      "The explicit bookmark copy was not retained after the extension was disabled.",
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      archiveConsumed: result.archiveConsumed,
      archivedUrls: result.archivedUrls,
      extensionId,
      groupRestored: result.group,
      permanentBookmarkSurvivedDisable: true,
      explicitSessionBookmarkSurvivedDisable: true,
      localDataSurvivedRestart: true,
      orderRestored: true,
      pinnedRestored: result.pinned,
    })}\n`,
  );
} finally {
  if (browser !== undefined) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profilePath, { force: true, recursive: true });
}

async function waitForTargetRemoval(browserInstance, extensionId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const active = browserInstance
      .targets()
      .some((target) =>
        target.url().startsWith(`chrome-extension://${extensionId}/`),
      );
    if (!active) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error("The extension remained active after it was disabled.");
}
