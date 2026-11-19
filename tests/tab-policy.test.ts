import { describe, expect, it } from "vitest";

import { evaluateTab, type TabSnapshot } from "../src/core/tab-policy";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { compileSiteRules } from "../src/shared/site-rules";

const NOW = 1_800_000_000_000;

function tab(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    active: false,
    audible: false,
    id: 7,
    incognito: false,
    index: 0,
    lastAccessed: NOW - 3_600_001,
    mutedForCapture: false,
    pinned: false,
    url: "https://example.com/article",
    windowId: 1,
    ...overrides,
  };
}

describe("evaluateTab", () => {
  it("allows an old inactive web tab", () => {
    const result = evaluateTab(tab(), DEFAULT_SETTINGS, { now: NOW });
    expect(result).toMatchObject({
      decisionReason: "eligible",
      eligible: true,
      protectionLevel: "basic",
    });
  });

  it.each([
    ["active", { active: true }],
    ["unsupported-url", { url: "chrome://settings" }],
    ["tab-capture-active", { mutedForCapture: true }],
    ["pinned", { pinned: true }],
    ["audible", { audible: true }],
  ] as const)("protects a tab because it is %s", (reason, override) => {
    expect(
      evaluateTab(tab(override), DEFAULT_SETTINGS, { now: NOW }),
    ).toMatchObject({ decisionReason: reason, eligible: false });
  });

  it("applies ordinary protection rules to an incognito tab", () => {
    expect(
      evaluateTab(tab({ incognito: true }), DEFAULT_SETTINGS, {
        ignoreInactivity: true,
      }),
    ).toMatchObject({ decisionReason: "eligible", eligible: true });
  });

  it("allows a recently accessed tab because hibernation is explicit", () => {
    const result = evaluateTab(
      tab({ lastAccessed: NOW - 10_000 }),
      DEFAULT_SETTINGS,
      { ignoreInactivity: true, now: NOW },
    );
    expect(result.decisionReason).toBe("eligible");
  });

  it("protects a recently active tab during automatic hibernation", () => {
    const result = evaluateTab(
      tab({ lastAccessed: NOW - 59 * 60_000 }),
      DEFAULT_SETTINGS,
      { now: NOW },
    );
    expect(result).toMatchObject({
      decisionReason: "recently-active",
      eligible: false,
      inactiveForMs: 59 * 60_000,
    });
  });

  it("allows a tab once the automatic hibernation delay has elapsed", () => {
    const result = evaluateTab(
      tab({ lastAccessed: NOW - 60 * 60_000 }),
      DEFAULT_SETTINGS,
      { now: NOW },
    );
    expect(result).toMatchObject({
      decisionReason: "eligible",
      eligible: true,
      inactiveForMs: 60 * 60_000,
    });
  });

  it("lets an explicit manual action bypass only inactivity", () => {
    const result = evaluateTab(
      tab({ lastAccessed: NOW - 10_000 }),
      DEFAULT_SETTINGS,
      { ignoreInactivity: true, now: NOW },
    );
    expect(result.eligible).toBe(true);

    const pinned = evaluateTab(
      tab({ lastAccessed: NOW - 10_000, pinned: true }),
      DEFAULT_SETTINGS,
      { ignoreInactivity: true, now: NOW },
    );
    expect(pinned.decisionReason).toBe("pinned");
  });

  it("lets explicit hibernation include the active tab", () => {
    const result = evaluateTab(tab({ active: true }), DEFAULT_SETTINGS, {
      ignoreActive: true,
      ignoreInactivity: true,
      now: NOW,
    });
    expect(result).toMatchObject({
      decisionReason: "eligible",
      eligible: true,
    });
  });

  it("does not let explicit hibernation bypass content safety", () => {
    const result = evaluateTab(tab({ audible: true }), DEFAULT_SETTINGS, {
      ignoreActive: true,
      ignoreInactivity: true,
      ignorePinned: true,
      now: NOW,
    });
    expect(result).toMatchObject({
      decisionReason: "audible",
      eligible: false,
    });
  });

  it("protects excluded sites before page-level checks", () => {
    const siteRules = compileSiteRules({
      rules: [
        {
          enabled: true,
          id: "rule",
          matchType: "domain",
          pattern: "example.com",
        },
      ],
      schemaVersion: 1,
    });
    expect(
      evaluateTab(tab(), DEFAULT_SETTINGS, { now: NOW, siteRules }),
    ).toMatchObject({ decisionReason: "site-excluded", eligible: false });
  });

  it("protects an observable page until its top observer is ready", () => {
    expect(
      evaluateTab(tab(), DEFAULT_SETTINGS, {
        hostAccess: "selected",
        now: NOW,
      }),
    ).toMatchObject({
      decisionReason: "observer-not-ready",
      protectionLevel: "partial",
    });
  });

  it.each([
    ["playing-media", { mediaPlaying: true }],
    ["modified-fields", { formDirty: true }],
  ] as const)("protects page state because it is %s", (reason, state) => {
    const pageSafety = {
      formDirty: false,
      frameCoverageComplete: true,
      mediaPlaying: false,
      observerReady: true,
      pictureInPicture: false,
      streamActive: false,
      ...state,
    };
    expect(
      evaluateTab(tab(), DEFAULT_SETTINGS, {
        hostAccess: "all",
        now: NOW,
        pageSafety,
      }),
    ).toMatchObject({ decisionReason: reason, eligible: false });
  });

  it("reports full protection only with complete frame coverage", () => {
    const pageSafety = {
      formDirty: false,
      frameCoverageComplete: true,
      mediaPlaying: false,
      observerReady: true,
      pictureInPicture: false,
      streamActive: false,
    };
    expect(
      evaluateTab(tab(), DEFAULT_SETTINGS, {
        hostAccess: "all",
        now: NOW,
        pageSafety,
      }),
    ).toMatchObject({ protectionLevel: "full", warnings: [] });
  });
});
