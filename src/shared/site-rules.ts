export type SiteRuleMatchType = "domain" | "hostname" | "match-pattern";

export interface SiteRule {
  enabled: boolean;
  id: string;
  matchType: SiteRuleMatchType;
  pattern: string;
}

export interface SiteRulesStore {
  rules: SiteRule[];
  schemaVersion: 1;
}

export interface CompiledSiteRules {
  advancedPatterns: RegExp[];
  domainRoot: DomainNode;
  exactHosts: ReadonlySet<string>;
}

export type SiteProtectionMode = "broader" | "exact" | "none";

interface DomainNode {
  children: Map<string, DomainNode>;
  terminal: boolean;
}

const SITE_RULES_KEY = "siteRules";
export const ADVANCED_PATTERN_LIMIT = 100;
export const EMPTY_SITE_RULES: SiteRulesStore = { rules: [], schemaVersion: 1 };

export async function loadSiteRules(): Promise<SiteRulesStore> {
  const stored = await chrome.storage.local.get(SITE_RULES_KEY);
  return sanitizeSiteRules(stored[SITE_RULES_KEY]);
}

export async function saveSiteRules(store: SiteRulesStore): Promise<void> {
  if (store.rules.length > 10_000) {
    throw new Error("At most 10,000 site rules are allowed.");
  }
  if (
    store.rules.filter((rule) => rule.matchType === "match-pattern").length >
    ADVANCED_PATTERN_LIMIT
  ) {
    throw new Error(
      `At most ${ADVANCED_PATTERN_LIMIT} advanced rules are allowed.`,
    );
  }
  const sanitized = sanitizeSiteRules(store);
  await chrome.storage.local.set({ [SITE_RULES_KEY]: sanitized });
}

export function sanitizeSiteRules(value: unknown): SiteRulesStore {
  if (typeof value !== "object" || value === null) return EMPTY_SITE_RULES;
  const candidate = value as Partial<SiteRulesStore>;
  if (!Array.isArray(candidate.rules)) return EMPTY_SITE_RULES;

  const rules = candidate.rules
    .filter((rule): rule is SiteRule => isSiteRule(rule))
    .slice(0, 10_000);
  if (
    rules.filter((rule) => rule.matchType === "match-pattern").length >
    ADVANCED_PATTERN_LIMIT
  ) {
    return EMPTY_SITE_RULES;
  }
  return { rules, schemaVersion: 1 };
}

export function compileSiteRules(store: SiteRulesStore): CompiledSiteRules {
  const exactHosts = new Set<string>();
  const domainRoot = createDomainNode();
  const advancedPatterns: RegExp[] = [];

  for (const rule of store.rules) {
    if (!rule.enabled) continue;
    if (rule.matchType === "match-pattern") {
      const compiled = compileMatchPattern(rule.pattern);
      if (compiled !== undefined) advancedPatterns.push(compiled);
      continue;
    }

    const hostname = normalizeHostname(rule.pattern);
    if (hostname === undefined) continue;
    if (rule.matchType === "hostname") exactHosts.add(hostname);
    else insertDomain(domainRoot, hostname);
  }

  return { advancedPatterns, domainRoot, exactHosts };
}

export function isSiteExcluded(
  url: string | undefined,
  rules: CompiledSiteRules,
): boolean {
  if (url === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (
    rules.exactHosts.has(hostname) ||
    matchesDomain(rules.domainRoot, hostname)
  ) {
    return true;
  }
  return rules.advancedPatterns.some((pattern) => pattern.test(parsed.href));
}

export function getSiteProtectionMode(
  url: string | undefined,
  store: SiteRulesStore,
): SiteProtectionMode {
  if (url === undefined) return "none";
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "none";
    }
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return "none";
  }

  const exact = store.rules.some(
    (rule) =>
      rule.enabled &&
      rule.matchType === "hostname" &&
      normalizeHostname(rule.pattern) === hostname,
  );
  const broaderStore: SiteRulesStore = {
    rules: store.rules.filter(
      (rule) =>
        !(
          rule.matchType === "hostname" &&
          normalizeHostname(rule.pattern) === hostname
        ),
    ),
    schemaVersion: 1,
  };
  if (isSiteExcluded(url, compileSiteRules(broaderStore))) return "broader";
  return exact ? "exact" : "none";
}

export function createRule(
  pattern: string,
  matchType: SiteRuleMatchType = "domain",
): SiteRule {
  const normalized =
    matchType === "match-pattern" ? pattern.trim() : normalizeHostname(pattern);
  if (normalized === undefined || normalized.length === 0) {
    throw new Error("Enter a valid hostname, domain, or match pattern.");
  }
  if (
    matchType === "match-pattern" &&
    compileMatchPattern(normalized) === undefined
  ) {
    throw new Error("Enter a valid Chrome-style match pattern.");
  }
  return {
    enabled: true,
    id: crypto.randomUUID(),
    matchType,
    pattern: normalized,
  };
}

function isSiteRule(value: unknown): value is SiteRule {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Partial<SiteRule>;
  if (
    typeof rule.id !== "string" ||
    typeof rule.enabled !== "boolean" ||
    typeof rule.pattern !== "string" ||
    (rule.matchType !== "hostname" &&
      rule.matchType !== "domain" &&
      rule.matchType !== "match-pattern")
  ) {
    return false;
  }
  if (rule.matchType === "match-pattern") {
    return compileMatchPattern(rule.pattern) !== undefined;
  }
  return normalizeHostname(rule.pattern) !== undefined;
}

function normalizeHostname(value: string): string | undefined {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (trimmed.length === 0 || trimmed.includes("/")) return undefined;
  try {
    const hostname = new URL(`https://${trimmed}`).hostname;
    return hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function createDomainNode(): DomainNode {
  return { children: new Map(), terminal: false };
}

function insertDomain(root: DomainNode, hostname: string): void {
  let node = root;
  for (const label of hostname.split(".").reverse()) {
    let child = node.children.get(label);
    if (child === undefined) {
      child = createDomainNode();
      node.children.set(label, child);
    }
    node = child;
  }
  node.terminal = true;
}

function matchesDomain(root: DomainNode, hostname: string): boolean {
  let node = root;
  for (const label of hostname.split(".").reverse()) {
    const child = node.children.get(label);
    if (child === undefined) return false;
    node = child;
    if (node.terminal) return true;
  }
  return node.terminal;
}

function compileMatchPattern(pattern: string): RegExp | undefined {
  const match = /^(\*|http|https):\/\/([^/]+)(\/.*)$/.exec(pattern.trim());
  if (match === null) return undefined;
  const [, scheme = "", host = "", path = ""] = match;
  if (host !== "*" && !/^(\*\.)?[a-z0-9.-]+$/i.test(host)) return undefined;

  const schemePattern = scheme === "*" ? "https?" : escapeRegex(scheme);
  const hostPattern =
    host === "*"
      ? "[^/]+"
      : host.startsWith("*.")
        ? `(?:[^./]+\\.)*${escapeRegex(host.slice(2))}`
        : escapeRegex(host);
  const pathPattern = escapeRegex(path).replaceAll("\\*", ".*");
  return new RegExp(`^${schemePattern}://${hostPattern}${pathPattern}$`, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
