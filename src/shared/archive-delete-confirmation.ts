import { loadSettings, saveSettings } from "./settings";

export interface ArchiveDeleteSummary {
  entry?: {
    name: string;
    type: "group" | "session" | "tab" | "window";
  };
  groups?: number;
  sessions?: number;
  tabs?: number;
  windows?: number;
}

interface DeleteDialogElements {
  confirm: HTMLButtonElement;
  dialog: HTMLDialogElement;
  heading: HTMLHeadingElement;
  message: HTMLParagraphElement;
  suppress: HTMLInputElement;
}

let dialogElements: DeleteDialogElements | undefined;

export async function confirmArchiveDeletion(
  summary: ArchiveDeleteSummary,
): Promise<boolean> {
  const settings = await loadSettings();
  if (!settings.confirmSelectedDeletion) return true;
  const result = await showArchiveDeleteDialog(summary);
  if (result.confirmed && result.suppress) {
    await saveSettings({ ...settings, confirmSelectedDeletion: false });
  }
  return result.confirmed;
}

export function renderArchiveDeleteMessage(
  message: HTMLElement,
  summary: ArchiveDeleteSummary,
): void {
  const counts = normalizedCounts(summary);
  if (summary.entry !== undefined) {
    renderSingleEntryMessage(message, summary.entry, counts);
    return;
  }

  message.replaceChildren();
  const entries = (["sessions", "windows", "groups", "tabs"] as const).filter(
    (type) => counts[type] > 0,
  );
  entries.forEach((type, index) => {
    if (index > 0) message.append(document.createTextNode(" · "));
    message.append(createCount(type, counts[type]));
  });
}

function showArchiveDeleteDialog(
  summary: ArchiveDeleteSummary,
): Promise<{ confirmed: boolean; suppress: boolean }> {
  const elements = ensureDeleteDialog();
  elements.heading.textContent = "Delete Entry?";
  elements.confirm.textContent = "Delete";
  renderArchiveDeleteMessage(elements.message, summary);
  elements.suppress.checked = false;
  elements.dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    elements.dialog.addEventListener(
      "close",
      () =>
        resolve({
          confirmed: elements.dialog.returnValue === "confirm",
          suppress: elements.suppress.checked,
        }),
      { once: true },
    );
    elements.dialog.showModal();
  });
}

function renderSingleEntryMessage(
  message: HTMLElement,
  entry: NonNullable<ArchiveDeleteSummary["entry"]>,
  counts: ReturnType<typeof normalizedCounts>,
): void {
  const nameLine = document.createElement("span");
  nameLine.className = "archive-delete-entry-name";
  const type = document.createElement("strong");
  type.className = `archive-delete-entry-type archive-delete-count-${entry.type}`;
  type.textContent = `${capitalize(entry.type)}:`;
  const name = document.createElement("span");
  name.textContent = `“${entry.name}”`;
  nameLine.append(type, document.createTextNode(" "), name);
  message.replaceChildren(nameLine);

  const detailTypes =
    entry.type === "session"
      ? (["windows", "tabs"] as const)
      : entry.type === "window" || entry.type === "group"
        ? (["tabs"] as const)
        : ([] as const);
  const populated = detailTypes.filter((detailType) => counts[detailType] > 0);
  if (populated.length === 0) return;
  const details = document.createElement("span");
  details.className = "archive-delete-entry-details";
  populated.forEach((detailType, index) => {
    if (index > 0) details.append(document.createTextNode(" · "));
    details.append(createCount(detailType, counts[detailType]));
  });
  message.append(details);
}

function createCount(
  type: "groups" | "sessions" | "tabs" | "windows",
  count: number,
): HTMLElement {
  const value = document.createElement("strong");
  value.className = `archive-delete-count archive-delete-count-${type.slice(0, -1)}`;
  value.textContent = `${count} ${capitalize(count === 1 ? type.slice(0, -1) : type)}`;
  return value;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function ensureDeleteDialog(): DeleteDialogElements {
  if (dialogElements !== undefined) return dialogElements;
  const dialog = document.createElement("dialog");
  dialog.id = "delete-selection-dialog";
  dialog.className = "delete-confirm-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  const message = document.createElement("p");
  message.id = "delete-selection-message";
  const suppressLabel = document.createElement("label");
  suppressLabel.className = "delete-confirm-suppress";
  const suppress = document.createElement("input");
  suppress.id = "delete-selection-suppress";
  suppress.type = "checkbox";
  suppressLabel.title = "This setting can be changed in the Settings page.";
  suppressLabel.append(
    suppress,
    document.createTextNode("Don't show this message again"),
  );
  const actions = document.createElement("div");
  actions.className = "delete-confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "submit";
  cancel.value = "cancel";
  cancel.textContent = "Cancel";
  const confirm = document.createElement("button");
  confirm.className = "danger-action";
  confirm.type = "submit";
  confirm.value = "confirm";
  actions.append(cancel, confirm);
  form.append(heading, message, suppressLabel, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialogElements = { confirm, dialog, heading, message, suppress };
  return dialogElements;
}

function normalizedCounts(
  summary: ArchiveDeleteSummary,
): Record<"groups" | "sessions" | "tabs" | "windows", number> {
  return {
    groups: positiveInteger(summary.groups),
    sessions: positiveInteger(summary.sessions),
    tabs: positiveInteger(summary.tabs),
    windows: positiveInteger(summary.windows),
  };
}

function positiveInteger(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}
