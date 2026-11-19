import "./options.css";

import {
  DEFAULT_SETTINGS,
  isAutoHibernateMinutes,
  isActivityRetentionDays,
  loadSettings,
  saveSettings,
  type Settings,
} from "../shared/settings";
import {
  createRule,
  EMPTY_SITE_RULES,
  loadSiteRules,
  saveSiteRules,
  type SiteRule,
  type SiteRuleMatchType,
} from "../shared/site-rules";
import {
  createSiteRuleExport,
  mergeSiteRuleExport,
} from "../shared/site-rule-transfer";
import { downloadJson, readJsonFile } from "../shared/json-file";

const protectAudible = getElement<HTMLInputElement>("protect-audible");
const protectFields = getElement<HTMLInputElement>("protect-fields");
const protectMedia = getElement<HTMLInputElement>("protect-media");
const protectPinned = getElement<HTMLInputElement>("protect-pinned");
const autoHibernateDelay = getElement<HTMLSelectElement>(
  "auto-hibernate-delay",
);
const autoHibernateCustomControl = getElement<HTMLElement>(
  "auto-hibernate-custom-control",
);
const autoHibernateCustom = getElement<HTMLInputElement>(
  "auto-hibernate-custom",
);
const autoHibernateUnit = getElement<HTMLSelectElement>("auto-hibernate-unit");
const autoHibernateInternal = getElement<HTMLInputElement>(
  "auto-hibernate-internal",
);
const autoHibernateIncognito = getElement<HTMLInputElement>(
  "auto-hibernate-incognito",
);
const autoHibernateGroupedTabs = getElement<HTMLSelectElement>(
  "auto-hibernate-grouped-tabs",
);
const autoHibernateGroupedTabsHelp = getElement<HTMLElement>(
  "auto-hibernate-grouped-tabs-help",
);
const internalPageBehavior = getElement<HTMLSelectElement>(
  "internal-page-behavior",
);
const internalPageBehaviorHelp = getElement<HTMLElement>(
  "internal-page-behavior-help",
);
const incognitoBehavior = getElement<HTMLSelectElement>("incognito-behavior");
const incognitoBehaviorHelp = getElement<HTMLElement>(
  "incognito-behavior-help",
);
const confirmSelectedDeletion = getElement<HTMLInputElement>(
  "confirm-selected-deletion",
);
const activityRetention = getElement<HTMLSelectElement>("activity-retention");
const customRetentionControl = getElement<HTMLElement>(
  "custom-retention-control",
);
const customRetention = getElement<HTMLInputElement>(
  "activity-retention-custom",
);
const saveStatus = getElement<HTMLParagraphElement>("save-status");
const accessStatus = getElement<HTMLElement>("access-status");
const grantAccess = getElement<HTMLButtonElement>("grant-access");
const revokeAccess = getElement<HTMLButtonElement>("revoke-access");
const ruleForm = getElement<HTMLFormElement>("rule-form");
const rulePattern = getElement<HTMLInputElement>("rule-pattern");
const ruleType = getElement<HTMLSelectElement>("rule-type");
const ruleList = getElement<HTMLUListElement>("rule-list");
const ruleStatus = getElement<HTMLParagraphElement>("rule-status");
const exportSiteRules = getElement<HTMLButtonElement>("export-site-rules");
const importSiteRules = getElement<HTMLButtonElement>("import-site-rules");
const siteRuleImportFile = getElement<HTMLInputElement>(
  "site-rule-import-file",
);
const reset = getElement<HTMLButtonElement>("reset-settings");

let rules: SiteRule[] = [];
let settingsSaveTimer: number | undefined;
const retentionPresets = new Set([0, 1, 7, 30, 90, 365]);
const autoHibernatePresets = new Set([15, 30, 60, 120, 1440]);
const autoHibernateUnitMinutes = { days: 1440, hours: 60, minutes: 1 } as const;

ruleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void addRule();
});
exportSiteRules.addEventListener("click", exportRules);
importSiteRules.addEventListener("click", () => siteRuleImportFile.click());
siteRuleImportFile.addEventListener("change", () => void importRules());

grantAccess.addEventListener("click", () => void requestAllSiteAccess());
revokeAccess.addEventListener("click", () => void revokeAllSiteAccess());
reset.addEventListener("click", () => void resetAll());
for (const input of [
  autoHibernateIncognito,
  autoHibernateInternal,
  confirmSelectedDeletion,
  protectAudible,
  protectFields,
  protectMedia,
  protectPinned,
]) {
  input.addEventListener("change", () => scheduleSettingsSave());
}
autoHibernateGroupedTabs.addEventListener("change", () => {
  renderAutoHibernateGroupedTabsHelp();
  scheduleSettingsSave();
});
autoHibernateDelay.addEventListener("change", () => {
  renderCustomAutoHibernate();
  if (autoHibernateDelay.value === "custom") autoHibernateCustom.focus();
  else scheduleSettingsSave();
});
autoHibernateCustom.addEventListener("input", () => scheduleSettingsSave(400));
autoHibernateCustom.addEventListener("change", () => {
  if (Number(autoHibernateCustom.value) < 1) {
    autoHibernateCustom.value = "1";
  }
  scheduleSettingsSave();
});
autoHibernateUnit.addEventListener("change", () => {
  renderCustomAutoHibernate();
  scheduleSettingsSave();
});
activityRetention.addEventListener("change", () => {
  renderCustomRetention();
  if (activityRetention.value === "custom") customRetention.focus();
  else scheduleSettingsSave();
});
internalPageBehavior.addEventListener("change", () => {
  renderInternalPageBehaviorHelp();
  scheduleSettingsSave();
});
incognitoBehavior.addEventListener("change", () => {
  renderIncognitoBehaviorHelp();
  scheduleSettingsSave();
});
customRetention.addEventListener("input", () => scheduleSettingsSave(400));
customRetention.addEventListener("change", () => scheduleSettingsSave());

void initialize();

async function initialize(): Promise<void> {
  const [settings, store] = await Promise.all([
    loadSettings(),
    loadSiteRules(),
  ]);
  protectAudible.checked = settings.protectAudible;
  protectFields.checked = settings.protectModifiedFields;
  protectMedia.checked = settings.protectPlayingMedia;
  protectPinned.checked = settings.protectPinned;
  autoHibernateIncognito.checked = settings.autoHibernateIncludeIncognito;
  autoHibernateInternal.checked = settings.autoHibernateIncludeInternalPages;
  autoHibernateGroupedTabs.value = settings.autoHibernateGroupedTabs;
  confirmSelectedDeletion.checked = settings.confirmSelectedDeletion;
  renderAutoHibernateGroupedTabsHelp();
  if (settings.autoHibernateMinutes === null) {
    autoHibernateDelay.value = "never";
  } else if (autoHibernatePresets.has(settings.autoHibernateMinutes)) {
    autoHibernateDelay.value = String(settings.autoHibernateMinutes);
  } else {
    autoHibernateDelay.value = "custom";
    const unit = compatibleAutoHibernateUnit(
      settings.autoHibernateMinutes,
      settings.autoHibernateUnit,
    );
    autoHibernateUnit.value = unit;
    autoHibernateCustom.value = String(
      settings.autoHibernateMinutes / autoHibernateUnitMinutes[unit],
    );
  }
  renderCustomAutoHibernate();
  internalPageBehavior.value = settings.internalPageBehavior;
  incognitoBehavior.value = settings.incognitoBehavior;
  renderInternalPageBehaviorHelp();
  renderIncognitoBehaviorHelp();
  if (retentionPresets.has(settings.activityRetentionDays)) {
    activityRetention.value = String(settings.activityRetentionDays);
  } else {
    activityRetention.value = "custom";
    customRetention.value = String(settings.activityRetentionDays);
  }
  renderCustomRetention();
  rules = store.rules;
  renderRules();
  await renderAccess();
}

async function persistSettings(): Promise<void> {
  const autoHibernateMinutes = getAutoHibernateMinutes();
  if (!isAutoHibernateMinutes(autoHibernateMinutes)) {
    showStatus(
      saveStatus,
      "Enter a whole automatic-hibernation time from 1 minute to 365 days.",
      true,
    );
    autoHibernateCustom.focus();
    return;
  }
  const activityRetentionDays =
    activityRetention.value === "custom"
      ? Number(customRetention.value)
      : Number(activityRetention.value);
  if (!isActivityRetentionDays(activityRetentionDays)) {
    showStatus(
      saveStatus,
      "Enter a whole number of days from 1 to 36,500.",
      true,
    );
    customRetention.focus();
    return;
  }
  const settings: Settings = {
    activityRetentionDays,
    autoHibernateGroupedTabs:
      autoHibernateGroupedTabs.value as Settings["autoHibernateGroupedTabs"],
    autoHibernateIncludeIncognito: autoHibernateIncognito.checked,
    autoHibernateIncludeInternalPages: autoHibernateInternal.checked,
    autoHibernateMinutes,
    autoHibernateUnit: autoHibernateUnit.value as Settings["autoHibernateUnit"],
    confirmSelectedDeletion: confirmSelectedDeletion.checked,
    incognitoBehavior: incognitoBehavior.value as Settings["incognitoBehavior"],
    internalPageBehavior:
      internalPageBehavior.value as Settings["internalPageBehavior"],
    protectAudible: protectAudible.checked,
    protectModifiedFields: protectFields.checked,
    protectPinned: protectPinned.checked,
    protectPlayingMedia: protectMedia.checked,
    schemaVersion: 9,
  };
  await saveSettings(settings);
  await chrome.runtime.sendMessage({ type: "PRUNE_ACTIVITY_LOG" });
  showStatus(saveStatus, "Settings saved.");
}

function renderInternalPageBehaviorHelp(): void {
  internalPageBehaviorHelp.textContent =
    internalPageBehavior.value === "archive"
      ? "Saved locally with restore controls. Bookmark controls are hidden."
      : internalPageBehavior.value === "keep-open"
        ? "Left open and identified in the Activity log."
        : "Closed and recorded in Activity without a restorable archive entry.";
}

function renderAutoHibernateGroupedTabsHelp(): void {
  autoHibernateGroupedTabsHelp.textContent =
    autoHibernateGroupedTabs.value === "individually"
      ? "Individually applies the inactivity and protection checks to each grouped tab separately. The group name, color, collapsed state, order, and membership of grouped tabs are preserved."
      : "Waits until every tab in the group is inactive and unprotected to hibernate. The group name, color, collapsed state, order, and membership of grouped tabs are preserved.";
}

function renderIncognitoBehaviorHelp(): void {
  incognitoBehaviorHelp.textContent =
    incognitoBehavior.value === "archive"
      ? "URLs and titles persist in local extension storage shared with the regular profile. Restores open private windows."
      : incognitoBehavior.value === "keep-open"
        ? "Left open. Enable Allow in Incognito on the extension details page before private tabs can be detected."
        : "Closed and recorded in Activity without a restorable archive entry. Activity is stored locally outside the private session.";
}

function scheduleSettingsSave(delay = 120): void {
  if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer);
  settingsSaveTimer = window.setTimeout(() => {
    settingsSaveTimer = undefined;
    void persistSettings();
  }, delay);
}

function renderCustomRetention(): void {
  const custom = activityRetention.value === "custom";
  customRetentionControl.hidden = !custom;
  customRetention.disabled = !custom;
  customRetention.required = custom;
  if (custom && customRetention.value === "") customRetention.value = "90";
}

function renderCustomAutoHibernate(): void {
  const custom = autoHibernateDelay.value === "custom";
  autoHibernateCustomControl.hidden = !custom;
  autoHibernateCustom.disabled = !custom;
  autoHibernateCustom.required = custom;
  autoHibernateUnit.disabled = !custom;
  if (custom && autoHibernateCustom.value === "") {
    autoHibernateCustom.value = "60";
    autoHibernateUnit.value = "minutes";
  }
  const unit = autoHibernateUnit.value as Settings["autoHibernateUnit"];
  autoHibernateCustom.max = String(525_600 / autoHibernateUnitMinutes[unit]);
}

function getAutoHibernateMinutes(): number | null {
  if (autoHibernateDelay.value === "never") return null;
  if (autoHibernateDelay.value !== "custom") {
    return Number(autoHibernateDelay.value);
  }
  const value = Number(autoHibernateCustom.value);
  const unit = autoHibernateUnit.value as Settings["autoHibernateUnit"];
  if (!Number.isInteger(value)) return Number.NaN;
  return value * autoHibernateUnitMinutes[unit];
}

function compatibleAutoHibernateUnit(
  minutes: number,
  preferred: Settings["autoHibernateUnit"],
): Settings["autoHibernateUnit"] {
  return minutes % autoHibernateUnitMinutes[preferred] === 0
    ? preferred
    : "minutes";
}

async function addRule(): Promise<void> {
  try {
    const rule = createRule(
      rulePattern.value,
      ruleType.value as SiteRuleMatchType,
    );
    rules = [...rules, rule];
    await saveSiteRules({ rules, schemaVersion: 1 });
    rulePattern.value = "";
    renderRules();
    showStatus(ruleStatus, "Site rule added.");
  } catch (error) {
    showStatus(
      ruleStatus,
      error instanceof Error ? error.message : "The site rule is invalid.",
      true,
    );
  }
}

function renderRules(): void {
  ruleList.replaceChildren();
  if (rules.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-rule";
    empty.textContent =
      "No exclusions yet. Add sites that should always stay loaded.";
    ruleList.append(empty);
    return;
  }

  for (const rule of rules) {
    const item = document.createElement("li");
    const copy = document.createElement("span");
    const pattern = document.createElement("strong");
    const type = document.createElement("small");
    const remove = document.createElement("button");
    pattern.textContent = rule.pattern;
    type.textContent = rule.matchType.replace("-", " ");
    copy.append(pattern, type);
    remove.type = "button";
    remove.textContent = "Remove";
    remove.title = `Remove ${rule.pattern} from the never-hibernate list`;
    remove.addEventListener("click", () => void removeRule(rule.id));
    item.append(copy, remove);
    ruleList.append(item);
  }
}

async function removeRule(id: string): Promise<void> {
  rules = rules.filter((rule) => rule.id !== id);
  await saveSiteRules({ rules, schemaVersion: 1 });
  renderRules();
  showStatus(ruleStatus, "Site rule removed.");
}

function exportRules(): void {
  downloadJson(
    createSiteRuleExport({ rules, schemaVersion: 1 }),
    "htws-site-rules",
  );
  showStatus(
    ruleStatus,
    `Exported ${rules.length} site rule${rules.length === 1 ? "" : "s"}.`,
  );
}

async function importRules(): Promise<void> {
  const file = siteRuleImportFile.files?.[0];
  if (file === undefined) return;
  importSiteRules.disabled = true;
  try {
    const result = mergeSiteRuleExport(
      { rules, schemaVersion: 1 },
      await readJsonFile(file),
    );
    await saveSiteRules(result.store);
    rules = result.store.rules;
    renderRules();
    showStatus(
      ruleStatus,
      `Imported ${result.importedRules} site rule${result.importedRules === 1 ? "" : "s"}. ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? " was" : "s were"} skipped.`,
    );
  } catch (error) {
    showStatus(
      ruleStatus,
      error instanceof Error
        ? error.message
        : "The site rules could not be imported.",
      true,
    );
  } finally {
    siteRuleImportFile.value = "";
    importSiteRules.disabled = false;
  }
}

async function requestAllSiteAccess(): Promise<void> {
  const granted = await chrome.permissions.request({
    origins: ["http://*/*", "https://*/*"],
  });
  showStatus(
    saveStatus,
    granted
      ? "Full page protection enabled."
      : "Website access was not granted.",
    !granted,
  );
  await renderAccess();
}

async function revokeAllSiteAccess(): Promise<void> {
  const permissions = await chrome.permissions.getAll();
  const origins = permissions.origins ?? [];
  if (origins.length > 0) {
    await chrome.permissions.remove({ origins });
  }
  showStatus(saveStatus, "Website access removed.");
  await renderAccess();
}

async function renderAccess(): Promise<void> {
  const permissions = await chrome.permissions.getAll();
  const origins = permissions.origins ?? [];
  const allSites =
    origins.includes("<all_urls>") ||
    (origins.includes("http://*/*") && origins.includes("https://*/*"));
  accessStatus.textContent = allSites
    ? "Full protection: page media and modified fields are observable."
    : origins.length > 0
      ? "Partial protection: only selected sites are observable."
      : "Basic protection: browser-visible signals only.";
  grantAccess.hidden = allSites;
  revokeAccess.hidden = !allSites;
}

async function resetAll(): Promise<void> {
  if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer);
  settingsSaveTimer = undefined;
  await Promise.all([
    saveSettings(DEFAULT_SETTINGS),
    saveSiteRules(EMPTY_SITE_RULES),
  ]);
  await chrome.runtime.sendMessage({ type: "PRUNE_ACTIVITY_LOG" });
  rules = [];
  await initialize();
  showStatus(saveStatus, "Defaults restored.");
}

function showStatus(
  element: HTMLElement,
  message: string,
  error = false,
): void {
  element.textContent = message;
  element.classList.toggle("error", error);
  window.setTimeout(() => {
    if (element.textContent === message) element.textContent = "";
  }, 3000);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return element as T;
}
