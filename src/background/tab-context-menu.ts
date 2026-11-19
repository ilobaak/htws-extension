export const HIBERNATE_TAB_MENU_ID = "htws-hibernate-tab";
export const HIBERNATE_SELECTED_TABS_MENU_ID = "htws-hibernate-selected-tabs";
export const HIBERNATE_GROUP_MENU_ID = "htws-hibernate-group";
export const HIBERNATE_WINDOW_MENU_ID = "htws-hibernate-window";
export const HIBERNATE_SESSION_MENU_ID = "htws-hibernate-session";
export const NEVER_HIBERNATE_SITE_MENU_ID = "htws-never-hibernate-site";

const MENUS: chrome.contextMenus.CreateProperties[] = [
  {
    contexts: ["tab"],
    id: HIBERNATE_TAB_MENU_ID,
    title: "Hibernate this tab",
  },
  {
    contexts: ["tab"],
    id: HIBERNATE_SELECTED_TABS_MENU_ID,
    title: "Hibernate selected tabs",
    visible: false,
  },
  {
    contexts: ["tab"],
    id: HIBERNATE_GROUP_MENU_ID,
    title: "Hibernate this group",
    visible: false,
  },
  {
    contexts: ["tab"],
    id: HIBERNATE_WINDOW_MENU_ID,
    title: "Hibernate this window",
  },
  {
    contexts: ["tab"],
    id: HIBERNATE_SESSION_MENU_ID,
    title: "Hibernate this session",
  },
  {
    contexts: ["page", "tab"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
    id: NEVER_HIBERNATE_SITE_MENU_ID,
    title: "Never hibernate this site",
  },
];

export async function ensureTabContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  await Promise.all(
    MENUS.map(
      (properties) =>
        new Promise<void>((resolve, reject) => {
          chrome.contextMenus.create(properties, () => {
            const error = chrome.runtime.lastError;
            if (error === undefined) resolve();
            else reject(new Error(error.message));
          });
        }),
    ),
  );
}

export async function updateSelectedTabsContextMenu(
  selectedCount: number,
  activeTabIsGrouped = false,
): Promise<void> {
  const multiple = selectedCount > 1;
  await Promise.all([
    updateContextMenu(HIBERNATE_TAB_MENU_ID, { visible: !multiple }),
    updateContextMenu(HIBERNATE_SELECTED_TABS_MENU_ID, { visible: multiple }),
    updateContextMenu(HIBERNATE_GROUP_MENU_ID, {
      visible: activeTabIsGrouped,
    }),
    updateContextMenu(NEVER_HIBERNATE_SITE_MENU_ID, {
      title: multiple
        ? "Never hibernate these sites"
        : "Never hibernate this site",
    }),
  ]);
}

function updateContextMenu(
  id: string,
  properties: Parameters<typeof chrome.contextMenus.update>[1],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.contextMenus.update(id, properties, () => {
      const error = chrome.runtime.lastError;
      if (error === undefined) resolve();
      else reject(new Error(error.message));
    });
  });
}
