import { describe, expect, it } from "vitest";

import {
  createArchiveExport,
  mergeArchiveExport,
} from "../src/background/archive-transfer";
import type { ArchiveStore } from "../src/background/hibernate-archive";

const STORE: ArchiveStore = {
  schemaVersion: 4,
  sessions: {
    "session-original": {
      createdAt: 100,
      name: "Work",
      savedFolderId: "browser-session-folder",
      windowIds: ["window-session"],
    },
  },
  topLevelOrder: ["session:session-original", "tab:tab-top-level"],
  windows: {
    "window-session": {
      createdAt: 100,
      entryType: "window",
      groups: {
        research: { collapsed: false, color: "blue", title: "Research" },
      },
      savedFolderId: "browser-window-folder",
      sessionId: "session-original",
      sourceWindowId: 8,
      tabs: {
        "tab-session": {
          active: true,
          bookmarkId: "tab-session",
          createdAt: 100,
          groupKey: "research",
          index: 0,
          pinned: false,
          savedBookmarkId: "browser-bookmark",
          title: "Session tab",
          url: "https://example.com/session",
        },
      },
    },
    "window-top-level": {
      createdAt: 200,
      entryType: "tab",
      groups: {},
      sourceWindowId: 9,
      tabs: {
        "tab-top-level": {
          active: true,
          bookmarkId: "tab-top-level",
          createdAt: 200,
          index: 0,
          pinned: true,
          title: "Top-level tab",
          url: "https://example.com/tab",
        },
      },
    },
  },
};

function emptyStore(): ArchiveStore {
  return { schemaVersion: 4, sessions: {}, windows: {} };
}

function createSequentialIdFactory(): (
  prefix: "entry" | "session" | "tab",
) => string {
  let sequence = 0;
  return (prefix) => `${prefix}-imported-${(sequence += 1)}`;
}

describe("archive transfer", () => {
  it("round-trips archive pin state for every hierarchy level", () => {
    const pinned = structuredClone(STORE);
    pinned.sessions["session-original"]!.archivePinned = true;
    pinned.windows["window-session"]!.archivePinned = true;
    pinned.windows["window-session"]!.groups.research!.archivePinned = true;
    pinned.windows["window-session"]!.tabs["tab-session"]!.archivePinned = true;
    const exported = createArchiveExport(pinned);
    const imported = mergeArchiveExport(
      emptyStore(),
      exported,
      createSequentialIdFactory(),
    ).store;
    const session = Object.values(imported.sessions)[0]!;
    const window = imported.windows[session.windowIds[0]!]!;

    expect(session.archivePinned).toBe(true);
    expect(window.archivePinned).toBe(true);
    expect(Object.values(window.groups)[0]?.archivePinned).toBe(true);
    expect(Object.values(window.tabs)[0]?.archivePinned).toBe(true);
  });

  it("exports a nested, self-describing v2 archive without local IDs", () => {
    const exported = createArchiveExport(STORE);

    expect(exported).toMatchObject({
      archive: {
        summary: { sessions: 1, tabs: 2, windows: 1 },
      },
      formatVersion: 2,
      kind: "htws-archive",
      product: "Hibernate Tabs, Windows, and Sessions",
    });
    expect(exported.archive.entries.map((entry) => entry.type)).toEqual([
      "session",
      "tab",
    ]);
    expect(exported.archive.entries[0]).toMatchObject({
      name: "Work",
      type: "session",
      windows: [
        {
          tabs: [
            {
              group: {
                color: "blue",
                key: "group-1",
                title: "Research",
              },
              position: 0,
              type: "tab",
              url: "https://example.com/session",
            },
          ],
          type: "window",
        },
      ],
    });
    expect(JSON.stringify(exported)).not.toContain("tab-session");
    expect(JSON.stringify(exported)).not.toContain("browser-bookmark");
    expect(exported.formatNotes.hierarchy).toContain(
      "session contains windows",
    );
  });

  it("imports v2 with fresh IDs, stable order, and duplicate-safe merging", () => {
    const exported = createArchiveExport(STORE);
    const createId = createSequentialIdFactory();

    const first = mergeArchiveExport(emptyStore(), exported, createId);
    expect(first.summary).toEqual({
      importedSessions: 1,
      importedTabs: 2,
      importedWindows: 2,
      skippedDuplicates: 0,
    });
    expect(first.store.topLevelOrder?.map((key) => key.split(":")[0])).toEqual([
      "session",
      "tab",
    ]);
    expect(Object.keys(first.store.sessions)[0]).toMatch(/^session-imported-/);

    const second = mergeArchiveExport(first.store, exported, createId);
    expect(second.changed).toBe(false);
    expect(second.summary).toMatchObject({
      importedSessions: 0,
      importedTabs: 0,
      importedWindows: 0,
      skippedDuplicates: 2,
    });
  });

  it("round-trips a first-class grouped-tab entry with its metadata", () => {
    const grouped = structuredClone(STORE);
    const window = grouped.windows["window-top-level"]!;
    window.entryType = "group";
    window.name = "Reading";
    window.groups = {
      reading: { collapsed: true, color: "purple", title: "Reading" },
    };
    window.tabs["tab-top-level"]!.pinned = false;
    window.tabs["tab-top-level"]!.groupKey = "reading";
    grouped.topLevelOrder = [
      "session:session-original",
      "window:window-top-level",
    ];

    const exported = createArchiveExport(grouped);
    const portableGroup = exported.archive.entries[1];
    expect(portableGroup).toMatchObject({
      kind: "group",
      name: "Reading",
      tabs: [{ group: { collapsed: true, color: "purple", title: "Reading" } }],
      type: "window",
    });
    const imported = mergeArchiveExport(
      emptyStore(),
      exported,
      createSequentialIdFactory(),
    );
    const importedGroup = Object.values(imported.store.windows).find(
      (candidate) => candidate.entryType === "group",
    );
    expect(importedGroup).toMatchObject({
      entryType: "group",
      groups: {
        "group-1": { collapsed: true, color: "purple", title: "Reading" },
      },
      name: "Reading",
    });
  });

  it("normalizes a future or unsupported imported group color", () => {
    const exported = createArchiveExport(STORE) as unknown as {
      archive: {
        entries: Array<{
          windows?: Array<{ tabs: Array<{ group?: { color: string } }> }>;
        }>;
      };
    };
    const group = exported.archive.entries[0]?.windows?.[0]?.tabs[0]?.group;
    expect(group).toBeDefined();
    group!.color = "future-browser-color";

    const imported = mergeArchiveExport(
      emptyStore(),
      exported,
      createSequentialIdFactory(),
    );

    const importedGroups = Object.values(imported.store.windows).flatMap(
      (window) => Object.values(window.groups),
    );
    expect(importedGroups[0]?.color).toBe("grey");
  });

  it("recognizes an export re-imported into its original archive", () => {
    const result = mergeArchiveExport(
      STORE,
      createArchiveExport(STORE),
      createSequentialIdFactory(),
    );

    expect(result.changed).toBe(false);
    expect(result.summary).toEqual({
      importedSessions: 0,
      importedTabs: 0,
      importedWindows: 0,
      skippedDuplicates: 2,
    });
  });

  it("rejects deprecated product identities and archive versions", () => {
    const legacy = {
      archive: structuredClone(STORE),
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      kind: "deprecated-archive",
      product: "Deprecated Product",
    };

    expect(() =>
      mergeArchiveExport(emptyStore(), legacy, createSequentialIdFactory()),
    ).toThrow("not a supported");

    expect(() =>
      mergeArchiveExport(
        emptyStore(),
        {
          ...legacy,
          kind: "htws-archive",
          product: "Hibernate Tabs, Windows, and Sessions",
        },
        createSequentialIdFactory(),
      ),
    ).toThrow("format version 1");
  });

  it("imports supported internal browser URLs", () => {
    const exported = createArchiveExport(STORE);
    const tab = exported.archive.entries.find((entry) => entry.type === "tab");
    if (tab?.type !== "tab") throw new Error("Missing tab fixture");
    tab.url = "brave://bookmarks/";

    expect(
      mergeArchiveExport(emptyStore(), exported, createSequentialIdFactory())
        .summary.importedTabs,
    ).toBe(2);
  });

  it("preserves private-tab metadata during export and import", () => {
    const privateStore = structuredClone(STORE);
    const window = privateStore.windows["window-top-level"]!;
    window.incognito = true;
    window.tabs["tab-top-level"]!.incognito = true;
    const exported = createArchiveExport(privateStore);
    expect(exported.archive.entries[1]).toMatchObject({ private: true });

    const imported = mergeArchiveExport(
      emptyStore(),
      exported,
      createSequentialIdFactory(),
    );
    const importedWindow = Object.values(imported.store.windows).find(
      (entry) => entry.incognito,
    );
    expect(importedWindow).toMatchObject({ incognito: true });
    expect(Object.values(importedWindow!.tabs)[0]).toMatchObject({
      incognito: true,
    });
  });

  it("rejects mixed privacy, duplicate positions, and conflicting groups", () => {
    const mixed = createArchiveExport(STORE);
    const session = mixed.archive.entries[0];
    if (session?.type !== "session") throw new Error("Missing session fixture");
    session.windows[0]!.private = true;
    expect(() =>
      mergeArchiveExport(emptyStore(), mixed, createSequentialIdFactory()),
    ).toThrow("cannot mix private and regular tabs");

    const duplicatePosition = createArchiveExport(STORE);
    const duplicateSession = duplicatePosition.archive.entries[0];
    if (duplicateSession?.type !== "session") {
      throw new Error("Missing session fixture");
    }
    duplicateSession.windows[0]!.tabs.push({
      ...duplicateSession.windows[0]!.tabs[0]!,
      active: false,
      url: "https://example.com/duplicate-position",
    });
    expect(() =>
      mergeArchiveExport(
        emptyStore(),
        duplicatePosition,
        createSequentialIdFactory(),
      ),
    ).toThrow("duplicate tab positions");

    const conflictingGroup = createArchiveExport(STORE);
    const conflictSession = conflictingGroup.archive.entries[0];
    if (conflictSession?.type !== "session") {
      throw new Error("Missing session fixture");
    }
    conflictSession.windows[0]!.tabs.push({
      ...conflictSession.windows[0]!.tabs[0]!,
      active: false,
      group: {
        ...conflictSession.windows[0]!.tabs[0]!.group!,
        color: "red",
      },
      position: 1,
      url: "https://example.com/conflicting-group",
    });
    expect(() =>
      mergeArchiveExport(
        emptyStore(),
        conflictingGroup,
        createSequentialIdFactory(),
      ),
    ).toThrow("conflicting group metadata");
  });

  it("rejects prohibited URLs and unknown future format versions", () => {
    const exported = createArchiveExport(STORE);
    const tab = exported.archive.entries.find((entry) => entry.type === "tab");
    if (tab?.type !== "tab") throw new Error("Missing tab fixture");
    tab.url = "file:///private.txt";
    expect(() =>
      mergeArchiveExport(emptyStore(), exported, createSequentialIdFactory()),
    ).toThrow("HTTP, HTTPS, chrome, or brave");

    expect(() =>
      mergeArchiveExport(
        emptyStore(),
        { ...exported, formatVersion: 99 },
        createSequentialIdFactory(),
      ),
    ).toThrow("format version 99 is not supported");
  });
});
