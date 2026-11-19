import { describe, expect, it } from "vitest";

import {
  planAutoHibernateBatches,
  resolveLastAccessed,
  shouldCheckAutoHibernateTab,
} from "../src/core/auto-hibernate";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";

const NOW = 1_800_000_000_000;

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    groupId: -1,
    highlighted: false,
    id: 7,
    incognito: false,
    index: 0,
    lastAccessed: NOW - 60 * 60_000,
    pinned: false,
    selected: false,
    splitViewId: -1,
    url: "https://example.com/article",
    windowId: 1,
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("automatic hibernation scheduling", () => {
  it("checks an inactive website when the default delay elapses", () => {
    expect(
      shouldCheckAutoHibernateTab(
        tab(),
        DEFAULT_SETTINGS,
        NOW - 60 * 60_000,
        NOW,
      ),
    ).toBe(true);
  });

  it("skips active, recent, and never-scheduled tabs", () => {
    expect(
      shouldCheckAutoHibernateTab(
        tab({ active: true }),
        DEFAULT_SETTINGS,
        NOW - 60 * 60_000,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldCheckAutoHibernateTab(
        tab(),
        DEFAULT_SETTINGS,
        NOW - 59 * 60_000,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldCheckAutoHibernateTab(
        tab(),
        settings({ autoHibernateMinutes: null }),
        NOW - 24 * 60 * 60_000,
        NOW,
      ),
    ).toBe(false);
  });

  it("requires explicit scope for internal and private tabs", () => {
    const old = NOW - 60 * 60_000;
    expect(
      shouldCheckAutoHibernateTab(
        tab({ url: "chrome://settings" }),
        DEFAULT_SETTINGS,
        old,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldCheckAutoHibernateTab(
        tab({ incognito: true }),
        DEFAULT_SETTINGS,
        old,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldCheckAutoHibernateTab(
        tab({ url: "chrome://settings" }),
        settings({ autoHibernateIncludeInternalPages: true }),
        old,
        NOW,
      ),
    ).toBe(true);
    expect(
      shouldCheckAutoHibernateTab(
        tab({ incognito: true }),
        settings({ autoHibernateIncludeIncognito: true }),
        old,
        NOW,
      ),
    ).toBe(true);
  });

  it("waits for every grouped tab before planning one group batch", () => {
    const old = NOW - 61 * 60_000;
    const recent = NOW - 10 * 60_000;
    const grouped = [
      tab({ groupId: 4, id: 1, lastAccessed: old }),
      tab({ groupId: 4, id: 2, index: 1, lastAccessed: recent }),
    ];
    expect(planAutoHibernateBatches(grouped, settings(), NOW)).toEqual([]);
    grouped[1] = { ...grouped[1]!, lastAccessed: old };
    expect(planAutoHibernateBatches(grouped, settings(), NOW)).toEqual([
      grouped,
    ]);
  });

  it("plans grouped tabs individually when that behavior is selected", () => {
    const old = NOW - 61 * 60_000;
    const grouped = [
      tab({ groupId: 4, id: 1, lastAccessed: old }),
      tab({ groupId: 4, id: 2, index: 1, lastAccessed: old }),
    ];
    expect(
      planAutoHibernateBatches(
        grouped,
        settings({ autoHibernateGroupedTabs: "individually" }),
        NOW,
      ),
    ).toEqual([[grouped[0]], [grouped[1]]]);
  });

  it("uses the newest native or tracked access time", () => {
    const native = NOW - 30_000;
    const tracked = NOW - 10_000;
    expect(
      resolveLastAccessed(tab({ lastAccessed: native }), tracked, NOW),
    ).toBe(tracked);
    expect(
      resolveLastAccessed(
        { ...tab(), lastAccessed: undefined } as unknown as chrome.tabs.Tab,
        tracked,
        NOW,
      ),
    ).toBe(tracked);
  });
});
