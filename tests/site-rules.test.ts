import { describe, expect, it } from "vitest";

import {
  ADVANCED_PATTERN_LIMIT,
  compileSiteRules,
  getSiteProtectionMode,
  isSiteExcluded,
  sanitizeSiteRules,
  type SiteRule,
} from "../src/shared/site-rules";

function rule(overrides: Partial<SiteRule>): SiteRule {
  return {
    enabled: true,
    id: crypto.randomUUID(),
    matchType: "domain",
    pattern: "example.com",
    ...overrides,
  };
}

describe("site rules", () => {
  it("distinguishes exact hosts from domains", () => {
    const exact = compileSiteRules({
      rules: [rule({ matchType: "hostname" })],
      schemaVersion: 1,
    });
    expect(isSiteExcluded("https://example.com/a", exact)).toBe(true);
    expect(isSiteExcluded("https://news.example.com/a", exact)).toBe(false);

    const domain = compileSiteRules({ rules: [rule({})], schemaVersion: 1 });
    expect(isSiteExcluded("https://news.example.com/a", domain)).toBe(true);
  });

  it("supports bounded Chrome-style match patterns", () => {
    const compiled = compileSiteRules({
      rules: [
        rule({
          matchType: "match-pattern",
          pattern: "https://*.example.org/video/*",
        }),
      ],
      schemaVersion: 1,
    });
    expect(isSiteExcluded("https://media.example.org/video/7", compiled)).toBe(
      true,
    );
    expect(
      isSiteExcluded("https://media.example.org/article/7", compiled),
    ).toBe(false);
  });

  it("distinguishes removable exact rules from broader exclusions", () => {
    expect(
      getSiteProtectionMode("https://news.example.com/a", {
        rules: [rule({ matchType: "hostname", pattern: "news.example.com" })],
        schemaVersion: 1,
      }),
    ).toBe("exact");
    expect(
      getSiteProtectionMode("https://news.example.com/a", {
        rules: [rule({ matchType: "domain", pattern: "example.com" })],
        schemaVersion: 1,
      }),
    ).toBe("broader");
    expect(
      getSiteProtectionMode("https://unrelated.test/a", {
        rules: [rule({ matchType: "domain", pattern: "example.com" })],
        schemaVersion: 1,
      }),
    ).toBe("none");
    expect(
      getSiteProtectionMode("https://news.example.com/a", {
        rules: [
          rule({ matchType: "hostname", pattern: "news.example.com" }),
          rule({ matchType: "domain", pattern: "example.com" }),
        ],
        schemaVersion: 1,
      }),
    ).toBe("broader");
  });

  it("rejects an oversized advanced-rule set atomically", () => {
    const rules = Array.from(
      { length: ADVANCED_PATTERN_LIMIT + 1 },
      (_, index) =>
        rule({
          id: String(index),
          matchType: "match-pattern",
          pattern: `https://example.com/${index}/*`,
        }),
    );
    expect(sanitizeSiteRules({ rules, schemaVersion: 1 }).rules).toEqual([]);
  });
});
