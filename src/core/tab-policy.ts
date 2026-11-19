import type { Settings } from "../shared/settings";
import type { CompiledSiteRules } from "../shared/site-rules";
import { isSiteExcluded } from "../shared/site-rules";
import type { PageSafetySnapshot } from "../shared/page-state";

export interface TabSnapshot {
  active: boolean;
  audible: boolean;
  id: number | undefined;
  incognito: boolean;
  index: number;
  lastAccessed: number;
  mutedForCapture: boolean;
  pinned: boolean;
  url: string | undefined;
  windowId: number;
}

export type EligibilityReason =
  | "active"
  | "audible"
  | "eligible"
  | "invalid-tab"
  | "modified-fields"
  | "observer-not-ready"
  | "playing-media"
  | "pinned"
  | "recently-active"
  | "site-excluded"
  | "tab-capture-active"
  | "unsupported-url";

type ProtectionReason = Exclude<EligibilityReason, "eligible">;

export type ProtectionLevel = "basic" | "full" | "partial";
export type CoverageWarning =
  | "frame-access-incomplete"
  | "no-top-level-host-access"
  | "observer-not-ready"
  | "selected-sites-only";

interface DecisionDetails {
  inactiveForMs: number;
  protectionLevel: ProtectionLevel;
  warnings: readonly CoverageWarning[];
}

export type EligibilityDecision =
  | (DecisionDetails & {
      decisionReason: "eligible";
      eligible: true;
    })
  | (DecisionDetails & {
      decisionReason: ProtectionReason;
      eligible: false;
    });

export interface EvaluationOptions {
  hostAccess?: "all" | "none" | "selected" | undefined;
  ignoreActive?: boolean;
  ignoreInactivity?: boolean;
  ignorePinned?: boolean;
  now?: number;
  pageSafety?: PageSafetySnapshot | undefined;
  siteRules?: CompiledSiteRules | undefined;
}

const BASIC_WARNING = ["no-top-level-host-access"] as const;

export function snapshotTab(tab: chrome.tabs.Tab): TabSnapshot {
  return {
    active: tab.active,
    audible: tab.audible ?? false,
    id: tab.id,
    incognito: tab.incognito,
    index: tab.index,
    lastAccessed:
      typeof tab.lastAccessed === "number" ? tab.lastAccessed : Date.now(),
    mutedForCapture:
      tab.mutedInfo?.muted === true && tab.mutedInfo.reason === "capture",
    pinned: tab.pinned,
    url: tab.pendingUrl ?? tab.url,
    windowId: tab.windowId,
  };
}

export function evaluateTab(
  tab: TabSnapshot,
  settings: Settings,
  options: EvaluationOptions = {},
): EligibilityDecision {
  const now = options.now ?? Date.now();
  const inactiveForMs = Math.max(0, now - tab.lastAccessed);
  const coverage = getCoverage(options);
  const reject = (decisionReason: ProtectionReason): EligibilityDecision => ({
    decisionReason,
    eligible: false,
    inactiveForMs,
    ...coverage,
  });

  if (tab.id === undefined || tab.id < 0) return reject("invalid-tab");
  if (tab.active && options.ignoreActive !== true) return reject("active");
  if (
    options.ignoreInactivity !== true &&
    settings.autoHibernateMinutes !== null &&
    inactiveForMs < settings.autoHibernateMinutes * 60_000
  ) {
    return reject("recently-active");
  }
  if (!isSupportedUrl(tab.url)) return reject("unsupported-url");
  if (
    options.siteRules !== undefined &&
    isSiteExcluded(tab.url, options.siteRules)
  ) {
    return reject("site-excluded");
  }
  if (tab.mutedForCapture) return reject("tab-capture-active");
  if (tab.pinned && settings.protectPinned && options.ignorePinned !== true) {
    return reject("pinned");
  }
  if (tab.audible && settings.protectAudible) return reject("audible");
  if (
    options.hostAccess !== undefined &&
    options.hostAccess !== "none" &&
    options.pageSafety?.observerReady !== true
  ) {
    return reject("observer-not-ready");
  }
  if (
    settings.protectPlayingMedia &&
    (options.pageSafety?.mediaPlaying === true ||
      options.pageSafety?.pictureInPicture === true ||
      options.pageSafety?.streamActive === true)
  ) {
    return reject("playing-media");
  }
  if (
    settings.protectModifiedFields &&
    options.pageSafety?.formDirty === true
  ) {
    return reject("modified-fields");
  }

  return {
    decisionReason: "eligible",
    eligible: true,
    inactiveForMs,
    ...coverage,
  };
}

function getCoverage(
  options: EvaluationOptions,
): Pick<DecisionDetails, "protectionLevel" | "warnings"> {
  if (options.hostAccess === "all") {
    if (options.pageSafety?.observerReady !== true) {
      return {
        protectionLevel: "partial",
        warnings: ["observer-not-ready"],
      };
    }
    return options.pageSafety.frameCoverageComplete
      ? { protectionLevel: "full", warnings: [] }
      : {
          protectionLevel: "partial",
          warnings: ["frame-access-incomplete"],
        };
  }
  if (options.hostAccess === "selected") {
    return {
      protectionLevel: "partial",
      warnings:
        options.pageSafety?.observerReady === true
          ? ["selected-sites-only"]
          : ["selected-sites-only", "observer-not-ready"],
    };
  }
  return { protectionLevel: "basic", warnings: BASIC_WARNING };
}

function isSupportedUrl(url: string | undefined): boolean {
  if (url === undefined) return false;

  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
