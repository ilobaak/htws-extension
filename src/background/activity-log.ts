import { loadSettings, type ActivityRetentionDays } from "../shared/settings";
import { isSupportedProductName, PRODUCT_NAME } from "../shared/product";

const LOG_KEY = "hibernateActivityLog";
const MAX_ENTRIES = 1000;
let writeQueue: Promise<void> = Promise.resolve();

export interface ActivityLogTab {
  title: string;
  url: string;
  windowKey?: string;
}
export interface ActivityLogEntry {
  action: "hibernate" | "restore";
  archiveId?: string;
  detail?: string;
  id: string;
  occurredAt: number;
  outcome: "failure" | "partial" | "success";
  tabs: ActivityLogTab[];
  target: "session" | "tab" | "window";
  windowName?: string;
}

export interface ActivityImportResult {
  imported: number;
  retained: number;
  skippedDuplicates: number;
}

export async function appendActivityLog(
  entry: Omit<ActivityLogEntry, "id" | "occurredAt">,
): Promise<void> {
  const write = writeQueue.then(async () => {
    const entries = await getActivityLog();
    entries.unshift({
      ...entry,
      id: crypto.randomUUID(),
      occurredAt: Date.now(),
    });
    await chrome.storage.local.set({
      [LOG_KEY]: entries.slice(0, MAX_ENTRIES),
    });
  });
  writeQueue = write.catch(() => undefined);
  await write;
}

export async function getActivityLog(): Promise<ActivityLogEntry[]> {
  const [stored, settings] = await Promise.all([
    chrome.storage.local.get(LOG_KEY),
    loadSettings(),
  ]);
  const entries = Array.isArray(stored[LOG_KEY])
    ? (stored[LOG_KEY] as ActivityLogEntry[])
    : [];
  const retained = pruneActivityEntries(
    entries,
    settings.activityRetentionDays,
    Date.now(),
  );
  if (retained.length !== entries.length) {
    await chrome.storage.local.set({ [LOG_KEY]: retained });
  }
  return retained;
}

export async function clearActivityLog(): Promise<{ ok: true }> {
  await writeQueue;
  await chrome.storage.local.remove(LOG_KEY);
  return { ok: true };
}

export async function importActivityLog(
  value: unknown,
): Promise<ActivityImportResult> {
  const imported = parseActivityExport(value);
  const write = writeQueue.then(async () => {
    const existing = await getActivityLog();
    const existingIds = new Set(existing.map((entry) => entry.id));
    const additions = imported.filter((entry) => !existingIds.has(entry.id));
    const merged = [...existing, ...additions]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, MAX_ENTRIES);
    await chrome.storage.local.set({ [LOG_KEY]: merged });
    const retained = await getActivityLog();
    return {
      imported: additions.length,
      retained: retained.length,
      skippedDuplicates: imported.length - additions.length,
    };
  });
  writeQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export async function pruneActivityLog(): Promise<{ retained: number }> {
  await writeQueue;
  const entries = await getActivityLog();
  return { retained: entries.length };
}

export function pruneActivityEntries(
  entries: ActivityLogEntry[],
  retentionDays: ActivityRetentionDays,
  now: number,
): ActivityLogEntry[] {
  if (retentionDays === 0) return entries;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => entry.occurredAt >= cutoff);
}

function parseActivityExport(value: unknown): ActivityLogEntry[] {
  const file = asRecord(value, "The selected file is not a JSON object.");
  if (
    file.kind !== "htws-activity" ||
    !isSupportedProductName(file.product) ||
    file.formatVersion !== 1 ||
    !Array.isArray(file.entries)
  ) {
    throw new Error(`This is not a supported ${PRODUCT_NAME} activity export.`);
  }
  if (file.entries.length > 5_000) {
    throw new Error("Activity imports are limited to 5,000 entries.");
  }
  return file.entries.map(parseActivityEntry);
}

function parseActivityEntry(value: unknown): ActivityLogEntry {
  const raw = asRecord(value, "An imported activity entry is invalid.");
  if (raw.action !== "hibernate" && raw.action !== "restore") {
    throw new Error("An imported activity entry has an invalid action.");
  }
  if (
    raw.target !== "tab" &&
    raw.target !== "window" &&
    raw.target !== "session"
  ) {
    throw new Error("An imported activity entry has an invalid target.");
  }
  if (
    raw.outcome !== "failure" &&
    raw.outcome !== "partial" &&
    raw.outcome !== "success"
  ) {
    throw new Error("An imported activity entry has an invalid outcome.");
  }
  if (
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    raw.id.length > 200
  ) {
    throw new Error("An imported activity entry has an invalid ID.");
  }
  if (
    typeof raw.occurredAt !== "number" ||
    !Number.isFinite(raw.occurredAt) ||
    raw.occurredAt < 0 ||
    raw.occurredAt > Date.now() + 24 * 60 * 60 * 1000
  ) {
    throw new Error("An imported activity entry has an invalid date.");
  }
  if (!Array.isArray(raw.tabs) || raw.tabs.length > 10_000) {
    throw new Error("An imported activity entry has an invalid tab list.");
  }
  const archiveId = optionalText(raw.archiveId, 200);
  const detail = optionalText(raw.detail, 2_000);
  const windowName = optionalText(raw.windowName, 500);
  return {
    action: raw.action,
    ...(archiveId === undefined ? {} : { archiveId }),
    ...(detail === undefined ? {} : { detail }),
    id: raw.id,
    occurredAt: raw.occurredAt,
    outcome: raw.outcome,
    tabs: raw.tabs.map(parseActivityTab),
    target: raw.target,
    ...(windowName === undefined ? {} : { windowName }),
  };
}

function parseActivityTab(value: unknown): ActivityLogTab {
  const raw = asRecord(value, "An imported activity tab is invalid.");
  if (typeof raw.url !== "string" || !isActivityUrl(raw.url)) {
    throw new Error("An imported activity tab has an invalid URL.");
  }
  const title = optionalText(raw.title, 500);
  const windowKey = optionalText(raw.windowKey, 200);
  if (title === undefined) {
    throw new Error("An imported activity tab needs a title.");
  }
  return {
    title,
    url: raw.url,
    ...(windowKey === undefined ? {} : { windowKey }),
  };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? undefined : normalized.slice(0, maxLength);
}

function isActivityUrl(value: string): boolean {
  if (value.length > 10_000) return false;
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return false;
  }
}
