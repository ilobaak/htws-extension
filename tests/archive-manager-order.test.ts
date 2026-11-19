import { describe, expect, it } from "vitest";

import type { ArchiveSnapshot } from "../src/background/hibernate-archive";
import {
  getArchiveEntryOrder,
  reconcileArchiveEntryOrder,
} from "../src/shared/archive-manager";

const snapshot: ArchiveSnapshot = {
  sessions: [
    {
      archivePinned: true,
      createdAt: 100,
      name: "Pinned session",
      sessionId: "session-pinned",
      title: "Pinned session",
      windows: [],
    },
  ],
  tabCount: 1,
  tabs: [
    {
      bookmarkId: "tab-newer",
      createdAt: 300,
      pinned: false,
      title: "Newer tab",
      url: "https://example.com/newer",
    },
  ],
  windows: [
    {
      createdAt: 200,
      folderId: "window-middle",
      tabs: [],
      title: "Middle window",
    },
  ],
};

describe("archive manager ordering", () => {
  it("keeps pinned entries first under every secondary sort", () => {
    for (const sortKey of [
      "date",
      "name",
      "type",
      "bookmarked",
      "pinned",
    ] as const) {
      const order = getArchiveEntryOrder(snapshot, {
        sortDirection: "descending",
        sortKey,
        typePriority: "tab",
      });
      expect(order[0]).toBe("session:session-pinned");
    }
  });

  it("rebuilds a stable order when a mutation adds a top-level entry", () => {
    const previous = getArchiveEntryOrder(snapshot, {
      sortDirection: "descending",
      sortKey: "date",
    });
    const next: ArchiveSnapshot = {
      ...snapshot,
      tabCount: 2,
      tabs: [
        ...snapshot.tabs,
        {
          bookmarkId: "tab-newest",
          createdAt: 400,
          pinned: false,
          title: "Newest tab",
          url: "https://example.com/newest",
        },
      ],
    };
    expect(
      reconcileArchiveEntryOrder(next, previous, {
        sortDirection: "descending",
        sortKey: "date",
      })[1],
    ).toBe("tab:tab-newest");
  });
});
