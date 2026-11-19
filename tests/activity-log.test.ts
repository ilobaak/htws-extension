import { afterEach, describe, expect, it, vi } from "vitest";

import {
  importActivityLog,
  pruneActivityEntries,
  type ActivityLogEntry,
} from "../src/background/activity-log";

const NOW = new Date("2026-11-07T12:00:00Z").getTime();

function entry(id: string, ageInDays: number): ActivityLogEntry {
  return {
    action: "hibernate",
    id,
    occurredAt: NOW - ageInDays * 24 * 60 * 60 * 1000,
    outcome: "success",
    tabs: [{ title: id, url: `https://example.com/${id}` }],
    target: "tab",
  };
}

describe("activity retention", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps every entry when automatic clearing is disabled", () => {
    const entries = [entry("old", 400), entry("new", 0)];
    expect(pruneActivityEntries(entries, 0, NOW)).toEqual(entries);
  });

  it("removes entries older than the configured number of days", () => {
    expect(
      pruneActivityEntries(
        [entry("expired", 8), entry("boundary", 7), entry("recent", 1)],
        7,
        NOW,
      ).map(({ id }) => id),
    ).toEqual(["boundary", "recent"]);
  });

  it("imports valid activity exports and skips duplicate IDs", async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: storage[key] }),
          set: async (items: Record<string, unknown>) =>
            Object.assign(storage, items),
        },
        sync: {
          get: async () => ({ settings: { activityRetentionDays: 90 } }),
        },
      },
    });
    const exported = {
      entries: [
        {
          action: "restore",
          id: "imported-entry",
          occurredAt: Date.now(),
          outcome: "success",
          tabs: [{ title: "Example", url: "https://example.com/" }],
          target: "tab",
        },
      ],
      formatVersion: 1,
      kind: "htws-activity",
      product: "Hibernate Tabs, Windows, and Sessions",
    };

    await expect(importActivityLog(exported)).resolves.toMatchObject({
      imported: 1,
      retained: 1,
      skippedDuplicates: 0,
    });
    await expect(importActivityLog(exported)).resolves.toMatchObject({
      imported: 0,
      retained: 1,
      skippedDuplicates: 1,
    });
  });

  it("round-trips diagnostic URLs that are not restorable", async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: storage[key] }),
          set: async (items: Record<string, unknown>) =>
            Object.assign(storage, items),
        },
        sync: { get: async () => ({}) },
      },
    });
    await expect(
      importActivityLog({
        entries: [
          {
            action: "restore",
            id: "unsafe-entry",
            occurredAt: Date.now(),
            outcome: "success",
            tabs: [{ title: "Local", url: "file:///private.txt" }],
            target: "tab",
          },
        ],
        formatVersion: 1,
        kind: "htws-activity",
        product: "Hibernate Tabs, Windows, and Sessions",
      }),
    ).resolves.toMatchObject({ imported: 1, retained: 1 });
  });

  it("rejects malformed activity URLs", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        sync: { get: async () => ({}) },
      },
    });
    await expect(
      importActivityLog({
        entries: [
          {
            action: "restore",
            id: "invalid-url-entry",
            occurredAt: Date.now(),
            outcome: "success",
            tabs: [{ title: "Invalid", url: "not a URL" }],
            target: "tab",
          },
        ],
        formatVersion: 1,
        kind: "htws-activity",
        product: "Hibernate Tabs, Windows, and Sessions",
      }),
    ).rejects.toThrow("invalid URL");
  });
});
