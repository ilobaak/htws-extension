export type ActivityRetentionDays = number;
export type AutoHibernateMinutes = number | null;
export type AutoHibernateGroupedTabs = "individually" | "together";
export type AutoHibernateUnit = "minutes" | "hours" | "days";
export type TabBehavior = "archive" | "close-and-log" | "keep-open";
export type InternalPageBehavior = TabBehavior;
export type IncognitoBehavior = TabBehavior;

export interface Settings {
  activityRetentionDays: ActivityRetentionDays;
  autoHibernateGroupedTabs: AutoHibernateGroupedTabs;
  autoHibernateIncludeIncognito: boolean;
  autoHibernateIncludeInternalPages: boolean;
  autoHibernateMinutes: AutoHibernateMinutes;
  autoHibernateUnit: AutoHibernateUnit;
  confirmSelectedDeletion: boolean;
  incognitoBehavior: IncognitoBehavior;
  internalPageBehavior: InternalPageBehavior;
  protectAudible: boolean;
  protectModifiedFields: boolean;
  protectPinned: boolean;
  protectPlayingMedia: boolean;
  schemaVersion: 9;
}

export const DEFAULT_SETTINGS: Settings = {
  activityRetentionDays: 90,
  autoHibernateGroupedTabs: "together",
  autoHibernateIncludeIncognito: false,
  autoHibernateIncludeInternalPages: false,
  autoHibernateMinutes: 60,
  autoHibernateUnit: "minutes",
  confirmSelectedDeletion: true,
  incognitoBehavior: "keep-open",
  internalPageBehavior: "archive",
  protectAudible: true,
  protectModifiedFields: true,
  protectPinned: true,
  protectPlayingMedia: true,
  schemaVersion: 9,
};

const SETTINGS_KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const candidate = stored[SETTINGS_KEY] as Partial<Settings> | undefined;

  return sanitizeSettings(candidate);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: sanitizeSettings(settings) });
}

export function sanitizeSettings(value: unknown): Settings {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Partial<Settings>)
      : {};
  return {
    activityRetentionDays: retentionOrDefault(
      candidate.activityRetentionDays,
      DEFAULT_SETTINGS.activityRetentionDays,
    ),
    autoHibernateGroupedTabs:
      candidate.autoHibernateGroupedTabs === "individually" ||
      candidate.autoHibernateGroupedTabs === "together"
        ? candidate.autoHibernateGroupedTabs
        : DEFAULT_SETTINGS.autoHibernateGroupedTabs,
    autoHibernateIncludeIncognito: booleanOrDefault(
      candidate.autoHibernateIncludeIncognito,
      DEFAULT_SETTINGS.autoHibernateIncludeIncognito,
    ),
    autoHibernateIncludeInternalPages: booleanOrDefault(
      candidate.autoHibernateIncludeInternalPages,
      DEFAULT_SETTINGS.autoHibernateIncludeInternalPages,
    ),
    autoHibernateMinutes: autoHibernateMinutesOrDefault(
      candidate.autoHibernateMinutes,
      DEFAULT_SETTINGS.autoHibernateMinutes,
    ),
    autoHibernateUnit: autoHibernateUnitOrDefault(
      candidate.autoHibernateUnit,
      DEFAULT_SETTINGS.autoHibernateUnit,
    ),
    confirmSelectedDeletion: booleanOrDefault(
      candidate.confirmSelectedDeletion,
      DEFAULT_SETTINGS.confirmSelectedDeletion,
    ),
    incognitoBehavior: behaviorOrDefault(
      candidate.incognitoBehavior,
      DEFAULT_SETTINGS.incognitoBehavior,
    ),
    internalPageBehavior: behaviorOrDefault(
      candidate.internalPageBehavior,
      DEFAULT_SETTINGS.internalPageBehavior,
    ),
    protectAudible: booleanOrDefault(
      candidate.protectAudible,
      DEFAULT_SETTINGS.protectAudible,
    ),
    protectModifiedFields: booleanOrDefault(
      candidate.protectModifiedFields,
      DEFAULT_SETTINGS.protectModifiedFields,
    ),
    protectPinned: booleanOrDefault(
      candidate.protectPinned,
      DEFAULT_SETTINGS.protectPinned,
    ),
    protectPlayingMedia: booleanOrDefault(
      candidate.protectPlayingMedia,
      DEFAULT_SETTINGS.protectPlayingMedia,
    ),
    schemaVersion: 9,
  };
}

function autoHibernateMinutesOrDefault(
  value: unknown,
  fallback: AutoHibernateMinutes,
): AutoHibernateMinutes {
  return isAutoHibernateMinutes(value) ? value : fallback;
}

function autoHibernateUnitOrDefault(
  value: unknown,
  fallback: AutoHibernateUnit,
): AutoHibernateUnit {
  return value === "minutes" || value === "hours" || value === "days"
    ? value
    : fallback;
}

export function isAutoHibernateMinutes(
  value: unknown,
): value is AutoHibernateMinutes {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 525_600)
  );
}

function behaviorOrDefault(value: unknown, fallback: TabBehavior): TabBehavior {
  return value === "archive" ||
    value === "close-and-log" ||
    value === "keep-open"
    ? value
    : fallback;
}

function retentionOrDefault(
  value: unknown,
  fallback: ActivityRetentionDays,
): ActivityRetentionDays {
  return isActivityRetentionDays(value) ? value : fallback;
}

export function isActivityRetentionDays(
  value: unknown,
): value is ActivityRetentionDays {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 36_500
  );
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
