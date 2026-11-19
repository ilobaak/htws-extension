import { beforeEach, describe, expect, it } from "vitest";

import {
  bookmarkArchiveSelection,
  clearArchive,
  createArchiveGroup,
  deleteArchiveSelection,
  deleteArchiveGroup,
  deleteArchiveTab,
  deleteArchiveWindow,
  duplicateArchiveSelection,
  getArchiveSnapshot,
  hibernateSession,
  hibernateTabs,
  mergeArchiveSelection,
  mergeArchiveItems,
  moveArchiveItem,
  moveArchiveTabsOut,
  moveArchiveTabsToGroup,
  moveArchiveWindowsOut,
  planArchiveSelectionRestore,
  renameArchiveSession,
  renameArchiveTab,
  renameArchiveWindow,
  recordArchiveBookmarkMutation,
  recordArchiveMutation,
  redoArchiveChange,
  restoreArchiveSession,
  restoreArchiveGroup,
  restoreArchiveTab,
  restoreArchiveWindow,
  restoreAllArchives,
  runArchiveMutationWithoutHistory,
  toggleArchiveTabBookmark,
  toggleArchiveSessionBookmark,
  toggleArchiveWindowBookmark,
  toggleArchivePin,
  undoArchiveChange,
  updateArchiveGroup,
  type ArchiveDependencies,
  type ArchiveStore,
} from "../src/background/hibernate-archive";

interface Harness {
  closedTabIds: number[][];
  createdTabs: chrome.tabs.CreateProperties[];
  createdWindows: chrome.windows.CreateData[];
  dependencies: ArchiveDependencies;
  groupedTabs: chrome.tabs.GroupOptions[];
  nodes: Map<string, chrome.bookmarks.BookmarkTreeNode>;
  storage: Record<string, unknown>;
  updatedGroups: Array<{
    groupId: number;
    update: chrome.tabGroups.UpdateProperties;
  }>;
  updatedTabs: Array<{ tabId: number; update: chrome.tabs.UpdateProperties }>;
  removedWindowIds: number[];
}

const NOW = new Date(2026, 10, 3, 14, 5, 6);

function sourceTab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    favIconUrl: "",
    frozen: false,
    groupId: -1,
    height: 800,
    highlighted: false,
    incognito: false,
    index: 0,
    lastAccessed: NOW.getTime(),
    mutedInfo: { muted: false },
    pinned: false,
    selected: false,
    status: "complete",
    title: "Example",
    url: "https://example.com/",
    width: 1200,
    windowId: 7,
    ...overrides,
  };
}

describe("hibernate archive", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it("persists real URLs before closing tabs and exposes the archive", async () => {
    const result = await hibernateTabs(
      [
        sourceTab({ active: true, id: 10, index: 0, pinned: true }),
        sourceTab({
          groupId: 44,
          id: 11,
          index: 1,
          title: "Video",
          url: "https://video.example/watch/1",
        }),
      ],
      harness.dependencies,
    );

    expect(result.archived).toBe(2);
    expect(result.name).toBe("Window Example");
    expect(harness.closedTabIds).toEqual([[10, 11]]);
    expect(result.folderId).toMatch(/^entry-/u);
    expect([...harness.nodes.values()].filter((node) => node.url)).toEqual([]);
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot).toMatchObject({
      tabCount: 2,
      windows: [
        {
          name: "Window Example",
          tabs: [
            { pinned: true, url: "https://example.com/" },
            {
              groupTitle: "Research",
              url: "https://video.example/watch/1",
            },
          ],
        },
      ],
    });
    expect(snapshot.windows[0]?.title).toContain("2026-11-03 14:05:06");
  });

  it("creates, renames, recolors, and changes archived group membership", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
      "Research window",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const window = snapshot.windows[0]!;
    const tabIds = window.tabs.map((tab) => tab.bookmarkId);
    const created = await createArchiveGroup(
      tabIds,
      "Research",
      "blue",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]?.groups).toMatchObject([
      { color: "blue", key: created.groupKey, title: "Research" },
    ]);

    await updateArchiveGroup(
      window.folderId,
      created.groupKey!,
      "Reading",
      "purple",
      harness.dependencies,
    );
    await moveArchiveTabsToGroup(
      [tabIds[1]!],
      window.folderId,
      undefined,
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]?.groups?.[0]).toMatchObject({
      color: "purple",
      tabs: [{ bookmarkId: tabIds[0] }],
      title: "Reading",
    });
    expect(snapshot.windows[0]?.tabs[1]?.groupKey).toBeUndefined();

    await restoreArchiveGroup(
      window.folderId,
      created.groupKey!,
      harness.dependencies,
    );
    expect(harness.groupedTabs.at(-1)).toMatchObject({ tabIds: [100] });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]?.tabs).toHaveLength(1);
    expect(snapshot.windows[0]?.groups).toEqual([]);
  });

  it("falls back to grey when an archived group color is unsupported", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
      "Research window",
    );
    const window = (await getArchiveSnapshot(harness.dependencies)).windows[0]!;
    const created = await createArchiveGroup(
      window.tabs.map((tab) => tab.bookmarkId),
      "Research",
      "future-browser-color",
      harness.dependencies,
    );

    await updateArchiveGroup(
      window.folderId,
      created.groupKey!,
      "Research",
      "not-a-browser-color",
      harness.dependencies,
    );

    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.groups?.[0]
        ?.color,
    ).toBe("grey");
  });

  it("recolors an unnamed top-level group without inventing a name", async () => {
    harness.dependencies.tabGroups.get = async (groupId) => ({
      collapsed: false,
      color: "blue",
      id: groupId,
      shared: false,
      title: "",
      windowId: 7,
    });
    await hibernateTabs(
      [sourceTab({ groupId: 44, id: 10 })],
      harness.dependencies,
      undefined,
      "group",
    );
    const before = (await getArchiveSnapshot(harness.dependencies)).windows[0]!;
    expect(before).toMatchObject({ entryType: "group" });
    expect(before.name).toBeUndefined();
    expect(before.groups?.[0]?.title).toBeUndefined();

    await updateArchiveGroup(
      before.folderId,
      before.groups![0]!.key,
      undefined,
      "purple",
      harness.dependencies,
    );

    const after = (await getArchiveSnapshot(harness.dependencies)).windows[0]!;
    expect(after.name).toBeUndefined();
    expect(after.groups?.[0]).toMatchObject({ color: "purple" });
    expect(after.groups?.[0]?.title).toBeUndefined();
  });

  it("repairs a legacy blank group key before recoloring", async () => {
    harness.dependencies.tabGroups.get = async (groupId) => ({
      collapsed: false,
      color: "blue",
      id: groupId,
      shared: false,
      windowId: 7,
    });
    await hibernateTabs(
      [sourceTab({ groupId: 44, id: 10 })],
      harness.dependencies,
      undefined,
      "group",
    );
    const store = harness.storage.hibernateArchiveStore as ArchiveStore;
    const window = Object.values(store.windows)[0]!;
    const group = window.groups["44"]!;
    group.title = "   ";
    delete window.groups["44"];
    window.groups[""] = group;
    Object.values(window.tabs).forEach((tab) => (tab.groupKey = ""));

    const repaired = (await getArchiveSnapshot(harness.dependencies))
      .windows[0]!;
    expect(repaired.groups?.[0]?.key).toBe("legacy-group");
    expect(repaired.groups?.[0]?.title).toBeUndefined();
    expect(repaired.tabs[0]?.groupKey).toBe("legacy-group");

    await updateArchiveGroup(
      repaired.folderId,
      "legacy-group",
      undefined,
      "orange",
      harness.dependencies,
    );
    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.groups?.[0]
        ?.color,
    ).toBe("orange");
    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.groups?.[0]
        ?.title,
    ).toBeUndefined();
  });

  it("repairs an unsupported color already present in local storage", async () => {
    await hibernateTabs(
      [sourceTab({ groupId: 44, id: 10 })],
      harness.dependencies,
      "Research",
      "group",
    );
    const store = harness.storage.hibernateArchiveStore as ArchiveStore;
    const storedGroup = Object.values(store.windows)[0]?.groups["44"];
    expect(storedGroup).toBeDefined();
    storedGroup!.color = "future-browser-color" as `${chrome.tabGroups.Color}`;

    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.groups?.[0]
        ?.color,
    ).toBe("grey");
    expect(storedGroup?.color).toBe("grey");
  });

  it("restores a group without color when the browser rejects the color", async () => {
    await hibernateTabs(
      [
        sourceTab({ groupId: 44, id: 10 }),
        sourceTab({
          groupId: 44,
          id: 11,
          index: 1,
          url: "https://example.com/two",
        }),
      ],
      harness.dependencies,
      "Research",
      "group",
    );
    const groupUpdates: chrome.tabGroups.UpdateProperties[] = [];
    harness.dependencies.tabGroups.update = async (groupId, update) => {
      groupUpdates.push(update);
      if (update.color !== undefined) throw new Error("Unsupported color");
      return {
        collapsed: update.collapsed ?? false,
        color: "grey",
        id: groupId,
        shared: false,
        ...(update.title === undefined ? {} : { title: update.title }),
        windowId: 50,
      };
    };
    const window = (await getArchiveSnapshot(harness.dependencies)).windows[0]!;

    await expect(
      restoreArchiveGroup(
        window.folderId,
        window.groups![0]!.key,
        harness.dependencies,
      ),
    ).resolves.toEqual({ restored: 2 });
    expect(groupUpdates).toHaveLength(2);
    expect(groupUpdates[0]?.color).toBe("blue");
    expect(groupUpdates[1]).not.toHaveProperty("color");
  });

  it("erases an archived group without erasing ungrouped siblings", async () => {
    await hibernateTabs(
      [
        sourceTab({ groupId: 44, id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
      "Mixed window",
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    const window = snapshot.windows[0]!;
    const group = window.groups![0]!;
    await expect(
      deleteArchiveGroup(window.folderId, group.key, harness.dependencies),
    ).resolves.toEqual({ deleted: 1 });
    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.tabs,
    ).toMatchObject([{ url: "https://example.com/two" }]);
  });

  it("stores an automatically hibernated group as one restorable group entry", async () => {
    await hibernateTabs(
      [
        sourceTab({ groupId: 44, id: 10 }),
        sourceTab({
          groupId: 44,
          id: 11,
          index: 1,
          url: "https://example.com/two",
        }),
      ],
      harness.dependencies,
      "Research",
      "group",
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]).toMatchObject({
      entryType: "group",
      groups: [
        {
          color: "blue",
          tabs: [{ groupKey: "44" }, { groupKey: "44" }],
          title: "Research",
        },
      ],
      name: "Research",
    });
  });

  it("infers a preserved group when manually hibernating grouped tabs", async () => {
    await hibernateTabs(
      [
        sourceTab({ groupId: 44, id: 10 }),
        sourceTab({
          groupId: 44,
          id: 11,
          index: 1,
          url: "https://example.com/two",
        }),
      ],
      harness.dependencies,
      undefined,
      "tab",
    );

    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0],
    ).toMatchObject({
      entryType: "group",
      groups: [
        {
          color: "blue",
          tabs: [{ groupKey: "44" }, { groupKey: "44" }],
          title: "Research",
        },
      ],
      name: "Research",
    });
  });

  it("clears every local archive record without deleting saved bookmark copies", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10, index: 0 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
    );
    const before = await getArchiveSnapshot(harness.dependencies);
    await toggleArchiveWindowBookmark(
      before.windows[0]!.folderId,
      harness.dependencies,
    );

    await expect(clearArchive(harness.dependencies)).resolves.toEqual({
      deleted: 2,
    });
    await expect(getArchiveSnapshot(harness.dependencies)).resolves.toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      2,
    );
  });

  it("archives the pending URL when a new tab has not committed navigation", async () => {
    await hibernateTabs(
      [
        sourceTab({
          id: 10,
          pendingUrl: "https://example.com/pending",
          title: "",
          url: "",
        }),
      ],
      harness.dependencies,
    );

    const snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.tabs[0]).toMatchObject({
      title: "https://example.com/pending",
      url: "https://example.com/pending",
    });
    expect(snapshot.windows).toEqual([]);
  });

  it("keeps a one-tab window as a window when explicitly requested", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10 })],
      harness.dependencies,
      undefined,
      "window",
    );

    const snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.tabs).toEqual([]);
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.windows[0]?.name).toBe("Window Example");
    expect(snapshot.windows[0]?.tabs).toHaveLength(1);
  });

  it("uses the first tab site when an unnamed window tab has no title", async () => {
    const result = await hibernateTabs(
      [
        sourceTab({
          id: 10,
          title: "",
          url: "https://www.example.com/path",
        }),
      ],
      harness.dependencies,
      undefined,
      "window",
    );

    expect(result.name).toBe("Window example.com");
    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows[0]?.name,
    ).toBe("Window example.com");
  });

  it("does not close tabs until local archive storage succeeds", async () => {
    harness.dependencies.storage.set = async () => {
      throw new Error("Storage unavailable");
    };

    await expect(
      hibernateTabs([sourceTab({ id: 10 })], harness.dependencies),
    ).rejects.toThrow("Storage unavailable");

    expect(harness.closedTabIds).toEqual([]);
    expect([...harness.nodes.values()].filter((node) => node.url)).toEqual([]);
  });

  it("keeps locally archived tabs available without bookmark-index propagation", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({
          id: 11,
          index: 1,
          url: "https://example.com/two",
        }),
      ],
      harness.dependencies,
    );
    harness.dependencies.now = () => new Date(NOW.getTime() + 30_001);

    expect(await getArchiveSnapshot(harness.dependencies)).toMatchObject({
      tabCount: 2,
    });
    expect([...harness.nodes.values()].filter((node) => node.url)).toEqual([]);
  });

  it("shows a locally persisted archive without creating browser bookmarks", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);

    await expect(
      getArchiveSnapshot(harness.dependencies),
    ).resolves.toMatchObject({
      tabCount: 1,
      tabs: [{ bookmarkId: expect.any(String) }],
      windows: [],
    });
    expect(harness.nodes.size).toBe(0);
  });

  it("migrates legacy archive bookmarks into local storage and removes them", async () => {
    const root = await harness.dependencies.bookmarks.create({
      title: "HTWS Archives · Created 2026-11-03 14:05:06",
    });
    const folder = await harness.dependencies.bookmarks.create({
      parentId: root.id,
      title: "Window · 2026-11-03 14:05:06 · 1 tab",
    });
    const bookmark = await harness.dependencies.bookmarks.create({
      parentId: folder.id,
      title: "Example",
      url: "https://example.com/",
    });
    harness.storage.hibernateArchiveStore = {
      rootFolderId: root.id,
      schemaVersion: 1,
      windows: {
        [folder.id]: {
          createdAt: NOW.getTime(),
          entryType: "tab",
          groups: {},
          sourceWindowId: 7,
          tabs: {
            [bookmark.id]: {
              active: true,
              bookmarkId: bookmark.id,
              createdAt: NOW.getTime(),
              index: 0,
              pinned: false,
              title: "Example",
              url: "https://example.com/",
            },
          },
        },
      },
    };

    await expect(
      getArchiveSnapshot(harness.dependencies),
    ).resolves.toMatchObject({
      tabCount: 1,
      tabs: [{ title: "Example", url: "https://example.com/" }],
    });
    expect(harness.nodes.size).toBe(0);
    expect(harness.storage.hibernateArchiveStore).toMatchObject({
      schemaVersion: 4,
      windows: { [folder.id]: expect.any(Object) },
    });
    expect(harness.storage.hibernateArchiveStore).not.toHaveProperty(
      "legacyRootFolderId",
    );
  });

  it("restores one tab and consumes its bookmark", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10, index: 3, pinned: true })],
      harness.dependencies,
    );
    const before = await getArchiveSnapshot(harness.dependencies);
    const bookmarkId = before.tabs[0]?.bookmarkId;
    expect(bookmarkId).toBeDefined();

    await restoreArchiveTab(bookmarkId!, 9, harness.dependencies);

    expect(harness.createdTabs).toContainEqual({
      active: true,
      index: 3,
      pinned: true,
      url: "https://example.com/",
      windowId: 9,
    });
    expect(harness.nodes.has(bookmarkId!)).toBe(false);
    expect(await getArchiveSnapshot(harness.dependencies)).toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("archives and restores an internal browser page without bookmarking it", async () => {
    await hibernateTabs(
      [
        sourceTab({
          id: 10,
          title: "Bookmarks",
          url: "brave://bookmarks/",
        }),
      ],
      harness.dependencies,
    );
    const archived = (await getArchiveSnapshot(harness.dependencies)).tabs[0]!;

    await expect(
      toggleArchiveTabBookmark(archived.bookmarkId, harness.dependencies),
    ).rejects.toThrow("cannot be browser-bookmarked");
    await restoreArchiveTab(
      archived.bookmarkId,
      undefined,
      harness.dependencies,
    );

    expect(harness.createdTabs).toContainEqual({
      active: true,
      index: 0,
      pinned: false,
      url: "brave://bookmarks/",
    });
  });

  it("archives an incognito tab and restores it in a private window", async () => {
    await hibernateTabs(
      [
        sourceTab({
          id: 10,
          incognito: true,
          title: "Private research",
          url: "https://private.example/research",
        }),
      ],
      harness.dependencies,
    );

    const archived = (await getArchiveSnapshot(harness.dependencies)).tabs[0]!;
    expect(archived).toMatchObject({ incognito: true });
    await expect(
      toggleArchiveTabBookmark(archived.bookmarkId, harness.dependencies),
    ).rejects.toThrow("cannot be browser-bookmarked");

    await restoreArchiveTab(
      archived.bookmarkId,
      undefined,
      harness.dependencies,
    );

    expect(harness.createdWindows[0]).toMatchObject({
      incognito: true,
      url: "https://private.example/research",
    });
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(0);
  });

  it("restores window order, pins, groups, and active tab before consuming it", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10, index: 2, pinned: true }),
        sourceTab({
          active: true,
          groupId: 44,
          id: 11,
          index: 4,
          url: "https://example.com/two",
        }),
        sourceTab({
          groupId: 44,
          id: 12,
          index: 5,
          url: "https://example.com/three",
        }),
      ],
      harness.dependencies,
    );
    const folderId = (await getArchiveSnapshot(harness.dependencies)).windows[0]
      ?.folderId;
    expect(folderId).toBeDefined();

    await restoreArchiveWindow(folderId!, harness.dependencies);

    expect(harness.createdWindows[0]?.url).toEqual([
      "https://example.com/",
      "https://example.com/two",
      "https://example.com/three",
    ]);
    expect(harness.updatedTabs).toContainEqual({
      tabId: 100,
      update: { pinned: true },
    });
    expect(harness.updatedTabs).toContainEqual({
      tabId: 101,
      update: { active: true },
    });
    expect(harness.groupedTabs).toContainEqual({
      createProperties: { windowId: 50 },
      tabIds: [101, 102],
    });
    expect(harness.updatedGroups).toContainEqual({
      groupId: 70,
      update: { collapsed: true, color: "blue", title: "Research" },
    });
    expect(await getArchiveSnapshot(harness.dependencies)).toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("deletes one archived tab and removes its empty window", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);
    const before = await getArchiveSnapshot(harness.dependencies);
    const bookmarkId = before.tabs[0]?.bookmarkId;

    await expect(
      deleteArchiveTab(bookmarkId!, harness.dependencies),
    ).resolves.toEqual({ deleted: 1 });
    await expect(getArchiveSnapshot(harness.dependencies)).resolves.toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("deletes one archived tab without erasing its remaining window", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
    );
    const before = await getArchiveSnapshot(harness.dependencies);
    const bookmarkId = before.windows[0]?.tabs[0]?.bookmarkId;

    await deleteArchiveTab(bookmarkId!, harness.dependencies);

    const after = await getArchiveSnapshot(harness.dependencies);
    expect(after.tabCount).toBe(1);
    expect(after.windows).toHaveLength(1);
    expect(after.windows[0]?.tabs[0]?.url).toBe("https://example.com/two");
  });

  it("deletes an archived window and all of its tab bookmarks", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
    );
    const before = await getArchiveSnapshot(harness.dependencies);

    await expect(
      deleteArchiveWindow(before.windows[0]!.folderId, harness.dependencies),
    ).resolves.toEqual({ deleted: 2 });
    await expect(getArchiveSnapshot(harness.dependencies)).resolves.toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("hibernates a session locally and bookmarks it only on request", async () => {
    const result = await hibernateSession(
      [
        [
          sourceTab({ id: 10, windowId: 7 }),
          sourceTab({
            id: 11,
            index: 1,
            url: "https://example.com/two",
            windowId: 7,
          }),
        ],
        [
          sourceTab({
            active: true,
            id: 12,
            url: "https://example.com/three",
            windowId: 8,
          }),
        ],
      ],
      "Work session",
      harness.dependencies,
    );

    expect(result).toMatchObject({ archived: 3, windows: 2 });
    expect(harness.closedTabIds).toEqual([[10, 11, 12]]);
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      name: "Work session",
      windows: [
        { tabs: [{ title: "Example" }, { title: "Example" }] },
        { tabs: [{ title: "Example" }] },
      ],
    });
    expect(snapshot.sessions[0]?.bookmarked).toBeUndefined();
    expect(
      snapshot.sessions[0]?.windows
        .flatMap((window) => window.tabs)
        .every((tab) => tab.bookmarked === undefined),
    ).toBe(true);
    expect(harness.nodes.size).toBe(0);

    await expect(
      toggleArchiveSessionBookmark(result.sessionId, harness.dependencies),
    ).resolves.toEqual({ bookmarked: true, changed: 3 });
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      3,
    );
    expect(
      [...harness.nodes.values()].some((node) =>
        node.title.startsWith("Work session - "),
      ),
    ).toBe(true);
    const savedSessionFolder = [...harness.nodes.values()].find((node) =>
      node.title.startsWith("Work session - "),
    );
    expect(savedSessionFolder).toBeDefined();
    await harness.dependencies.bookmarks.update(savedSessionFolder!.id, {
      title: "Work session \u00c2\u00b7 2026-11-03 14:05:06",
    });
    await getArchiveSnapshot(harness.dependencies);
    expect(harness.nodes.get(savedSessionFolder!.id)?.title).toBe(
      "Work session - 2026-11-03 14:05:06",
    );
    await expect(
      renameArchiveSession(
        result.sessionId,
        "Renamed session",
        harness.dependencies,
      ),
    ).resolves.toEqual({ name: "Renamed session", ok: true });
    expect(harness.nodes.get(savedSessionFolder!.id)?.title).toBe(
      "Renamed session - 2026-11-03 14:05:06",
    );

    await expect(
      toggleArchiveSessionBookmark(result.sessionId, harness.dependencies),
    ).resolves.toEqual({ bookmarked: false, changed: 3 });
    expect([...harness.nodes.values()].filter((node) => node.url)).toEqual([]);

    await expect(
      restoreArchiveSession(result.sessionId, harness.dependencies),
    ).resolves.toEqual({ restored: 3 });
    expect(harness.createdWindows).toHaveLength(2);
    expect(await getArchiveSnapshot(harness.dependencies)).toEqual({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("prompts through rename conflicts and merges sessions only when confirmed", async () => {
    const first = await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 })]],
      "Work",
      harness.dependencies,
    );
    const second = await hibernateSession(
      [[sourceTab({ id: 20, windowId: 8 })]],
      "Other",
      harness.dependencies,
    );

    await expect(
      renameArchiveSession(second.sessionId, "work", harness.dependencies),
    ).resolves.toMatchObject({
      conflict: { id: first.sessionId, name: "Work" },
      ok: false,
    });
    expect(
      (await getArchiveSnapshot(harness.dependencies)).sessions,
    ).toHaveLength(2);
    await expect(
      renameArchiveSession(
        second.sessionId,
        "work",
        harness.dependencies,
        true,
      ),
    ).resolves.toMatchObject({ merged: true, ok: true });
    const merged = await getArchiveSnapshot(harness.dependencies);
    expect(merged.sessions).toHaveLength(1);
    expect(merged.sessions[0]?.windows).toHaveLength(2);
    expect(merged.tabCount).toBe(2);
  });

  it("merges same-scope windows on rename but allows matching names across sessions", async () => {
    const first = await hibernateSession(
      [
        [sourceTab({ id: 10, windowId: 7 })],
        [sourceTab({ id: 20, windowId: 8 })],
      ],
      "First",
      harness.dependencies,
    );
    const second = await hibernateSession(
      [[sourceTab({ id: 30, windowId: 9 })]],
      "Second",
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const firstSession = snapshot.sessions.find(
      (session) => session.sessionId === first.sessionId,
    )!;
    const secondSession = snapshot.sessions.find(
      (session) => session.sessionId === second.sessionId,
    )!;
    await expect(
      renameArchiveWindow(
        firstSession.windows[0]!.folderId,
        "Shared",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      renameArchiveWindow(
        secondSession.windows[0]!.folderId,
        "Shared",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      renameArchiveWindow(
        firstSession.windows[1]!.folderId,
        "Shared",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ conflict: { name: "Shared" }, ok: false });
    await expect(
      renameArchiveWindow(
        firstSession.windows[1]!.folderId,
        "Shared",
        harness.dependencies,
        true,
      ),
    ).resolves.toMatchObject({ merged: true, ok: true });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.sessions.find((session) => session.sessionId === first.sessionId)
        ?.windows,
    ).toHaveLength(1);
    expect(snapshot.tabCount).toBe(3);
  });

  it("merges mixed selections into new sessions and windows", async () => {
    await hibernateSession(
      [
        [sourceTab({ id: 10, windowId: 7 })],
        [sourceTab({ id: 20, windowId: 8 })],
      ],
      "Source",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 30, windowId: 9 })],
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const sourceSession = snapshot.sessions[0]!;
    const standalone = snapshot.tabs[0]!;
    await expect(
      mergeArchiveSelection(
        {
          sessionIds: [],
          tabIds: [standalone.bookmarkId],
          windowIds: [sourceSession.windows[0]!.folderId],
        },
        "session",
        "Merged",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ movedTabs: 2, sessionId: expect.any(String) });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const mergedSession = snapshot.sessions.find(
      (session) => session.name === "Merged",
    )!;
    expect(mergedSession.windows).toHaveLength(2);
    expect(
      snapshot.sessions.find((session) => session.name === "Source")?.windows,
    ).toHaveLength(1);

    await expect(
      mergeArchiveSelection(
        {
          sessionIds: snapshot.sessions.map((session) => session.sessionId),
          tabIds: [],
          windowIds: [],
        },
        "window",
        "Combined",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ movedTabs: 3, windowId: expect.any(String) });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.windows[0]).toMatchObject({ name: "Combined" });
    expect(snapshot.windows[0]?.tabs).toHaveLength(3);
  });

  it("keeps private and regular tabs in separate archived windows", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10, incognito: false, windowId: 7 })],
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, incognito: true, windowId: 8 })],
      harness.dependencies,
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);

    await expect(
      mergeArchiveSelection(
        {
          sessionIds: [],
          tabIds: snapshot.tabs.map((tab) => tab.bookmarkId),
          windowIds: [],
        },
        "window",
        "Mixed privacy",
        harness.dependencies,
      ),
    ).rejects.toThrow("cannot be combined");

    await expect(
      mergeArchiveSelection(
        {
          sessionIds: [],
          tabIds: snapshot.tabs.map((tab) => tab.bookmarkId),
          windowIds: [],
        },
        "session",
        "Separate privacy",
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ movedTabs: 2 });
    const merged = (await getArchiveSnapshot(harness.dependencies))
      .sessions[0]!;
    expect(merged.windows).toHaveLength(2);
    expect(
      merged.windows
        .map((window) => window.incognito === true)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
  });

  it("moves tabs and windows out while removing empty parents", async () => {
    await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 }), sourceTab({ id: 11, index: 1 })]],
      "Detach tabs",
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    await expect(
      moveArchiveTabsOut(
        {
          sessionIds: [snapshot.sessions[0]!.sessionId],
          tabIds: [],
          windowIds: [],
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ movedTabs: 2 });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.windows).toEqual([]);
    expect(snapshot.tabs).toHaveLength(2);

    await hibernateSession(
      [[sourceTab({ id: 20, windowId: 8 })]],
      "Detach window",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const nestedWindow = snapshot.sessions[0]!.windows[0]!;
    await expect(
      moveArchiveWindowsOut(
        {
          sessionIds: [],
          tabIds: [],
          windowIds: [nestedWindow.folderId],
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ movedTabs: 1 });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.windows).toHaveLength(1);
  });

  it("restores every archive entry", async () => {
    await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 })]],
      "Session",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
    );
    await expect(restoreAllArchives(harness.dependencies)).resolves.toEqual({
      restored: 2,
      windows: 1,
    });
    await expect(
      getArchiveSnapshot(harness.dependencies),
    ).resolves.toMatchObject({
      sessions: [],
      tabCount: 0,
      tabs: [],
      windows: [],
    });
  });

  it("keeps session tabs open when the archive cannot be persisted", async () => {
    harness.storage.hibernateArchiveStore = {
      schemaVersion: 4,
      sessions: {},
      windows: {},
    };
    harness.dependencies.storage.set = async () => {
      throw new Error("Storage unavailable");
    };

    await expect(
      hibernateSession(
        [[sourceTab({ id: 10 }), sourceTab({ id: 11, index: 1 })]],
        "Work session",
        harness.dependencies,
      ),
    ).rejects.toThrow("Storage unavailable");
    expect(harness.closedTabIds).toEqual([]);
    expect(harness.nodes.size).toBe(0);
  });

  it("creates a permanent bookmark copy without consuming the archive", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);
    const archive = await getArchiveSnapshot(harness.dependencies);

    await expect(
      toggleArchiveTabBookmark(
        archive.tabs[0]!.bookmarkId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: true, changed: 1 });

    const savedRoot = [...harness.nodes.values()].find(
      (node) => node.title === "HTWS Saved Bookmarks",
    );
    expect(savedRoot).toBeDefined();
    const [savedBookmark] = [...harness.nodes.values()].filter(
      (node) => node.parentId === savedRoot!.id && node.url,
    );
    expect(savedBookmark).toBeDefined();
    await expect(
      renameArchiveTab(
        archive.tabs[0]!.bookmarkId,
        "Renamed tab",
        harness.dependencies,
      ),
    ).resolves.toEqual({ name: "Renamed tab", ok: true });
    expect(harness.nodes.get(savedBookmark!.id)?.title).toBe("Renamed tab");
    expect(await getArchiveSnapshot(harness.dependencies)).toMatchObject({
      tabCount: 1,
      tabs: [{ bookmarked: true, title: "Renamed tab" }],
      windows: [],
    });

    await expect(
      toggleArchiveTabBookmark(
        archive.tabs[0]!.bookmarkId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: false, changed: 1 });
    expect(harness.nodes.has(savedBookmark!.id)).toBe(false);
    expect(harness.nodes.has(savedRoot!.id)).toBe(false);
    expect(
      [...harness.nodes.values()].filter(
        (node) => node.url === "https://example.com/",
      ),
    ).toEqual([]);
    const afterSavedTabRemoval = await getArchiveSnapshot(harness.dependencies);
    expect(afterSavedTabRemoval.tabs[0]?.bookmarked).toBeUndefined();
  });

  it("copies a hibernated window into a permanent bookmark folder", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
      ],
      harness.dependencies,
      "Research",
    );
    const archive = await getArchiveSnapshot(harness.dependencies);

    await expect(
      toggleArchiveWindowBookmark(
        archive.windows[0]!.folderId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: true, changed: 2 });

    const savedRoot = [...harness.nodes.values()].find(
      (node) => node.title === "HTWS Saved Bookmarks",
    );
    const savedFolder = [...harness.nodes.values()].find(
      (node) =>
        node.parentId === savedRoot?.id && node.title.startsWith("Research - "),
    );
    expect(savedRoot).toBeDefined();
    expect(savedFolder).toBeDefined();
    await expect(
      renameArchiveWindow(
        archive.windows[0]!.folderId,
        "Renamed window",
        harness.dependencies,
      ),
    ).resolves.toEqual({ name: "Renamed window", ok: true });
    expect(harness.nodes.get(savedFolder!.id)?.title).toBe(
      "Renamed window - 2026-11-03 14:05:06",
    );
    expect(
      [...harness.nodes.values()].filter(
        (node) => node.parentId === savedFolder!.id && node.url,
      ),
    ).toHaveLength(2);
    const bookmarkedWindowSnapshot = await getArchiveSnapshot(
      harness.dependencies,
    );
    expect(bookmarkedWindowSnapshot.windows[0]?.bookmarked).toBe(true);
    expect(
      bookmarkedWindowSnapshot.windows[0]?.tabs.every(
        (tab) => tab.bookmarked === true,
      ),
    ).toBe(true);

    const firstArchivedTab = bookmarkedWindowSnapshot.windows[0]!.tabs[0]!;
    const storedBeforeRemoval = harness.nodes.size;
    await expect(
      toggleArchiveTabBookmark(
        firstArchivedTab.bookmarkId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: false, changed: 1 });
    expect(harness.nodes.size).toBe(storedBeforeRemoval - 1);
    const partiallyBookmarked = await getArchiveSnapshot(harness.dependencies);
    expect(partiallyBookmarked.windows[0]?.bookmarked).toBeUndefined();
    expect(partiallyBookmarked.windows[0]?.tabs[0]?.bookmarked).toBeUndefined();
    expect(partiallyBookmarked.windows[0]?.tabs[1]?.bookmarked).toBe(true);

    await expect(
      toggleArchiveWindowBookmark(
        archive.windows[0]!.folderId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: true, changed: 2 });
    const completedWindow = await getArchiveSnapshot(harness.dependencies);
    expect(completedWindow.windows[0]?.bookmarked).toBe(true);
    expect(
      completedWindow.windows[0]?.tabs.every((tab) => tab.bookmarked === true),
    ).toBe(true);

    await expect(
      toggleArchiveWindowBookmark(
        archive.windows[0]!.folderId,
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: false, changed: 2 });
    expect(harness.nodes.has(savedFolder!.id)).toBe(false);
    expect(harness.nodes.has(savedRoot!.id)).toBe(false);
    const afterSavedWindowRemoval = await getArchiveSnapshot(
      harness.dependencies,
    );
    expect(afterSavedWindowRemoval.windows[0]?.bookmarked).toBeUndefined();
    expect(
      afterSavedWindowRemoval.windows[0]?.tabs.every(
        (tab) => tab.bookmarked === undefined,
      ),
    ).toBe(true);
  });

  it("bookmarks only website tabs from a mixed internal-page window", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({
          id: 11,
          index: 1,
          title: "Extensions",
          url: "brave://extensions/",
        }),
      ],
      harness.dependencies,
      "Mixed window",
      "window",
    );
    const window = (await getArchiveSnapshot(harness.dependencies)).windows[0]!;

    await expect(
      toggleArchiveWindowBookmark(window.folderId, harness.dependencies),
    ).resolves.toEqual({ bookmarked: true, changed: 1 });
    expect(
      [...harness.nodes.values()]
        .filter((node) => node.url)
        .map((node) => node.url),
    ).toEqual(["https://example.com/"]);
  });

  it("drags tabs between windows, into sessions, and back to the root", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10 }), sourceTab({ id: 11, index: 1 })],
      harness.dependencies,
      "Source",
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
      "Target",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const sourceTabId = snapshot.windows.find(
      (window) => window.name === "Source",
    )!.tabs[0]!.bookmarkId;
    const targetWindowId = snapshot.windows.find(
      (window) => window.name === "Target",
    )!.folderId;
    await moveArchiveItem(
      { id: sourceTabId, type: "tab" },
      { id: targetWindowId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.windows.find((window) => window.name === "Target")?.tabs,
    ).toHaveLength(2);

    const session = await hibernateSession(
      [[sourceTab({ id: 30, windowId: 9 })]],
      "Destination",
      harness.dependencies,
    );
    await moveArchiveItem(
      { id: sourceTabId, type: "tab" },
      { id: session.sessionId, type: "session" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.windows).toHaveLength(2);

    await moveArchiveItem(
      { id: sourceTabId, type: "tab" },
      undefined,
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.tabs.some((tab) => tab.bookmarkId === sourceTabId)).toBe(
      true,
    );
  });

  it("supports reciprocal container drops and nested group targets", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10 }), sourceTab({ id: 11, index: 1 })],
      harness.dependencies,
      "Grouped",
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8, title: "Incoming" })],
      harness.dependencies,
      "Incoming window",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const groupedWindow = snapshot.windows.find(
      (window) => window.name === "Grouped",
    )!;
    const created = await createArchiveGroup(
      groupedWindow.tabs.map((tab) => tab.bookmarkId),
      "Research",
      "blue",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const incoming = snapshot.windows.find(
      (window) => window.name === "Incoming window",
    )!.tabs[0]!;
    await moveArchiveItem(
      {
        groupKey: created.groupKey!,
        id: groupedWindow.folderId,
        type: "group",
      },
      { id: incoming.bookmarkId, type: "tab" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.windows
        .find((window) => window.folderId === groupedWindow.folderId)
        ?.groups?.[0]?.tabs.map((tab) => tab.title),
    ).toContain("Incoming");

    await hibernateTabs(
      [sourceTab({ id: 30, windowId: 9, title: "Standalone" })],
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const standalone = snapshot.tabs.find((tab) => tab.title === "Standalone")!;
    await moveArchiveItem(
      { id: standalone.bookmarkId, type: "tab" },
      {
        groupKey: created.groupKey!,
        id: groupedWindow.folderId,
        type: "group",
      },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.windows.find(
        (window) => window.folderId === groupedWindow.folderId,
      )?.groups?.[0]?.tabs,
    ).toHaveLength(4);
  });

  it("moves one nested group into another group in the same window", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1 }),
        sourceTab({ id: 12, index: 2 }),
        sourceTab({ id: 13, index: 3 }),
      ],
      harness.dependencies,
      "Grouped",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const window = snapshot.windows[0]!;
    const first = await createArchiveGroup(
      window.tabs.slice(0, 2).map((tab) => tab.bookmarkId),
      "First",
      "blue",
      harness.dependencies,
    );
    const second = await createArchiveGroup(
      window.tabs.slice(2).map((tab) => tab.bookmarkId),
      "Second",
      "purple",
      harness.dependencies,
    );
    await moveArchiveItem(
      { groupKey: first.groupKey!, id: window.folderId, type: "group" },
      { groupKey: second.groupKey!, id: window.folderId, type: "group" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]?.groups).toMatchObject([
      { title: "Second", tabs: [{}, {}, {}, {}] },
    ]);
  });

  it("moves a top-level group into a window and a session", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10 }), sourceTab({ id: 11, index: 1 })],
      harness.dependencies,
      "Group source",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const sourceWindow = snapshot.windows[0]!;
    const group = await createArchiveGroup(
      sourceWindow.tabs.map((tab) => tab.bookmarkId),
      "Research",
      "blue",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
      "Target window",
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const targetWindow = snapshot.windows.find(
      (window) => window.name === "Target window",
    )!;
    await moveArchiveItem(
      { groupKey: group.groupKey!, id: sourceWindow.folderId, type: "group" },
      { id: targetWindow.folderId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.windows.find(
        (window) => window.folderId === targetWindow.folderId,
      ),
    ).toMatchObject({ groups: [{ title: "Research" }], tabs: [{}, {}, {}] });

    const secondGroup = await createArchiveGroup(
      snapshot.windows
        .find((window) => window.folderId === targetWindow.folderId)!
        .tabs.slice(0, 2)
        .map((tab) => tab.bookmarkId),
      "Session group",
      "purple",
      harness.dependencies,
    );
    const session = await hibernateSession(
      [[sourceTab({ id: 30, windowId: 9 })]],
      "Destination",
      harness.dependencies,
    );
    await moveArchiveItem(
      {
        groupKey: secondGroup.groupKey!,
        id: targetWindow.folderId,
        type: "group",
      },
      { id: session.sessionId, type: "session" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.windows).toHaveLength(2);
    expect(
      snapshot.sessions[0]?.windows.some((window) =>
        window.groups?.some((candidate) => candidate.title === "Session group"),
      ),
    ).toBe(true);
  });

  it("ungroups a nested tab when it is dropped on its containing window", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1 }),
        sourceTab({ id: 12, index: 2 }),
      ],
      harness.dependencies,
      "Containing window",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const window = snapshot.windows[0]!;
    const groupedTabIds = window.tabs.slice(0, 2).map((tab) => tab.bookmarkId);
    await createArchiveGroup(
      groupedTabIds,
      "Nested group",
      "blue",
      harness.dependencies,
    );
    await moveArchiveItem(
      { id: groupedTabIds[0]!, type: "tab" },
      { id: window.folderId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const updated = snapshot.windows[0]!;
    expect(
      updated.tabs.find((tab) => tab.bookmarkId === groupedTabIds[0])?.groupKey,
    ).toBeUndefined();
    expect(updated.groups?.[0]?.tabs).toHaveLength(1);
  });

  it("preserves the current collapsed state when a group is dragged", async () => {
    await hibernateTabs(
      [
        sourceTab({ id: 10 }),
        sourceTab({ id: 11, index: 1 }),
        sourceTab({ id: 12, index: 2 }),
      ],
      harness.dependencies,
      "Group source",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const sourceWindow = snapshot.windows[0]!;
    const group = await createArchiveGroup(
      sourceWindow.tabs.slice(0, 2).map((tab) => tab.bookmarkId),
      "Collapsed group",
      "purple",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
      "Target window",
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const targetWindow = snapshot.windows.find(
      (window) => window.name === "Target window",
    )!;
    await moveArchiveItem(
      {
        collapsed: true,
        groupKey: group.groupKey!,
        id: sourceWindow.folderId,
        type: "group",
      },
      { id: targetWindow.folderId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.windows
        .find((window) => window.folderId === targetWindow.folderId)
        ?.groups?.find((candidate) => candidate.title === "Collapsed group")
        ?.collapsed,
    ).toBe(true);
  });

  it("uses reciprocal hierarchy drops for sessions, windows, and groups", async () => {
    const session = await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 })]],
      "Destination session",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
      "Loose window",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const looseWindow = snapshot.windows[0]!;
    await moveArchiveItem(
      { id: session.sessionId, type: "session" },
      { id: looseWindow.folderId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.windows).toHaveLength(2);

    await hibernateTabs(
      [
        sourceTab({ id: 30, windowId: 9 }),
        sourceTab({ id: 31, windowId: 9, index: 1 }),
      ],
      harness.dependencies,
      "Group source",
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const groupWindow = snapshot.windows[0]!;
    const group = await createArchiveGroup(
      groupWindow.tabs.map((tab) => tab.bookmarkId),
      "Reciprocal group",
      "cyan",
      harness.dependencies,
    );
    await moveArchiveItem(
      { id: session.sessionId, type: "session" },
      { groupKey: group.groupKey!, id: groupWindow.folderId, type: "group" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.sessions[0]?.windows.some((window) =>
        window.groups?.some(
          (candidate) => candidate.title === "Reciprocal group",
        ),
      ),
    ).toBe(true);

    await hibernateTabs(
      [sourceTab({ id: 40, windowId: 10 })],
      harness.dependencies,
      "Receiving window",
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const receivingWindow = snapshot.windows[0]!;
    const nestedGroup = snapshot.sessions[0]!.windows.flatMap(
      (window) => window.groups ?? [],
    ).find((candidate) => candidate.title === "Reciprocal group")!;
    await moveArchiveItem(
      { id: receivingWindow.folderId, type: "window" },
      {
        groupKey: nestedGroup.key,
        id: nestedGroup.folderId,
        type: "group",
      },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.windows[0]).toMatchObject({
      groups: [{ title: "Reciprocal group" }],
      name: "Receiving window",
    });
  });

  it("pins archive entries and merges selected items into an existing parent", async () => {
    const session = await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 })]],
      "Pinned session",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
      "Loose window",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const looseWindow = snapshot.windows[0]!;
    await expect(
      toggleArchivePin(
        { id: session.sessionId, type: "session" },
        harness.dependencies,
      ),
    ).resolves.toEqual({ pinned: true });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.archivePinned).toBe(true);

    await expect(
      mergeArchiveItems(
        [
          { id: session.sessionId, type: "session" },
          { id: looseWindow.folderId, type: "window" },
        ],
        { id: session.sessionId, type: "session" },
        harness.dependencies,
      ),
    ).resolves.toEqual({ movedTabs: 1 });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.windows).toHaveLength(2);
    expect(snapshot.windows).toHaveLength(0);
  });

  it("duplicates named selections with fresh IDs and deletes them in bulk", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10, title: "Original" })],
      harness.dependencies,
      "Research",
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const original = snapshot.windows[0]!;
    await expect(
      duplicateArchiveSelection(
        {
          sessionIds: [],
          tabIds: [],
          windowIds: [original.folderId],
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ duplicated: 1 });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    const copy = snapshot.windows.find(
      (window) => window.name === "Research (Copy)",
    )!;
    expect(copy.tabs[0]).toMatchObject({ title: "Original (Copy)" });
    expect(copy.tabs[0]?.bookmarkId).not.toBe(original.tabs[0]?.bookmarkId);

    await expect(
      deleteArchiveSelection(
        { sessionIds: [], tabIds: [], windowIds: [copy.folderId] },
        harness.dependencies,
      ),
    ).resolves.toEqual({ deleted: 1 });
    expect(
      (await getArchiveSnapshot(harness.dependencies)).windows,
    ).toHaveLength(1);
  });

  it("plans selected restores without duplicating covered descendants", async () => {
    const session = await hibernateSession(
      [
        [
          sourceTab({ id: 10, windowId: 7 }),
          sourceTab({ id: 11, index: 1, windowId: 7 }),
        ],
      ],
      "Research session",
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, windowId: 8 })],
      harness.dependencies,
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    const nestedWindow = snapshot.sessions[0]!.windows[0]!;
    const createdGroup = await createArchiveGroup(
      [nestedWindow.tabs[0]!.bookmarkId],
      "Research",
      "blue",
      harness.dependencies,
    );
    const updated = await getArchiveSnapshot(harness.dependencies);
    const nestedTab = updated.sessions[0]!.windows[0]!.tabs[0]!;
    const standaloneTab = updated.tabs[0]!;

    expect(
      planArchiveSelectionRestore(updated, {
        groupIds: [
          `${nestedWindow.folderId}\u0000${createdGroup.groupKey ?? ""}`,
        ],
        sessionIds: [session.sessionId],
        tabIds: [nestedTab.bookmarkId, standaloneTab.bookmarkId],
        windowIds: [nestedWindow.folderId],
      }),
    ).toEqual({
      groups: [],
      sessionIds: [session.sessionId],
      tabIds: [standaloneTab.bookmarkId],
      windowIds: [],
    });
  });

  it("merges dragged windows and sessions and cleans empty parents", async () => {
    const first = await hibernateSession(
      [[sourceTab({ id: 10, windowId: 7 })]],
      "First",
      harness.dependencies,
    );
    const second = await hibernateSession(
      [[sourceTab({ id: 20, windowId: 8 })]],
      "Second",
      harness.dependencies,
    );
    await moveArchiveItem(
      { id: first.sessionId, type: "session" },
      { id: second.sessionId, type: "session" },
      "inside",
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.windows).toHaveLength(2);

    const [sourceWindow, targetWindow] = snapshot.sessions[0]!.windows;
    await moveArchiveItem(
      { id: sourceWindow!.folderId, type: "window" },
      { id: targetWindow!.folderId, type: "window" },
      "inside",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.sessions[0]?.windows).toHaveLength(1);
    expect(snapshot.sessions[0]?.windows[0]?.tabs).toHaveLength(2);
  });

  it("reorders top-level siblings without merging them", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10, title: "First" })],
      harness.dependencies,
    );
    harness.dependencies.now = () => new Date(NOW.getTime() + 1_000);
    await hibernateTabs(
      [sourceTab({ id: 20, title: "Second" })],
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const first = snapshot.tabs.find((tab) => tab.title === "First")!;
    const second = snapshot.tabs.find((tab) => tab.title === "Second")!;
    await moveArchiveItem(
      { id: first.bookmarkId, type: "tab" },
      { id: second.bookmarkId, type: "tab" },
      "before",
      harness.dependencies,
    );
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(snapshot.tabs).toHaveLength(2);
    expect(snapshot.entryOrder).toEqual([
      `tab:${first.bookmarkId}`,
      `tab:${second.bookmarkId}`,
    ]);
  });

  it("names a window created by dropping one standalone tab onto another", async () => {
    await hibernateTabs(
      [sourceTab({ id: 10, title: "First" })],
      harness.dependencies,
    );
    await hibernateTabs(
      [sourceTab({ id: 20, title: "Second" })],
      harness.dependencies,
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    await moveArchiveItem(
      { id: snapshot.tabs[0]!.bookmarkId, type: "tab" },
      { id: snapshot.tabs[1]!.bookmarkId, type: "tab" },
      "inside",
      harness.dependencies,
    );
    const moved = await getArchiveSnapshot(harness.dependencies);
    expect(moved.tabs).toEqual([]);
    expect(moved.windows).toHaveLength(1);
    expect(moved.windows[0]).toMatchObject({ name: "Window" });
  });

  it("persists snapshot undo and redo and clears the redo branch", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);
    await recordArchiveMutation(
      "Clear All",
      () => clearArchive(harness.dependencies),
      harness.dependencies,
    );
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(0);
    await expect(
      undoArchiveChange(harness.dependencies),
    ).resolves.toMatchObject({
      changed: true,
      label: "Clear All",
    });
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(1);
    await expect(
      redoArchiveChange(harness.dependencies),
    ).resolves.toMatchObject({
      changed: true,
      label: "Clear All",
    });
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(0);
    await undoArchiveChange(harness.dependencies);
    const tabId = (await getArchiveSnapshot(harness.dependencies)).tabs[0]!
      .bookmarkId;
    await recordArchiveMutation(
      "Rename Tab",
      () => renameArchiveTab(tabId, "Changed", harness.dependencies),
      harness.dependencies,
    );
    await expect(
      redoArchiveChange(harness.dependencies),
    ).resolves.toMatchObject({
      changed: false,
    });
  });

  it("undoes and redoes bookmark toggles without duplicating bookmarks", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);
    const tabId = (await getArchiveSnapshot(harness.dependencies)).tabs[0]!
      .bookmarkId;
    await recordArchiveBookmarkMutation(
      "Toggle Tab Bookmark",
      { id: tabId, type: "tab" },
      () => toggleArchiveTabBookmark(tabId, harness.dependencies),
      harness.dependencies,
    );
    expect(
      (await getArchiveSnapshot(harness.dependencies)).tabs[0]?.bookmarked,
    ).toBe(true);
    await undoArchiveChange(harness.dependencies);
    expect(
      (await getArchiveSnapshot(harness.dependencies)).tabs[0]?.bookmarked,
    ).toBeUndefined();
    await redoArchiveChange(harness.dependencies);
    expect(
      (await getArchiveSnapshot(harness.dependencies)).tabs[0]?.bookmarked,
    ).toBe(true);
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      1,
    );
  });

  it("removes a partially restored tab when group reconstruction fails", async () => {
    await hibernateTabs(
      [sourceTab({ groupId: 44, id: 10 })],
      harness.dependencies,
    );
    const tabId = (await getArchiveSnapshot(harness.dependencies)).windows[0]!
      .tabs[0]!.bookmarkId;
    harness.dependencies.tabGroups.update = async () => {
      throw new Error("Group update failed");
    };

    await expect(
      restoreArchiveTab(tabId, undefined, harness.dependencies),
    ).rejects.toThrow("Group update failed");
    expect(harness.closedTabIds).toEqual([[10], [200]]);
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(1);
  });

  it("removes a partially restored window when reconstruction fails", async () => {
    await hibernateTabs(
      [sourceTab({ groupId: 44, id: 10 })],
      harness.dependencies,
      "Work",
    );
    const folderId = (await getArchiveSnapshot(harness.dependencies))
      .windows[0]!.folderId;
    harness.dependencies.tabGroups.update = async () => {
      throw new Error("Group update failed");
    };

    await expect(
      restoreArchiveWindow(folderId, harness.dependencies),
    ).rejects.toThrow("Group update failed");
    expect(harness.removedWindowIds).toEqual([50]);
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(1);
  });

  it("bookmarks a selected hierarchy once and replays it as one history action", async () => {
    const result = await hibernateSession(
      [
        [sourceTab({ id: 10 }), sourceTab({ id: 11, index: 1 })],
        [sourceTab({ id: 20, windowId: 8 })],
      ],
      "Work",
      harness.dependencies,
    );
    const snapshot = await getArchiveSnapshot(harness.dependencies);
    const firstTabId = snapshot.sessions[0]!.windows[0]!.tabs[0]!.bookmarkId;

    await expect(
      bookmarkArchiveSelection(
        {
          sessionIds: [result.sessionId],
          tabIds: [firstTabId],
          windowIds: [snapshot.sessions[0]!.windows[0]!.folderId],
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: 1, changed: 3 });
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      3,
    );
    await expect(
      undoArchiveChange(harness.dependencies),
    ).resolves.toMatchObject({ changed: true, label: "Bookmark Selected" });
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      0,
    );
    await redoArchiveChange(harness.dependencies);
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      3,
    );
  });

  it("preserves pre-existing bookmarks when undoing Bookmark Selected", async () => {
    const result = await hibernateSession(
      [
        [
          sourceTab({ id: 10 }),
          sourceTab({ id: 11, index: 1, url: "https://example.com/two" }),
        ],
      ],
      "Partial",
      harness.dependencies,
    );
    let snapshot = await getArchiveSnapshot(harness.dependencies);
    const [first, second] = snapshot.sessions[0]!.windows[0]!.tabs;
    await toggleArchiveTabBookmark(first!.bookmarkId, harness.dependencies);
    const existingBookmarkId = [...harness.nodes.values()].find(
      (node) => node.url === first!.url,
    )!.id;

    await expect(
      bookmarkArchiveSelection(
        { sessionIds: [result.sessionId], tabIds: [], windowIds: [] },
        harness.dependencies,
      ),
    ).resolves.toEqual({ bookmarked: 1, changed: 1 });
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(
      snapshot.sessions[0]!.windows[0]!.tabs.map((tab) => tab.bookmarked),
    ).toEqual([true, true]);
    await undoArchiveChange(harness.dependencies);
    snapshot = await getArchiveSnapshot(harness.dependencies);
    expect(harness.nodes.get(existingBookmarkId)?.url).toBe(first!.url);
    expect(snapshot.sessions[0]!.windows[0]!.tabs[1]!.bookmarkId).toBe(
      second!.bookmarkId,
    );
    expect(
      snapshot.sessions[0]!.windows[0]!.tabs[1]!.bookmarked,
    ).toBeUndefined();
    expect([...harness.nodes.values()].filter((node) => node.url)).toHaveLength(
      1,
    );
  });

  it("invalidates stale history when a non-reversible archive action runs", async () => {
    await hibernateTabs([sourceTab({ id: 10 })], harness.dependencies);
    const tabId = (await getArchiveSnapshot(harness.dependencies)).tabs[0]!
      .bookmarkId;
    await recordArchiveMutation(
      "Rename Tab",
      () => renameArchiveTab(tabId, "Renamed", harness.dependencies),
      harness.dependencies,
    );
    await runArchiveMutationWithoutHistory(
      () => hibernateTabs([sourceTab({ id: 20 })], harness.dependencies),
      harness.dependencies,
    );
    await expect(
      undoArchiveChange(harness.dependencies),
    ).resolves.toMatchObject({ changed: false });
    expect((await getArchiveSnapshot(harness.dependencies)).tabCount).toBe(2);
  });
});

function createHarness(): Harness {
  let nextNodeId = 1;
  const nodes = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  const storage: Record<string, unknown> = {};
  const closedTabIds: number[][] = [];
  const createdTabs: chrome.tabs.CreateProperties[] = [];
  const createdWindows: chrome.windows.CreateData[] = [];
  const groupedTabs: chrome.tabs.GroupOptions[] = [];
  const updatedGroups: Harness["updatedGroups"] = [];
  const updatedTabs: Harness["updatedTabs"] = [];
  const removedWindowIds: number[] = [];

  const childrenOf = (parentId: string) =>
    [...nodes.values()]
      .filter((node) => node.parentId === parentId)
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const removeNode = (id: string): void => {
    for (const child of childrenOf(id)) removeNode(child.id);
    nodes.delete(id);
  };
  const dependencies: ArchiveDependencies = {
    bookmarks: {
      create: async (details) => {
        const id = String(nextNodeId++);
        const node: chrome.bookmarks.BookmarkTreeNode = {
          dateAdded: NOW.getTime(),
          id,
          index: details.parentId
            ? childrenOf(details.parentId).length
            : nodes.size,
          syncing: false,
          ...(details.parentId ? { parentId: details.parentId } : {}),
          title: details.title ?? "",
          ...(details.url ? { url: details.url } : {}),
        };
        nodes.set(id, node);
        return node;
      },
      get: async (idOrIds) => {
        const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
        return ids.flatMap((id) => (nodes.has(id) ? [nodes.get(id)!] : []));
      },
      getChildren: async (id) => childrenOf(id),
      move: async (id, destination) => {
        const current = nodes.get(id);
        if (current === undefined) throw new Error("Bookmark not found");
        const moved: chrome.bookmarks.BookmarkTreeNode = {
          ...current,
          index:
            destination.index ??
            (destination.parentId === undefined
              ? (current.index ?? 0)
              : childrenOf(destination.parentId).length),
        };
        if (destination.parentId !== undefined) {
          moved.parentId = destination.parentId;
        }
        nodes.set(id, moved);
        return moved;
      },
      remove: async (id) => {
        nodes.delete(id);
      },
      removeTree: async (id) => {
        removeNode(id);
      },
      search: async (query) => {
        const text = typeof query === "string" ? query : (query.query ?? "");
        return [...nodes.values()].filter((node) => node.title.includes(text));
      },
      update: async (id, changes) => {
        const current = nodes.get(id);
        if (current === undefined) throw new Error("Bookmark not found");
        const updated = { ...current, ...changes };
        nodes.set(id, updated);
        return updated;
      },
    },
    delay: async () => undefined,
    now: () => new Date(NOW),
    storage: {
      get: async (key) => ({ [String(key)]: storage[String(key)] }),
      set: async (items) => {
        Object.assign(storage, items);
      },
    },
    tabGroups: {
      get: async (groupId) => ({
        collapsed: true,
        color: "blue",
        id: groupId,
        shared: false,
        title: "Research",
        windowId: 7,
      }),
      update: async (groupId, update) => {
        updatedGroups.push({ groupId, update });
        return {
          collapsed: update.collapsed ?? false,
          color: update.color ?? "blue",
          id: groupId,
          shared: false,
          ...(update.title === undefined ? {} : { title: update.title }),
          windowId: 50,
        };
      },
    },
    tabs: {
      create: async (properties) => {
        createdTabs.push(properties);
        return sourceTab({
          id: 200,
          index: properties.index ?? 0,
          pinned: properties.pinned ?? false,
          url: properties.url as string,
          windowId: properties.windowId ?? 9,
        });
      },
      group: async (options) => {
        groupedTabs.push(options);
        return 70;
      },
      query: async () => [],
      remove: async (tabIds) => {
        closedTabIds.push(Array.isArray(tabIds) ? tabIds : [tabIds]);
      },
      update: async (tabId, update) => {
        updatedTabs.push({ tabId, update });
        return sourceTab({ id: tabId });
      },
    },
    windows: {
      create: async (data) => {
        createdWindows.push(data);
        const urls = Array.isArray(data.url) ? data.url : [data.url ?? ""];
        return {
          alwaysOnTop: false,
          focused: true,
          height: 800,
          id: 50,
          incognito: data.incognito === true,
          left: 0,
          state: "normal",
          tabs: urls.map((url, index) =>
            sourceTab({
              id: 100 + index,
              incognito: data.incognito === true,
              index,
              url,
              windowId: 50,
            }),
          ),
          top: 0,
          type: "normal",
          width: 1200,
        };
      },
      get: async (windowId) => ({
        alwaysOnTop: false,
        focused: true,
        height: 800,
        id: windowId,
        incognito: false,
        left: 0,
        state: "normal",
        top: 0,
        type: "normal",
        width: 1200,
      }),
      remove: async (windowId) => {
        removedWindowIds.push(windowId);
      },
    },
  };
  return {
    closedTabIds,
    createdTabs,
    createdWindows,
    dependencies,
    groupedTabs,
    nodes,
    removedWindowIds,
    storage,
    updatedGroups,
    updatedTabs,
  };
}
