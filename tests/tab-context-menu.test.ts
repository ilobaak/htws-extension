import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureTabContextMenu,
  HIBERNATE_GROUP_MENU_ID,
  HIBERNATE_SELECTED_TABS_MENU_ID,
  HIBERNATE_SESSION_MENU_ID,
  HIBERNATE_TAB_MENU_ID,
  HIBERNATE_WINDOW_MENU_ID,
  NEVER_HIBERNATE_SITE_MENU_ID,
  updateSelectedTabsContextMenu,
} from "../src/background/tab-context-menu";

describe("tab context menus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers tab, window, and session hibernation actions", async () => {
    const create = vi.fn((_: unknown, callback: () => void) => callback());
    const removeAll = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      contextMenus: {
        create,
        removeAll,
      },
      runtime: {},
    });

    await ensureTabContextMenu();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hibernate this tab" }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Hibernate selected tabs",
        visible: false,
      }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Hibernate this group",
        visible: false,
      }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hibernate this window" }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hibernate this session" }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        contexts: ["page", "tab"],
        title: "Never hibernate this site",
      }),
      expect.any(Function),
    );
    expect(removeAll).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(6);
    const createdIds = create.mock.calls.map(
      ([item]) => (item as chrome.contextMenus.CreateProperties).id,
    );
    expect([
      HIBERNATE_TAB_MENU_ID,
      HIBERNATE_SELECTED_TABS_MENU_ID,
      HIBERNATE_GROUP_MENU_ID,
      HIBERNATE_WINDOW_MENU_ID,
      HIBERNATE_SESSION_MENU_ID,
      NEVER_HIBERNATE_SITE_MENU_ID,
    ]).toEqual(expect.arrayContaining(createdIds));
  });

  it("shows the selected-tabs action only for a highlighted multi-selection", async () => {
    const update = vi.fn((_: unknown, __: unknown, callback: () => void) =>
      callback(),
    );
    vi.stubGlobal("chrome", {
      contextMenus: { update },
      runtime: {},
    });

    await updateSelectedTabsContextMenu(2);

    expect(update).toHaveBeenCalledTimes(4);
    expect(update).toHaveBeenCalledWith(
      HIBERNATE_TAB_MENU_ID,
      { visible: false },
      expect.any(Function),
    );
    expect(update).toHaveBeenCalledWith(
      HIBERNATE_SELECTED_TABS_MENU_ID,
      { visible: true },
      expect.any(Function),
    );
    expect(update).toHaveBeenCalledWith(
      NEVER_HIBERNATE_SITE_MENU_ID,
      { title: "Never hibernate these sites" },
      expect.any(Function),
    );
  });

  it("shows the group action only for a grouped active tab", async () => {
    const update = vi.fn((_: unknown, __: unknown, callback: () => void) =>
      callback(),
    );
    vi.stubGlobal("chrome", {
      contextMenus: { update },
      runtime: {},
    });

    await updateSelectedTabsContextMenu(1, true);

    expect(update).toHaveBeenCalledWith(
      HIBERNATE_GROUP_MENU_ID,
      { visible: true },
      expect.any(Function),
    );
  });

  it("restores singular commands for a one-tab selection", async () => {
    const update = vi.fn((_: unknown, __: unknown, callback: () => void) =>
      callback(),
    );
    vi.stubGlobal("chrome", {
      contextMenus: { update },
      runtime: {},
    });

    await updateSelectedTabsContextMenu(1);

    expect(update).toHaveBeenCalledWith(
      HIBERNATE_TAB_MENU_ID,
      { visible: true },
      expect.any(Function),
    );
    expect(update).toHaveBeenCalledWith(
      HIBERNATE_SELECTED_TABS_MENU_ID,
      { visible: false },
      expect.any(Function),
    );
    expect(update).toHaveBeenCalledWith(
      NEVER_HIBERNATE_SITE_MENU_ID,
      { title: "Never hibernate this site" },
      expect.any(Function),
    );
  });
});
