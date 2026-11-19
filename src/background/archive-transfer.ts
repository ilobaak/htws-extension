import type {
  ArchivedGroupMetadata,
  ArchivedSessionMetadata,
  ArchivedTabMetadata,
  ArchivedWindowMetadata,
  ArchiveStore,
} from "./hibernate-archive";
import { isArchiveableUrl } from "../core/tab-url";
import { normalizeGroupColor } from "../shared/group-colors";
import { isSupportedProductName, PRODUCT_NAME } from "../shared/product";

const MAX_IMPORT_TABS = 10_000;

interface PortableGroup {
  archivePinned?: true;
  collapsed: boolean;
  color: ArchivedGroupMetadata["color"];
  key: string;
  title?: string;
}

interface PortableTab {
  active: boolean;
  archivePinned?: true;
  createdAt: string;
  group?: PortableGroup;
  pinned: boolean;
  position: number;
  private?: true;
  title: string;
  type: "tab";
  url: string;
}

interface PortableWindow {
  archivePinned?: true;
  createdAt: string;
  kind?: "group";
  name?: string;
  private?: true;
  tabs: PortableTab[];
  type: "window";
}

interface PortableSession {
  archivePinned?: true;
  createdAt: string;
  name?: string;
  type: "session";
  windows: PortableWindow[];
}

type PortableArchiveEntry = PortableSession | PortableTab | PortableWindow;

export interface ArchiveExportFile {
  archive: {
    entries: PortableArchiveEntry[];
    summary: { sessions: number; tabs: number; windows: number };
  };
  description: string;
  exportedAt: string;
  formatNotes: {
    groups: string;
    hierarchy: string;
    ordering: string;
    privacy: string;
    timestamps: string;
  };
  formatVersion: 2;
  kind: "htws-archive";
  product: typeof PRODUCT_NAME;
}

export interface ArchiveImportResult {
  importedSessions: number;
  importedTabs: number;
  importedWindows: number;
  skippedDuplicates: number;
}

export function createArchiveExport(store: ArchiveStore): ArchiveExportFile {
  const entries = createPortableEntries(store);
  const windows = entries.reduce(
    (total, entry) =>
      total +
      (entry.type === "session"
        ? entry.windows.length
        : entry.type === "window"
          ? 1
          : 0),
    0,
  );
  const tabs = entries.reduce(
    (total, entry) =>
      total +
      (entry.type === "session"
        ? entry.windows.reduce(
            (windowTotal, window) => windowTotal + window.tabs.length,
            0,
          )
        : entry.type === "window"
          ? entry.tabs.length
          : 1),
    0,
  );
  return {
    archive: {
      entries,
      summary: {
        sessions: entries.filter((entry) => entry.type === "session").length,
        tabs,
        windows,
      },
    },
    description: `Portable ${PRODUCT_NAME} archive. It contains no browser bookmark IDs or extension-local record IDs.`,
    exportedAt: new Date().toISOString(),
    formatNotes: {
      groups:
        "Tabs with the same group.key inside one window belong to the same browser tab group; the accompanying title, color, and collapsed fields describe that group.",
      hierarchy:
        "archive.entries is the top-level display order. A session contains windows, a window contains tabs, and a top-level tab stands alone.",
      ordering:
        "Array order is authoritative. Each tab position also records its original zero-based tab-strip position.",
      privacy:
        "private=true identifies an incognito/private tab or window. Private and regular tabs are never mixed in one window.",
      timestamps:
        "All createdAt and exportedAt values are ISO 8601 UTC strings.",
    },
    formatVersion: 2,
    kind: "htws-archive",
    product: PRODUCT_NAME,
  };
}

export function mergeArchiveExport(
  current: ArchiveStore,
  value: unknown,
  createId: (prefix: "entry" | "session" | "tab") => string,
): {
  changed: boolean;
  store: ArchiveStore;
  summary: ArchiveImportResult;
} {
  const imported = parseArchiveExport(value);
  const store = cloneStore(current);
  const currentOrder = orderedTopLevelKeys(store);
  const remappedTopLevelKeys = new Map<string, string>();
  const summary: ArchiveImportResult = {
    importedSessions: 0,
    importedTabs: 0,
    importedWindows: 0,
    skippedDuplicates: 0,
  };
  const importedSessionWindowIds = new Set(
    Object.values(imported.sessions).flatMap((session) => session.windowIds),
  );
  const existingTopLevel = new Set(
    Object.entries(store.windows)
      .filter(([, window]) => window.sessionId === undefined)
      .map(([, window]) => windowFingerprint(window)),
  );

  for (const [windowId, window] of Object.entries(imported.windows)) {
    if (importedSessionWindowIds.has(windowId)) continue;
    const fingerprint = windowFingerprint(window);
    if (existingTopLevel.has(fingerprint)) {
      summary.skippedDuplicates += 1;
      continue;
    }
    const remapped = remapWindow(window, undefined, createId);
    store.windows[remapped.id] = remapped.window;
    const importedKey = topLevelWindowKey(windowId, window);
    const remappedKey = topLevelWindowKey(remapped.id, remapped.window);
    remappedTopLevelKeys.set(importedKey, remappedKey);
    existingTopLevel.add(fingerprint);
    summary.importedWindows += 1;
    summary.importedTabs += Object.keys(remapped.window.tabs).length;
  }

  const existingSessions = new Set(
    Object.values(store.sessions).map((session) =>
      sessionFingerprint(session, store.windows),
    ),
  );
  for (const [importedSessionId, session] of Object.entries(
    imported.sessions,
  )) {
    const fingerprint = sessionFingerprint(session, imported.windows);
    if (existingSessions.has(fingerprint)) {
      summary.skippedDuplicates += 1;
      continue;
    }
    const sessionId = createId("session");
    const windowIds: string[] = [];
    for (const importedWindowId of session.windowIds) {
      const window = imported.windows[importedWindowId]!;
      const remapped = remapWindow(window, sessionId, createId);
      store.windows[remapped.id] = remapped.window;
      windowIds.push(remapped.id);
      summary.importedWindows += 1;
      summary.importedTabs += Object.keys(remapped.window.tabs).length;
    }
    store.sessions[sessionId] = {
      ...(session.archivePinned ? { archivePinned: true as const } : {}),
      createdAt: session.createdAt,
      ...(session.name === undefined ? {} : { name: session.name }),
      windowIds,
    };
    remappedTopLevelKeys.set(
      `session:${importedSessionId}`,
      `session:${sessionId}`,
    );
    existingSessions.add(fingerprint);
    summary.importedSessions += 1;
  }

  const importedOrder = orderedTopLevelKeys(imported).flatMap((key) => {
    const remapped = remappedTopLevelKeys.get(key);
    return remapped === undefined ? [] : [remapped];
  });
  const remainingImported = [...remappedTopLevelKeys.values()].filter(
    (key) => !importedOrder.includes(key),
  );
  store.topLevelOrder = [
    ...currentOrder,
    ...importedOrder,
    ...remainingImported,
  ];

  return {
    changed:
      summary.importedSessions > 0 ||
      summary.importedWindows > 0 ||
      summary.importedTabs > 0,
    store,
    summary,
  };
}

function parseArchiveExport(value: unknown): ArchiveStore {
  const file = asRecord(value, "The selected file is not a JSON object.");
  if (file.kind !== "htws-archive" || !isSupportedProductName(file.product)) {
    throw new Error(`This is not a supported ${PRODUCT_NAME} archive export.`);
  }
  if (file.formatVersion === 2) return parseVersion2Archive(file.archive);
  throw new Error(
    `Archive format version ${String(file.formatVersion)} is not supported by this version of ${PRODUCT_NAME}.`,
  );
}

function parseVersion2Archive(value: unknown): ArchiveStore {
  const archive = asRecord(value, "The archive payload is missing.");
  if (!Array.isArray(archive.entries)) {
    throw new Error("The archive entry list is missing.");
  }
  const sessions: Record<string, ArchivedSessionMetadata> = {};
  const windows: Record<string, ArchivedWindowMetadata> = {};
  const topLevelOrder: string[] = [];
  let nextSession = 0;
  let nextTab = 0;
  let nextWindow = 0;
  let tabCount = 0;

  const addWindow = (
    value: unknown,
    sessionId?: string,
  ): { id: string; metadata: ArchivedWindowMetadata } => {
    const id = `import-v2-window-${(nextWindow += 1)}`;
    const metadata = parsePortableWindow(
      value,
      () => `import-v2-tab-${(nextTab += 1)}`,
      sessionId,
    );
    tabCount += Object.keys(metadata.tabs).length;
    if (tabCount > MAX_IMPORT_TABS) {
      throw new Error(
        `Archive imports are limited to ${MAX_IMPORT_TABS} tabs.`,
      );
    }
    windows[id] = metadata;
    return { id, metadata };
  };

  for (const value of archive.entries) {
    const raw = asRecord(value, "An imported archive entry is invalid.");
    if (raw.type === "tab") {
      const tabId = `import-v2-tab-${(nextTab += 1)}`;
      const parsed = parsePortableTab(
        raw,
        tabId,
        optionalBoolean(raw.private, "tab private state"),
      );
      tabCount += 1;
      if (tabCount > MAX_IMPORT_TABS) {
        throw new Error(
          `Archive imports are limited to ${MAX_IMPORT_TABS} tabs.`,
        );
      }
      const windowId = `import-v2-window-${(nextWindow += 1)}`;
      windows[windowId] = {
        ...(parsed.tab.archivePinned ? { archivePinned: true as const } : {}),
        createdAt: parsed.tab.createdAt,
        entryType: "tab",
        groups:
          parsed.group === undefined
            ? {}
            : { [parsed.group.key]: parsed.group.metadata },
        ...(parsed.tab.incognito ? { incognito: true as const } : {}),
        sourceWindowId: 0,
        tabs: { [tabId]: parsed.tab },
      };
      topLevelOrder.push(`tab:${tabId}`);
      continue;
    }
    if (raw.type === "window") {
      const added = addWindow(raw);
      topLevelOrder.push(`window:${added.id}`);
      continue;
    }
    if (raw.type === "session") {
      if (!Array.isArray(raw.windows) || raw.windows.length === 0) {
        throw new Error("Imported sessions must contain at least one window.");
      }
      const sessionId = `import-v2-session-${(nextSession += 1)}`;
      const windowIds = raw.windows.map(
        (window) => addWindow(window, sessionId).id,
      );
      sessions[sessionId] = {
        ...(optionalBoolean(raw.archivePinned, "session archive pin state")
          ? { archivePinned: true as const }
          : {}),
        createdAt: validIsoTimestamp(raw.createdAt, "session"),
        ...optionalName(raw.name),
        windowIds,
      };
      topLevelOrder.push(`session:${sessionId}`);
      continue;
    }
    throw new Error("An imported archive entry has an invalid type.");
  }

  return { schemaVersion: 4, sessions, topLevelOrder, windows };
}

function parsePortableWindow(
  value: unknown,
  createTabId: () => string,
  sessionId?: string,
): ArchivedWindowMetadata {
  const raw = asRecord(value, "An imported window is invalid.");
  if (raw.type !== "window" || !Array.isArray(raw.tabs)) {
    throw new Error("An imported window has no tab list.");
  }
  if (raw.tabs.length === 0) {
    throw new Error("Imported windows must contain at least one tab.");
  }
  const incognito = optionalBoolean(raw.private, "window private state");
  const tabs: Record<string, ArchivedTabMetadata> = {};
  const groups: Record<string, ArchivedGroupMetadata> = {};
  const positions = new Set<number>();
  let previousPosition = -1;
  let activeTabs = 0;
  for (const value of raw.tabs) {
    const tabId = createTabId();
    const parsed = parsePortableTab(value, tabId, incognito);
    if (positions.has(parsed.tab.index)) {
      throw new Error("An imported window has duplicate tab positions.");
    }
    positions.add(parsed.tab.index);
    if (parsed.tab.index <= previousPosition) {
      throw new Error(
        "Imported window tabs must be ordered by increasing position.",
      );
    }
    previousPosition = parsed.tab.index;
    if (parsed.tab.active) activeTabs += 1;
    if (activeTabs > 1) {
      throw new Error("An imported window has more than one active tab.");
    }
    if (parsed.group !== undefined) {
      const existing = groups[parsed.group.key];
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(parsed.group.metadata)
      ) {
        throw new Error(
          "Tabs in the same imported group have conflicting group metadata.",
        );
      }
      groups[parsed.group.key] = parsed.group.metadata;
    }
    tabs[tabId] = parsed.tab;
  }
  return {
    ...(optionalBoolean(raw.archivePinned, "window archive pin state")
      ? { archivePinned: true as const }
      : {}),
    createdAt: validIsoTimestamp(raw.createdAt, "window"),
    entryType:
      raw.kind === "group" && sessionId === undefined ? "group" : "window",
    groups,
    ...(incognito ? { incognito: true as const } : {}),
    ...optionalName(raw.name),
    ...(sessionId === undefined ? {} : { sessionId }),
    sourceWindowId: 0,
    tabs,
  };
}

function parsePortableTab(
  value: unknown,
  tabId: string,
  incognito: boolean,
): {
  group?: { key: string; metadata: ArchivedGroupMetadata };
  tab: ArchivedTabMetadata;
} {
  const raw = asRecord(value, "An imported tab is invalid.");
  if (raw.type !== "tab") {
    throw new Error("An imported tab has an invalid type.");
  }
  if (optionalBoolean(raw.private, "tab private state") !== incognito) {
    throw new Error("Imported windows cannot mix private and regular tabs.");
  }
  if (typeof raw.url !== "string" || !isArchiveableUrl(raw.url)) {
    throw new Error(
      "Imported tabs must use HTTP, HTTPS, chrome, or brave URLs.",
    );
  }
  const position = raw.position;
  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0
  ) {
    throw new Error("An imported tab has an invalid position.");
  }
  const pinned = requiredBoolean(raw.pinned, "tab pinned state");
  const group = parsePortableGroup(raw.group);
  if (pinned && group !== undefined) {
    throw new Error("An imported pinned tab cannot belong to a tab group.");
  }
  return {
    ...(group === undefined ? {} : { group }),
    tab: {
      active: requiredBoolean(raw.active, "tab active state"),
      ...(optionalBoolean(raw.archivePinned, "tab archive pin state")
        ? { archivePinned: true as const }
        : {}),
      bookmarkId: tabId,
      createdAt: validIsoTimestamp(raw.createdAt, "tab"),
      ...(group === undefined ? {} : { groupKey: group.key }),
      ...(incognito ? { incognito: true as const } : {}),
      index: position,
      pinned,
      title: requiredText(raw.title, 500, "Imported tabs need a title."),
      url: raw.url,
    },
  };
}

function parsePortableGroup(
  value: unknown,
): { key: string; metadata: ArchivedGroupMetadata } | undefined {
  if (value === undefined) return undefined;
  const raw = asRecord(value, "An imported tab group is invalid.");
  if (
    typeof raw.key !== "string" ||
    !isSafeId(raw.key) ||
    typeof raw.color !== "string"
  ) {
    throw new Error("An imported tab group is invalid.");
  }
  const title = optionalText(raw.title, 500);
  return {
    key: raw.key,
    metadata: {
      ...(optionalBoolean(raw.archivePinned, "group archive pin state")
        ? { archivePinned: true as const }
        : {}),
      collapsed: requiredBoolean(raw.collapsed, "tab group collapsed state"),
      color: normalizeGroupColor(raw.color),
      ...(title === undefined ? {} : { title }),
    },
  };
}

function remapWindow(
  source: ArchivedWindowMetadata,
  sessionId: string | undefined,
  createId: (prefix: "entry" | "session" | "tab") => string,
): { id: string; window: ArchivedWindowMetadata } {
  const tabs: Record<string, ArchivedTabMetadata> = {};
  for (const tab of Object.values(source.tabs)) {
    const tabId = createId("tab");
    tabs[tabId] = { ...tab, bookmarkId: tabId };
  }
  return {
    id: createId("entry"),
    window: {
      ...(source.archivePinned ? { archivePinned: true as const } : {}),
      createdAt: source.createdAt,
      ...(source.entryType === undefined
        ? {}
        : { entryType: source.entryType }),
      groups: structuredClone(source.groups),
      ...(source.incognito ? { incognito: true as const } : {}),
      ...(source.name === undefined ? {} : { name: source.name }),
      ...(sessionId === undefined ? {} : { sessionId }),
      sourceWindowId: source.sourceWindowId,
      tabs,
    },
  };
}

function createPortableEntries(store: ArchiveStore): PortableArchiveEntry[] {
  return orderedTopLevelKeys(store).map((key) => {
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (type === "session") {
      const session = store.sessions[id];
      if (session === undefined) {
        throw new Error("The local archive contains a missing session.");
      }
      return {
        ...(session.archivePinned ? { archivePinned: true as const } : {}),
        createdAt: timestampToIso(session.createdAt, "session"),
        ...(session.name === undefined ? {} : { name: session.name }),
        type: "session",
        windows: session.windowIds.map((windowId) => {
          const window = store.windows[windowId];
          if (window === undefined) {
            throw new Error(
              "The local archive contains a session with a missing window.",
            );
          }
          return createPortableWindow(window);
        }),
      } satisfies PortableSession;
    }
    if (type === "window") {
      const window = store.windows[id];
      if (window === undefined) {
        throw new Error("The local archive contains a missing window.");
      }
      return createPortableWindow(window);
    }
    if (type === "tab") {
      const found = findTabById(store, id);
      if (found === undefined) {
        throw new Error("The local archive contains a missing tab.");
      }
      return createPortableTab(
        found.tab,
        found.window,
        found.tab.groupKey === undefined ? undefined : "group-1",
      );
    }
    throw new Error("The local archive contains an invalid entry order.");
  });
}

function createPortableWindow(window: ArchivedWindowMetadata): PortableWindow {
  const portableGroupKeys = new Map<string, string>();
  const tabs = Object.values(window.tabs)
    .sort((left, right) => left.index - right.index)
    .map((tab) => {
      let portableGroupKey: string | undefined;
      if (tab.groupKey !== undefined) {
        portableGroupKey = portableGroupKeys.get(tab.groupKey);
        if (portableGroupKey === undefined) {
          portableGroupKey = `group-${portableGroupKeys.size + 1}`;
          portableGroupKeys.set(tab.groupKey, portableGroupKey);
        }
      }
      return createPortableTab(tab, window, portableGroupKey);
    });
  if (tabs.length === 0) {
    throw new Error("The local archive contains an empty window.");
  }
  return {
    ...(window.archivePinned ? { archivePinned: true as const } : {}),
    createdAt: timestampToIso(window.createdAt, "window"),
    ...(window.entryType === "group" ? { kind: "group" as const } : {}),
    ...(window.name === undefined ? {} : { name: window.name }),
    ...(window.incognito ? { private: true as const } : {}),
    tabs,
    type: "window",
  };
}

function createPortableTab(
  tab: ArchivedTabMetadata,
  window: ArchivedWindowMetadata,
  portableGroupKey: string | undefined,
): PortableTab {
  const group =
    tab.groupKey === undefined ? undefined : window.groups[tab.groupKey];
  if (tab.groupKey !== undefined && group === undefined) {
    throw new Error("The local archive contains a tab with a missing group.");
  }
  return {
    active: tab.active,
    ...(tab.archivePinned ? { archivePinned: true as const } : {}),
    createdAt: timestampToIso(tab.createdAt, "tab"),
    ...(group === undefined || portableGroupKey === undefined
      ? {}
      : {
          group: {
            ...(group.archivePinned ? { archivePinned: true as const } : {}),
            collapsed: group.collapsed,
            color: group.color,
            key: portableGroupKey,
            ...(group.title === undefined ? {} : { title: group.title }),
          },
        }),
    pinned: tab.pinned,
    position: tab.index,
    ...(window.incognito ? { private: true as const } : {}),
    title: tab.title,
    type: "tab",
    url: tab.url,
  };
}

function orderedTopLevelKeys(store: ArchiveStore): string[] {
  const candidates = new Map<string, number>();
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    candidates.set(`session:${sessionId}`, session.createdAt);
  }
  for (const [windowId, window] of Object.entries(store.windows)) {
    if (window.sessionId !== undefined) continue;
    const key = topLevelWindowKey(windowId, window);
    candidates.set(key, window.createdAt);
  }
  const ordered: string[] = [];
  for (const key of store.topLevelOrder ?? []) {
    if (!candidates.delete(key) || ordered.includes(key)) continue;
    ordered.push(key);
  }
  ordered.push(
    ...[...candidates.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([key]) => key),
  );
  return ordered;
}

function topLevelWindowKey(
  windowId: string,
  window: ArchivedWindowMetadata,
): string {
  if (window.entryType !== "tab") return `window:${windowId}`;
  const tabId = Object.keys(window.tabs)[0];
  if (tabId === undefined) {
    throw new Error("The archive contains an empty standalone tab entry.");
  }
  return `tab:${tabId}`;
}

function findTabById(
  store: ArchiveStore,
  tabId: string,
): { tab: ArchivedTabMetadata; window: ArchivedWindowMetadata } | undefined {
  for (const window of Object.values(store.windows)) {
    const tab = window.tabs[tabId];
    if (tab !== undefined) return { tab, window };
  }
  return undefined;
}

function windowFingerprint(window: ArchivedWindowMetadata): string {
  const groupKeys = new Map<string, string>();
  return JSON.stringify({
    archivePinned: window.archivePinned === true,
    createdAt: window.createdAt,
    entryType: window.entryType,
    incognito: window.incognito === true,
    name: window.name,
    tabs: Object.values(window.tabs)
      .sort((left, right) => left.index - right.index)
      .map(({ bookmarkId: _bookmarkId, savedBookmarkId: _saved, ...tab }) => {
        const sourceGroupKey = tab.groupKey;
        delete tab.groupKey;
        if (sourceGroupKey === undefined) return tab;
        let groupKey = groupKeys.get(sourceGroupKey);
        if (groupKey === undefined) {
          groupKey = `group-${groupKeys.size + 1}`;
          groupKeys.set(sourceGroupKey, groupKey);
        }
        return {
          ...tab,
          group: { key: groupKey, metadata: window.groups[sourceGroupKey] },
        };
      }),
  });
}

function sessionFingerprint(
  session: ArchivedSessionMetadata,
  windows: Record<string, ArchivedWindowMetadata>,
): string {
  return JSON.stringify({
    archivePinned: session.archivePinned === true,
    createdAt: session.createdAt,
    name: session.name,
    windows: session.windowIds.map((windowId) =>
      windowFingerprint(windows[windowId]!),
    ),
  });
}

function cloneStore(store: ArchiveStore): ArchiveStore {
  return structuredClone(store);
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  const text = optionalText(value, maxLength);
  if (text === undefined) throw new Error(message);
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? undefined : normalized.slice(0, maxLength);
}

function optionalName(value: unknown): { name?: string } {
  const name = optionalText(value, 80);
  return name === undefined ? {} : { name };
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  return requiredBoolean(value, label);
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`An imported ${label} is invalid.`);
  }
  return value;
}

function validIsoTimestamp(value: unknown, label: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    throw new Error(`An imported ${label} has an invalid date.`);
  }
  const timestamp = Date.parse(value);
  const valid = validTimestamp(timestamp, label);
  if (new Date(valid).toISOString() !== value) {
    throw new Error(`An imported ${label} has an invalid date.`);
  }
  return valid;
}

function timestampToIso(value: number, label: string): string {
  const timestamp = validTimestamp(value, label);
  return new Date(timestamp).toISOString();
}

function validTimestamp(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Date.now() + 24 * 60 * 60 * 1000
  ) {
    throw new Error(`An imported ${label} has an invalid date.`);
  }
  return value;
}

function isSafeId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    value !== "__proto__" &&
    value !== "constructor" &&
    value !== "prototype"
  );
}
