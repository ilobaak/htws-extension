import { describe, expect, it } from "vitest";
import { evaluateTab, snapshotTab } from "../src/core/tab-policy";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { compileSiteRules } from "../src/shared/site-rules";

describe("large tab inventory", () => {
  it("evaluates 1,000 tabs with indexed exclusions", () => {
    const rules = compileSiteRules({
      rules: [
        {
          enabled: true,
          id: "keep",
          matchType: "domain",
          pattern: "example.com",
        },
      ],
      schemaVersion: 1,
    });
    const eligible = Array.from(
      { length: 1_000 },
      (_, index): chrome.tabs.Tab => ({
        active: false,
        autoDiscardable: true,
        discarded: false,
        frozen: false,
        groupId: -1,
        highlighted: false,
        id: index + 1,
        incognito: false,
        index,
        lastAccessed: Date.now(),
        pinned: false,
        selected: false,
        splitViewId: -1,
        url:
          index % 100 === 0
            ? `https://keep.example.com/${index}`
            : `https://site${index}.test/`,
        windowId: 1,
      }),
    ).filter(
      (tab) =>
        evaluateTab(snapshotTab(tab), DEFAULT_SETTINGS, {
          ignoreInactivity: true,
          siteRules: rules,
        }).eligible,
    );
    expect(eligible).toHaveLength(990);
  });
});
