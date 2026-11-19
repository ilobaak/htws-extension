import type { ActivityLogEntry } from "../background/activity-log";

export type ActivityTypeFilter =
  "all" | ActivityLogEntry["action"] | ActivityLogEntry["target"];

export function filterActivityEntries(
  entries: ActivityLogEntry[],
  type: ActivityTypeFilter,
  text: string,
): ActivityLogEntry[] {
  const query = normalizeSearch(text);
  return entries.filter(
    (entry) =>
      (type === "all" || entry.action === type || entry.target === type) &&
      (query === "" || entrySearchText(entry).includes(query)),
  );
}

function entrySearchText(entry: ActivityLogEntry): string {
  return normalizeSearch(
    [
      entry.action,
      entry.target,
      entry.outcome,
      entry.detail,
      entry.windowName,
      new Date(entry.occurredAt).toLocaleString(),
      ...entry.tabs.flatMap((tab) => [tab.title, tab.url, tab.windowKey]),
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
