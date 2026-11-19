import { describe, expect, it } from "vitest";

import type { ArchiveSnapshot } from "../src/background/hibernate-archive";
import {
  deselectArchiveMatches,
  effectiveArchiveSelection,
  inclusiveArchiveSelectionRange,
  type ArchiveSelectionSets,
} from "../src/hibernated/archive-selection";

const snapshot: ArchiveSnapshot = {
  sessions: [
    {
      createdAt: 1,
      sessionId: "session-1",
      title: "Session",
      windows: [
        {
          createdAt: 1,
          folderId: "window-1",
          groups: [
            {
              collapsed: false,
              color: "blue",
              folderId: "window-1",
              key: "group-1",
              tabs: [],
              title: "Group",
            },
          ],
          tabs: [
            {
              bookmarkId: "matched-tab",
              createdAt: 1,
              groupKey: "group-1",
              pinned: false,
              title: "Matched",
              url: "https://example.com/matched",
            },
            {
              bookmarkId: "other-tab",
              createdAt: 1,
              groupKey: "group-1",
              pinned: false,
              title: "Other",
              url: "https://example.com/other",
            },
          ],
          title: "Window",
        },
      ],
    },
  ],
  tabCount: 2,
  tabs: [],
  windows: [],
};

describe("archive Select Matched deselection", () => {
  it("removes an implicitly selected match without reselecting it", () => {
    const selection = emptySelection();
    selection.sessionIds.add("session-1");
    const matches = emptySelection();
    matches.tabIds.add("matched-tab");

    const next = deselectArchiveMatches(snapshot, selection, matches);
    const effective = effectiveArchiveSelection(snapshot, next);

    expect(effective.tabIds.has("matched-tab")).toBe(false);
    expect(effective.tabIds.has("other-tab")).toBe(true);
    expect(next.sessionIds.size).toBe(0);
    expect(next.tabIds.has("other-tab")).toBe(true);
  });

  it("preserves selections that are not filter matches", () => {
    const selection = emptySelection();
    selection.tabIds.add("matched-tab");
    selection.tabIds.add("other-tab");
    const matches = emptySelection();
    matches.tabIds.add("matched-tab");

    const next = deselectArchiveMatches(snapshot, selection, matches);

    expect(next.tabIds).toEqual(new Set(["other-tab"]));
  });
});

describe("archive Shift-click range selection", () => {
  const order = [
    { id: "session-1", type: "session" as const },
    { id: "window-1", type: "window" as const },
    { id: "tab-1", type: "tab" as const },
    { id: "tab-2", type: "tab" as const },
  ];

  it("returns the inclusive visible range in either direction", () => {
    expect(inclusiveArchiveSelectionRange(order, order[0]!, order[2]!)).toEqual(
      order.slice(0, 3),
    );
    expect(inclusiveArchiveSelectionRange(order, order[3]!, order[1]!)).toEqual(
      order.slice(1, 4),
    );
  });

  it("falls back to the target when the anchor is no longer visible", () => {
    expect(
      inclusiveArchiveSelectionRange(
        order,
        { id: "filtered-out", type: "tab" },
        order[2]!,
      ),
    ).toEqual([order[2]!]);
  });
});

function emptySelection(): ArchiveSelectionSets {
  return {
    groupIds: new Set(),
    sessionIds: new Set(),
    tabIds: new Set(),
    windowIds: new Set(),
  };
}
