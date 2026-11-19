import { describe, expect, it } from "vitest";

import type { ArchiveSnapshot } from "../src/background/hibernate-archive";
import { filterArchiveSnapshot } from "../src/hibernated/archive-filter";

const snapshot: ArchiveSnapshot = {
  sessions: [
    {
      createdAt: Date.UTC(2026, 10, 8, 12),
      name: "Research Session",
      sessionId: "session-1",
      title: "Research Session",
      windows: [
        {
          createdAt: Date.UTC(2026, 10, 8, 12),
          folderId: "window-1",
          name: "Documentation",
          tabs: [
            {
              bookmarkId: "tab-1",
              createdAt: Date.UTC(2026, 10, 8, 12),
              groupColor: "blue",
              groupKey: "group-1",
              groupTitle: "Research",
              pinned: false,
              title: "API Guide",
              url: "https://example.com/api",
            },
          ],
          groups: [
            {
              collapsed: false,
              color: "blue",
              folderId: "window-1",
              key: "group-1",
              tabs: [],
              title: "Research",
            },
          ],
          title: "Documentation",
        },
      ],
    },
  ],
  tabCount: 2,
  tabs: [
    {
      bookmarkId: "tab-2",
      bookmarked: true,
      createdAt: Date.UTC(2026, 10, 7, 12),
      pinned: true,
      title: "Release Notes",
      url: "https://example.com/releases",
    },
  ],
  windows: [],
};

describe("archive text filtering", () => {
  it("keeps hierarchy around a matching nested tab", () => {
    const result = filterArchiveSnapshot(snapshot, "example.com/api");

    expect(result.matchCount).toBe(1);
    expect(result.snapshot.sessions).toHaveLength(1);
    expect(result.snapshot.sessions[0]?.windows[0]?.tabs).toHaveLength(1);
    expect(result.snapshot.tabs).toHaveLength(0);
  });

  it("does not search type, bookmark, pin, or generated count metadata", () => {
    expect(filterArchiveSnapshot(snapshot, "window").matchCount).toBe(0);
    expect(filterArchiveSnapshot(snapshot, "bookmarked").matchCount).toBe(0);
    expect(filterArchiveSnapshot(snapshot, "pinned").matchCount).toBe(0);
    expect(filterArchiveSnapshot(snapshot, "1 window 1 tab").matchCount).toBe(
      0,
    );
  });

  it("returns an empty snapshot when nothing matches", () => {
    const result = filterArchiveSnapshot(snapshot, "no such archive");

    expect(result.matchCount).toBe(0);
    expect(result.snapshot.tabCount).toBe(0);
  });

  it("matches tab group labels and color names", () => {
    const byLabel = filterArchiveSnapshot(snapshot, "research");
    const byColor = filterArchiveSnapshot(snapshot, "blue");

    expect(byLabel.matches.tabIds.has("tab-1")).toBe(true);
    expect(byColor.matches.groupIds.has("window-1\u0000group-1")).toBe(true);
    expect(byColor.matches.tabIds.has("tab-1")).toBe(true);
  });

  it("does not treat the Group label as searchable text", () => {
    const result = filterArchiveSnapshot(snapshot, "group research");

    expect(result.matchCount).toBe(0);
  });
});
