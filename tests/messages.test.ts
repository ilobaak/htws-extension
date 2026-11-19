import { describe, expect, it } from "vitest";

import { isWorkerMessage } from "../src/shared/messages";

describe("archive worker messages", () => {
  it.each([
    { type: "GET_ARCHIVES" },
    { type: "CLEAR_ARCHIVES" },
    { type: "RESTORE_ALL_ARCHIVES" },
    { type: "GET_ARCHIVE_HISTORY" },
    { type: "UNDO_ARCHIVE" },
    { type: "REDO_ARCHIVE" },
    {
      destination: "session",
      name: "Merged",
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "MERGE_ARCHIVE_SELECTION",
    },
    {
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "MOVE_ARCHIVE_TABS_OUT",
    },
    {
      selection: { sessionIds: ["session-1"], tabIds: [], windowIds: [] },
      type: "MOVE_ARCHIVE_WINDOWS_OUT",
    },
    {
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "BOOKMARK_ARCHIVE_SELECTION",
    },
    {
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "RESTORE_ARCHIVE_SELECTION",
    },
    {
      color: "blue",
      tabIds: ["tab-1"],
      title: "Research",
      type: "CREATE_ARCHIVE_GROUP",
    },
    {
      color: "future-browser-color",
      tabIds: ["tab-1"],
      title: "Research",
      type: "CREATE_ARCHIVE_GROUP",
    },
    {
      color: "purple",
      folderId: "window-1",
      groupKey: "group-1",
      title: "Reading",
      type: "UPDATE_ARCHIVE_GROUP",
    },
    {
      color: "purple",
      folderId: "window-1",
      groupKey: "group-1",
      type: "UPDATE_ARCHIVE_GROUP",
    },
    {
      folderId: "window-1",
      groupKey: "group-1",
      tabIds: ["tab-1"],
      type: "MOVE_ARCHIVE_TABS_TO_GROUP",
    },
    {
      folderId: "window-1",
      tabIds: ["tab-1"],
      type: "MOVE_ARCHIVE_TABS_TO_GROUP",
    },
    {
      folderId: "window-1",
      groupKey: "group-1",
      type: "RESTORE_ARCHIVE_GROUP",
    },
    {
      folderId: "window-1",
      groupKey: "group-1",
      type: "DELETE_ARCHIVE_GROUP",
    },
    {
      placement: "inside",
      source: { id: "tab-1", type: "tab" },
      target: { id: "window-1", type: "window" },
      type: "MOVE_ARCHIVE_ITEM",
    },
    {
      placement: "inside",
      source: { id: "window-1", type: "window" },
      type: "MOVE_ARCHIVE_ITEM",
    },
    {
      placement: "inside",
      source: {
        collapsed: true,
        groupKey: "group-1",
        id: "window-1",
        type: "group",
      },
      target: { id: "tab-1", type: "tab" },
      type: "MOVE_ARCHIVE_ITEM",
    },
    {
      destination: { id: "session-1", type: "session" },
      items: [
        { id: "session-1", type: "session" },
        { id: "window-1", type: "window" },
      ],
      type: "MERGE_ARCHIVE_ITEMS",
    },
    {
      item: { groupKey: "group-1", id: "window-1", type: "group" },
      type: "TOGGLE_ARCHIVE_PIN",
    },
    {
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "DELETE_ARCHIVE_SELECTION",
    },
    {
      selection: { sessionIds: [], tabIds: ["tab-1"], windowIds: [] },
      type: "DUPLICATE_ARCHIVE_SELECTION",
    },
    { type: "GET_ACTIVITY_LOG" },
    { type: "CLEAR_ACTIVITY_LOG" },
    { data: { entries: [] }, type: "IMPORT_ACTIVITY_LOG" },
    { type: "EXPORT_ARCHIVES" },
    { data: { archive: {} }, type: "IMPORT_ARCHIVES" },
    { type: "PRUNE_ACTIVITY_LOG" },
    {
      entryId: "activity-1",
      type: "RESTORE_ACTIVITY_ENTRY",
    },
    { tabId: 12, type: "HIBERNATE_TAB" },
    { tabIds: [12, 13], type: "HIBERNATE_TABS" },
    { groupId: 7, type: "HIBERNATE_GROUP" },
    { groupId: 7, ignoreProtection: true, type: "HIBERNATE_GROUP" },
    { type: "HIBERNATE_WINDOW", windowId: 4 },
    { ignoreProtection: true, type: "HIBERNATE_WINDOW", windowId: 4 },
    { name: "Work", type: "HIBERNATE_SESSION" },
    { ignoreProtection: true, name: "Work", type: "HIBERNATE_SESSION" },
    { bookmarkId: "bookmark-1", type: "RESTORE_ARCHIVE_TAB" },
    {
      bookmarkId: "bookmark-1",
      targetWindowId: 9,
      type: "RESTORE_ARCHIVE_TAB",
    },
    { folderId: "folder-1", type: "RESTORE_ARCHIVE_WINDOW" },
    { bookmarkId: "bookmark-1", type: "DELETE_ARCHIVE_TAB" },
    { folderId: "folder-1", type: "DELETE_ARCHIVE_WINDOW" },
    { bookmarkId: "bookmark-1", type: "TOGGLE_ARCHIVE_TAB_BOOKMARK" },
    { folderId: "folder-1", type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK" },
    { bookmarkId: "bookmark-1", name: "Docs", type: "RENAME_ARCHIVE_TAB" },
    { folderId: "folder-1", name: "Research", type: "RENAME_ARCHIVE_WINDOW" },
    {
      folderId: "folder-1",
      mergeOnConflict: true,
      name: "Research",
      type: "RENAME_ARCHIVE_WINDOW",
    },
    { sessionId: "session-1", type: "RESTORE_ARCHIVE_SESSION" },
    { sessionId: "session-1", type: "DELETE_ARCHIVE_SESSION" },
    { sessionId: "session-1", type: "TOGGLE_ARCHIVE_SESSION_BOOKMARK" },
    { name: "Work", sessionId: "session-1", type: "RENAME_ARCHIVE_SESSION" },
    {
      mergeOnConflict: true,
      name: "Work",
      sessionId: "session-1",
      type: "RENAME_ARCHIVE_SESSION",
    },
  ])("accepts $type", (message) => {
    expect(isWorkerMessage(message)).toBe(true);
  });

  it.each([
    { tabId: 1.2, type: "HIBERNATE_TAB" },
    { tabIds: [1], type: "HIBERNATE_TABS" },
    { tabIds: [1, 1], type: "HIBERNATE_TABS" },
    { tabIds: [1, 2.2], type: "HIBERNATE_TABS" },
    { groupId: -1, type: "HIBERNATE_GROUP" },
    { groupId: "7", type: "HIBERNATE_GROUP" },
    { groupId: 7, ignoreProtection: "yes", type: "HIBERNATE_GROUP" },
    { entryId: "", type: "RESTORE_ACTIVITY_ENTRY" },
    { data: null, type: "IMPORT_ACTIVITY_LOG" },
    {
      destination: "folder",
      name: "Merged",
      selection: { sessionIds: [], tabIds: [], windowIds: [] },
      type: "MERGE_ARCHIVE_SELECTION",
    },
    {
      selection: { sessionIds: [], tabIds: [1], windowIds: [] },
      type: "MOVE_ARCHIVE_TABS_OUT",
    },
    {
      selection: { sessionIds: [], tabIds: [1], windowIds: [] },
      type: "BOOKMARK_ARCHIVE_SELECTION",
    },
    {
      selection: { sessionIds: [], tabIds: [1], windowIds: [] },
      type: "RESTORE_ARCHIVE_SELECTION",
    },
    {
      color: "",
      tabIds: ["tab-1"],
      title: "Research",
      type: "CREATE_ARCHIVE_GROUP",
    },
    {
      color: "blue",
      folderId: "window-1",
      groupKey: "",
      title: "Research",
      type: "UPDATE_ARCHIVE_GROUP",
    },
    {
      folderId: "window-1",
      tabIds: [],
      type: "MOVE_ARCHIVE_TABS_TO_GROUP",
    },
    { folderId: "window-1", groupKey: "", type: "RESTORE_ARCHIVE_GROUP" },
    {
      placement: "around",
      source: { id: "tab-1", type: "tab" },
      type: "MOVE_ARCHIVE_ITEM",
    },
    {
      placement: "inside",
      source: { id: "", type: "tab" },
      type: "MOVE_ARCHIVE_ITEM",
    },
    { data: "archive", type: "IMPORT_ARCHIVES" },
    { type: "RESTORE_ACTIVITY_ENTRY" },
    { type: "HIBERNATE_WINDOW", windowId: "4" },
    { ignoreProtection: "yes", type: "HIBERNATE_WINDOW", windowId: 4 },
    { name: 4, type: "HIBERNATE_SESSION" },
    { ignoreProtection: 1, type: "HIBERNATE_SESSION" },
    { bookmarkId: "", type: "RESTORE_ARCHIVE_TAB" },
    { folderId: "   ", type: "RESTORE_ARCHIVE_WINDOW" },
    { bookmarkId: "", type: "DELETE_ARCHIVE_TAB" },
    { folderId: "", type: "DELETE_ARCHIVE_WINDOW" },
    { bookmarkId: "", type: "TOGGLE_ARCHIVE_TAB_BOOKMARK" },
    { folderId: "", type: "TOGGLE_ARCHIVE_WINDOW_BOOKMARK" },
    { bookmarkId: "bookmark-1", name: "", type: "RENAME_ARCHIVE_TAB" },
    { folderId: "folder-1", name: "", type: "RENAME_ARCHIVE_WINDOW" },
    { sessionId: "", type: "RESTORE_ARCHIVE_SESSION" },
    { name: "", sessionId: "session-1", type: "RENAME_ARCHIVE_SESSION" },
  ])("rejects malformed $type", (message) => {
    expect(isWorkerMessage(message)).toBe(false);
  });
});
