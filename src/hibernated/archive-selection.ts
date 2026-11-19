import type {
  ArchiveSnapshot,
  ArchiveWindowView,
} from "../background/hibernate-archive";
import type { ArchiveFilterMatches } from "./archive-filter";

export interface ArchiveSelectionSets {
  groupIds: Set<string>;
  sessionIds: Set<string>;
  tabIds: Set<string>;
  windowIds: Set<string>;
}

export type ArchiveSelectionType = "group" | "session" | "tab" | "window";

export interface ArchiveSelectionReference {
  id: string;
  type: ArchiveSelectionType;
}

export function inclusiveArchiveSelectionRange(
  order: readonly ArchiveSelectionReference[],
  anchor: ArchiveSelectionReference | undefined,
  target: ArchiveSelectionReference,
): ArchiveSelectionReference[] {
  if (anchor === undefined) return [target];
  const anchorIndex = order.findIndex((item) => sameReference(item, anchor));
  const targetIndex = order.findIndex((item) => sameReference(item, target));
  if (anchorIndex < 0 || targetIndex < 0) return [target];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
}

export function effectiveArchiveSelection(
  snapshot: ArchiveSnapshot,
  selection: ArchiveSelectionSets,
): ArchiveSelectionSets {
  const effective = emptySelection();
  const includeWindow = (
    window: ArchiveWindowView,
    ancestorSelected: boolean,
  ): void => {
    const windowSelected =
      ancestorSelected || selection.windowIds.has(window.folderId);
    if (windowSelected) effective.windowIds.add(window.folderId);
    for (const group of window.groups ?? []) {
      const groupId = groupSelectionId(window.folderId, group.key);
      if (windowSelected || selection.groupIds.has(groupId))
        effective.groupIds.add(groupId);
    }
    for (const tab of window.tabs) {
      const groupSelected =
        tab.groupKey !== undefined &&
        effective.groupIds.has(groupSelectionId(window.folderId, tab.groupKey));
      if (
        windowSelected ||
        groupSelected ||
        selection.tabIds.has(tab.bookmarkId)
      )
        effective.tabIds.add(tab.bookmarkId);
    }
  };

  for (const session of snapshot.sessions) {
    const sessionSelected = selection.sessionIds.has(session.sessionId);
    if (sessionSelected) effective.sessionIds.add(session.sessionId);
    session.windows.forEach((window) => includeWindow(window, sessionSelected));
  }
  snapshot.windows.forEach((window) => includeWindow(window, false));
  for (const tab of snapshot.tabs) {
    if (selection.tabIds.has(tab.bookmarkId))
      effective.tabIds.add(tab.bookmarkId);
  }
  return effective;
}

export function deselectArchiveMatches(
  snapshot: ArchiveSnapshot,
  selection: ArchiveSelectionSets,
  matches: ArchiveFilterMatches,
): ArchiveSelectionSets {
  const desired = effectiveArchiveSelection(snapshot, selection);
  deleteMatches(desired, matches);
  const next = emptySelection();

  const rebuildWindow = (window: ArchiveWindowView): void => {
    const groupIds = (window.groups ?? []).map((group) =>
      groupSelectionId(window.folderId, group.key),
    );
    const allDescendantsSelected =
      groupIds.every((id) => desired.groupIds.has(id)) &&
      window.tabs.every((tab) => desired.tabIds.has(tab.bookmarkId));
    if (desired.windowIds.has(window.folderId) && allDescendantsSelected) {
      next.windowIds.add(window.folderId);
      return;
    }

    for (const group of window.groups ?? []) {
      const groupId = groupSelectionId(window.folderId, group.key);
      const groupTabs = window.tabs.filter((tab) => tab.groupKey === group.key);
      if (
        desired.groupIds.has(groupId) &&
        groupTabs.every((tab) => desired.tabIds.has(tab.bookmarkId))
      ) {
        next.groupIds.add(groupId);
        continue;
      }
      groupTabs.forEach((tab) => {
        if (desired.tabIds.has(tab.bookmarkId)) next.tabIds.add(tab.bookmarkId);
      });
    }

    const knownGroupKeys = new Set(
      (window.groups ?? []).map((group) => group.key),
    );
    window.tabs.forEach((tab) => {
      if (
        (tab.groupKey === undefined || !knownGroupKeys.has(tab.groupKey)) &&
        desired.tabIds.has(tab.bookmarkId)
      )
        next.tabIds.add(tab.bookmarkId);
    });
  };

  for (const session of snapshot.sessions) {
    const allDescendantsSelected = session.windows.every(
      (window) =>
        desired.windowIds.has(window.folderId) &&
        (window.groups ?? []).every((group) =>
          desired.groupIds.has(groupSelectionId(window.folderId, group.key)),
        ) &&
        window.tabs.every((tab) => desired.tabIds.has(tab.bookmarkId)),
    );
    if (desired.sessionIds.has(session.sessionId) && allDescendantsSelected) {
      next.sessionIds.add(session.sessionId);
    } else {
      session.windows.forEach(rebuildWindow);
    }
  }
  snapshot.windows.forEach(rebuildWindow);
  snapshot.tabs.forEach((tab) => {
    if (desired.tabIds.has(tab.bookmarkId)) next.tabIds.add(tab.bookmarkId);
  });
  return next;
}

function deleteMatches(
  selection: ArchiveSelectionSets,
  matches: ArchiveFilterMatches,
): void {
  matches.sessionIds.forEach((id) => selection.sessionIds.delete(id));
  matches.windowIds.forEach((id) => selection.windowIds.delete(id));
  matches.groupIds.forEach((id) => selection.groupIds.delete(id));
  matches.tabIds.forEach((id) => selection.tabIds.delete(id));
}

function emptySelection(): ArchiveSelectionSets {
  return {
    groupIds: new Set(),
    sessionIds: new Set(),
    tabIds: new Set(),
    windowIds: new Set(),
  };
}

function groupSelectionId(folderId: string, groupKey: string): string {
  return `${folderId}\u0000${groupKey}`;
}

function sameReference(
  left: ArchiveSelectionReference,
  right: ArchiveSelectionReference,
): boolean {
  return left.type === right.type && left.id === right.id;
}
