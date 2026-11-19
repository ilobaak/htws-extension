import { describe, expect, it } from "vitest";

import {
  filterActivityEntries,
  type ActivityTypeFilter,
} from "../src/activity/activity-filter";
import type { ActivityLogEntry } from "../src/background/activity-log";

const entries: ActivityLogEntry[] = [
  {
    action: "hibernate",
    detail: "One protected tab left open.",
    id: "hibernate-window",
    occurredAt: Date.UTC(2026, 10, 7, 12),
    outcome: "partial",
    tabs: [
      {
        title: "Quarterly planning",
        url: "https://example.com/planning",
      },
    ],
    target: "window",
    windowName: "Research",
  },
  {
    action: "restore",
    id: "restore-tab",
    occurredAt: Date.UTC(2026, 10, 7, 13),
    outcome: "success",
    tabs: [{ title: "Mail", url: "https://mail.example.com" }],
    target: "tab",
  },
];

describe("activity filtering", () => {
  it.each<[ActivityTypeFilter, string]>([
    ["hibernate", "hibernate-window"],
    ["window", "hibernate-window"],
    ["restore", "restore-tab"],
    ["tab", "restore-tab"],
  ])("filters %s across actions and targets", (type, expectedId) => {
    expect(
      filterActivityEntries(entries, type, "").map(({ id }) => id),
    ).toEqual([expectedId]);
  });

  it.each(["quarterly", "EXAMPLE.COM/PLANNING", "protected", "research"])(
    "matches visible entry text for %s",
    (query) => {
      expect(filterActivityEntries(entries, "all", query)[0]?.id).toBe(
        "hibernate-window",
      );
    },
  );

  it("combines type and text filters", () => {
    expect(filterActivityEntries(entries, "restore", "planning")).toEqual([]);
  });
});
