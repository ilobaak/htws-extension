import "./activity.css";

import type { ActivityLogEntry } from "../background/activity-log";
import { loadSettings } from "../shared/settings";
import { downloadJson, readJsonFile } from "../shared/json-file";
import { PRODUCT_NAME } from "../shared/product";
import {
  filterActivityEntries,
  type ActivityTypeFilter,
} from "./activity-filter";

const list = get<HTMLOListElement>("activity-list");
const empty = get<HTMLParagraphElement>("empty-log");
const clear = get<HTMLButtonElement>("clear-log");
const exportButton = get<HTMLButtonElement>("export-log");
const importButton = get<HTMLButtonElement>("import-log");
const importFile = get<HTMLInputElement>("activity-import-file");
const retentionSummary = get<HTMLParagraphElement>("retention-summary");
const status = get<HTMLParagraphElement>("activity-status");
const typeFilter = get<HTMLSelectElement>("activity-type-filter");
const textFilter = get<HTMLInputElement>("activity-text-filter");
const filterResults = get<HTMLParagraphElement>("filter-results");
const dateSort = get<HTMLButtonElement>("date-sort");

let entries: ActivityLogEntry[] = [];
let refreshTimer: number | undefined;
let sortDirection: "ascending" | "descending" = "descending";

clear.addEventListener("click", () => void clearLog());
exportButton.addEventListener("click", exportLog);
importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => void importLog());
dateSort.addEventListener("click", () => {
  sortDirection = sortDirection === "ascending" ? "descending" : "ascending";
  updateSortHeader();
  renderEntries();
});
typeFilter.addEventListener("change", renderEntries);
textFilter.addEventListener("input", renderEntries);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.settings !== undefined) {
    void renderRetention();
  } else if (
    areaName === "local" &&
    changes.hibernateActivityLog !== undefined
  ) {
    scheduleRefresh();
  }
});

updateSortHeader();
void refresh();

async function refresh(message?: string): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_ACTIVITY_LOG",
  })) as ActivityLogEntry[] | { error?: string } | undefined;
  if (!Array.isArray(response)) {
    showStatus(
      response?.error ?? "The activity log could not be loaded.",
      true,
    );
    return;
  }
  entries = response;
  renderEntries();
  await renderRetention();
  if (message) showStatus(message, false);
}

function scheduleRefresh(): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 100);
}

function renderEntries(): void {
  const visible = filteredEntries();
  list.replaceChildren();
  empty.hidden = visible.length > 0;
  empty.textContent =
    entries.length === 0
      ? "No hibernation activity yet."
      : "No activity matches these filters.";
  clear.disabled = entries.length === 0;
  exportButton.disabled = entries.length === 0;
  renderHitCount(visible.length);
  for (const entry of visible) list.append(createEntry(entry));
}

function createEntry(entry: ActivityLogEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "activity-entry";
  item.dataset.action = entry.action;
  item.dataset.entryId = entry.id;
  item.dataset.outcome = entry.outcome;
  item.dataset.target = entry.target;

  const heading = document.createElement("div");
  heading.className = "entry-heading";
  const title = document.createElement("h2");
  title.textContent = `${capitalize(entry.action)} ${entry.target}${entry.windowName ? ` - ${entry.windowName}` : ""}`;
  title.title = title.textContent;
  const badges = document.createElement("div");
  badges.className = "entry-badges";
  const target = document.createElement("span");
  target.className = "target-badge";
  target.textContent = capitalize(entry.target);
  const outcome = document.createElement("span");
  outcome.className = `outcome ${entry.outcome}`;
  outcome.textContent = entry.outcome;
  badges.append(target, outcome);
  heading.append(title, badges);

  const meta = document.createElement("div");
  meta.className = "entry-meta";
  const time = document.createElement("time");
  time.dateTime = new Date(entry.occurredAt).toISOString();
  time.textContent = new Date(entry.occurredAt).toLocaleString();
  const actions = document.createElement("div");
  actions.className = "entry-actions";
  const failedHibernation =
    entry.action === "hibernate" && entry.outcome === "failure";
  if (entry.tabs.length > 0 && !failedHibernation) {
    const restore = actionButton("Restore", `Restore this ${entry.target}`);
    restore.addEventListener("click", () => void recoverEntry(entry, restore));
    actions.append(restore);
  }
  meta.append(time, actions);
  item.append(heading, meta);

  if (entry.detail) {
    const detail = document.createElement("p");
    detail.className = "entry-detail";
    detail.textContent = entry.detail;
    item.append(detail);
  }

  const urls = document.createElement("ul");
  urls.className = "entry-tabs";
  entry.tabs.forEach((tab) => {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = tab.title;
    name.title = tab.title;
    const url = document.createElement("code");
    url.textContent = tab.url;
    url.title = tab.url;
    row.append(name, url);
    urls.append(row);
  });
  item.append(urls);
  return item;
}

async function recoverEntry(
  entry: ActivityLogEntry,
  button: HTMLButtonElement,
): Promise<void> {
  const priorText = button.textContent;
  setEntryBusy(entry.id, true);
  button.textContent = "Restoring...";
  try {
    const response = (await chrome.runtime.sendMessage({
      entryId: entry.id,
      type: "RESTORE_ACTIVITY_ENTRY",
    })) as
      { error?: string; fallback?: boolean; restored?: number } | undefined;
    if (typeof response?.restored !== "number") {
      throw new Error(
        response?.error ?? "The activity entry was not restored.",
      );
    }
    await refresh(
      `${response.restored} tab${response.restored === 1 ? "" : "s"} restored${response.fallback ? " from logged URLs" : " from the hibernation archive"}.`,
    );
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "The restore action failed.",
      true,
    );
    setEntryBusy(entry.id, false);
    button.textContent = priorText;
  }
}

function setEntryBusy(entryId: string, busy: boolean): void {
  const entry = list.querySelector<HTMLElement>(
    `[data-entry-id="${CSS.escape(entryId)}"]`,
  );
  entry
    ?.querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) => (button.disabled = busy));
}

async function clearLog(): Promise<void> {
  if (!globalThis.confirm("Clear the entire hibernation activity log?")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_ACTIVITY_LOG" });
  await refresh("Activity log cleared.");
}

function exportLog(): void {
  const exportedAt = new Date();
  const payload = {
    description: `Local ${PRODUCT_NAME} activity history. Entries may include URLs that were logged but were not eligible for restoration.`,
    entries: sortedEntries().map((entry) => ({
      ...entry,
      windows: groupTabsByWindow(entry),
    })),
    exportedAt: exportedAt.toISOString(),
    formatVersion: 1,
    kind: "htws-activity",
    product: PRODUCT_NAME,
  };
  downloadJson(payload, "htws-activity");
  showStatus(`${entries.length} activity entries exported.`, false);
}

async function importLog(): Promise<void> {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file === undefined) return;
  setTransferBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({
      data: await readJsonFile(file),
      type: "IMPORT_ACTIVITY_LOG",
    })) as
      | {
          error?: string;
          imported?: number;
          retained?: number;
          skippedDuplicates?: number;
        }
      | undefined;
    if (typeof response?.imported !== "number") {
      throw new Error(
        response?.error ?? "The activity history could not be imported.",
      );
    }
    await refresh(
      `Imported ${response.imported} activit${response.imported === 1 ? "y entry" : "y entries"}.${response.skippedDuplicates ? ` ${response.skippedDuplicates} duplicate${response.skippedDuplicates === 1 ? " was" : "s were"} skipped.` : ""}`,
    );
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "The activity import failed.",
      true,
    );
  } finally {
    setTransferBusy(false);
  }
}

function setTransferBusy(busy: boolean): void {
  exportButton.disabled = busy || entries.length === 0;
  importButton.disabled = busy;
}

function groupTabsByWindow(entry: ActivityLogEntry): Array<{
  key: string;
  tabs: ActivityLogEntry["tabs"];
}> {
  const grouped = new Map<string, ActivityLogEntry["tabs"]>();
  for (const tab of entry.tabs) {
    const key = tab.windowKey ?? (entry.target === "session" ? "legacy" : "1");
    const tabs = grouped.get(key) ?? [];
    tabs.push(tab);
    grouped.set(key, tabs);
  }
  return [...grouped].map(([key, tabs]) => ({ key, tabs }));
}

function sortedEntries(source = entries): ActivityLogEntry[] {
  const direction = sortDirection === "ascending" ? 1 : -1;
  return [...source].sort(
    (left, right) => (left.occurredAt - right.occurredAt) * direction,
  );
}

function filteredEntries(): ActivityLogEntry[] {
  const type = typeFilter.value as ActivityTypeFilter;
  return sortedEntries(filterActivityEntries(entries, type, textFilter.value));
}

function renderHitCount(visibleCount: number): void {
  const filtering =
    typeFilter.value !== "all" || textFilter.value.trim() !== "";
  filterResults.textContent = filtering
    ? `${visibleCount} ${visibleCount === 1 ? "hit" : "hits"} of ${entries.length}`
    : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
}

function updateSortHeader(): void {
  dateSort.setAttribute("aria-sort", sortDirection);
  dateSort.setAttribute(
    "aria-label",
    `Date, ${sortDirection}. Activate to sort ${sortDirection === "ascending" ? "descending" : "ascending"}.`,
  );
  const marker = dateSort.querySelector<HTMLElement>(".sort-indicator");
  if (marker) marker.dataset.direction = sortDirection;
}

async function renderRetention(): Promise<void> {
  const settings = await loadSettings();
  if (settings.activityRetentionDays === 0) {
    retentionSummary.textContent = "Activity is kept until you clear it.";
    return;
  }
  const value = document.createElement("a");
  value.className = "retention-variable";
  value.href = "options.html#retention-title";
  value.textContent = String(settings.activityRetentionDays);
  value.dataset.tooltip =
    'Change this in the "Activity History" section of Settings.';
  value.setAttribute(
    "aria-label",
    `${settings.activityRetentionDays} days. Change retention in the Activity History section of Settings.`,
  );
  retentionSummary.replaceChildren(
    document.createTextNode("Activity is kept for "),
    value,
    document.createTextNode(
      ` day${settings.activityRetentionDays === 1 ? "" : "s"}.`,
    ),
  );
}

function actionButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  return button;
}

function showStatus(message: string, error: boolean): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
