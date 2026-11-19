import {
  ADVANCED_PATTERN_LIMIT,
  createRule,
  type SiteRule,
  type SiteRuleMatchType,
  type SiteRulesStore,
} from "./site-rules";
import { isSupportedProductName, PRODUCT_NAME } from "./product";

const MAX_SITE_RULES = 10_000;

export interface SiteRuleExportFile {
  exportedAt: string;
  formatVersion: 1;
  kind: "htws-site-rules";
  product: typeof PRODUCT_NAME;
  rules: Array<Pick<SiteRule, "enabled" | "matchType" | "pattern">>;
}

export interface SiteRuleImportResult {
  importedRules: number;
  skippedDuplicates: number;
  store: SiteRulesStore;
}

export function createSiteRuleExport(
  store: SiteRulesStore,
): SiteRuleExportFile {
  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    kind: "htws-site-rules",
    product: PRODUCT_NAME,
    rules: store.rules.map(({ enabled, matchType, pattern }) => ({
      enabled,
      matchType,
      pattern,
    })),
  };
}

export function mergeSiteRuleExport(
  current: SiteRulesStore,
  value: unknown,
  createId: () => string = () => crypto.randomUUID(),
): SiteRuleImportResult {
  const imported = parseSiteRuleExport(value, createId);
  const rules = [...current.rules];
  const existing = new Set(rules.map(ruleKey));
  let importedRules = 0;
  let skippedDuplicates = 0;
  for (const rule of imported) {
    const key = ruleKey(rule);
    if (existing.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    if (rules.length >= MAX_SITE_RULES) {
      throw new Error(
        `Site rule imports are limited to ${MAX_SITE_RULES} rules.`,
      );
    }
    rules.push(rule);
    existing.add(key);
    importedRules += 1;
  }
  if (
    rules.filter((rule) => rule.matchType === "match-pattern").length >
    ADVANCED_PATTERN_LIMIT
  ) {
    throw new Error(
      `At most ${ADVANCED_PATTERN_LIMIT} advanced rules are allowed.`,
    );
  }
  return {
    importedRules,
    skippedDuplicates,
    store: { rules, schemaVersion: 1 },
  };
}

function parseSiteRuleExport(
  value: unknown,
  createId: () => string,
): SiteRule[] {
  const file = asRecord(value, "The selected file is not a JSON object.");
  if (
    file.kind !== "htws-site-rules" ||
    file.formatVersion !== 1 ||
    !isSupportedProductName(file.product) ||
    !Array.isArray(file.rules)
  ) {
    throw new Error(
      `This is not a supported ${PRODUCT_NAME} site-rule export.`,
    );
  }
  if (file.rules.length > MAX_SITE_RULES) {
    throw new Error(
      `Site rule imports are limited to ${MAX_SITE_RULES} rules.`,
    );
  }
  return file.rules.map((value) => {
    const raw = asRecord(value, "An imported site rule is invalid.");
    if (
      typeof raw.enabled !== "boolean" ||
      typeof raw.pattern !== "string" ||
      !isMatchType(raw.matchType)
    ) {
      throw new Error("An imported site rule is invalid.");
    }
    const rule = createRule(raw.pattern, raw.matchType);
    return { ...rule, enabled: raw.enabled, id: createId() };
  });
}

function ruleKey(rule: Pick<SiteRule, "matchType" | "pattern">): string {
  return `${rule.matchType}\u0000${rule.pattern}`;
}

function isMatchType(value: unknown): value is SiteRuleMatchType {
  return (
    value === "domain" || value === "hostname" || value === "match-pattern"
  );
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}
