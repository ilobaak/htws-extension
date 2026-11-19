import { describe, expect, it } from "vitest";

import {
  createSiteRuleExport,
  mergeSiteRuleExport,
} from "../src/shared/site-rule-transfer";
import type { SiteRulesStore } from "../src/shared/site-rules";

const current: SiteRulesStore = {
  rules: [
    {
      enabled: true,
      id: "existing-id",
      matchType: "domain",
      pattern: "example.com",
    },
  ],
  schemaVersion: 1,
};

describe("site-rule transfer", () => {
  it("exports portable rules without local IDs", () => {
    const exported = createSiteRuleExport(current);

    expect(exported).toMatchObject({
      formatVersion: 1,
      kind: "htws-site-rules",
      product: "Hibernate Tabs, Windows, and Sessions",
      rules: [
        {
          enabled: true,
          matchType: "domain",
          pattern: "example.com",
        },
      ],
    });
    expect(JSON.stringify(exported)).not.toContain("existing-id");
  });

  it("normalizes imports, remaps IDs, and skips duplicate rules", () => {
    const ids = ["new-id", "duplicate-id", "in-file-duplicate-id"];
    const result = mergeSiteRuleExport(
      current,
      {
        formatVersion: 1,
        kind: "htws-site-rules",
        product: "Hibernate Tabs, Windows, and Sessions",
        rules: [
          { enabled: false, matchType: "hostname", pattern: " NEWS.TEST. " },
          { enabled: true, matchType: "domain", pattern: "example.com" },
          { enabled: true, matchType: "hostname", pattern: "news.test" },
        ],
      },
      () => ids.shift() ?? "unexpected-id",
    );

    expect(result.importedRules).toBe(1);
    expect(result.skippedDuplicates).toBe(2);
    expect(result.store.rules).toEqual([
      current.rules[0],
      {
        enabled: false,
        id: "new-id",
        matchType: "hostname",
        pattern: "news.test",
      },
    ]);
  });

  it("rejects unrelated and malformed files", () => {
    expect(() => mergeSiteRuleExport(current, { rules: [] })).toThrow(
      "not a supported Hibernate Tabs, Windows, and Sessions site-rule export",
    );
    expect(() =>
      mergeSiteRuleExport(current, {
        formatVersion: 1,
        kind: "htws-site-rules",
        product: "Hibernate Tabs, Windows, and Sessions",
        rules: [{ enabled: true, matchType: "domain", pattern: "bad/path" }],
      }),
    ).toThrow("valid hostname, domain, or match pattern");
  });
});
