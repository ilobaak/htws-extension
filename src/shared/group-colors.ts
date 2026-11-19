export const DEFAULT_GROUP_COLOR: `${chrome.tabGroups.Color}` = "grey";

export const GROUP_COLORS: readonly `${chrome.tabGroups.Color}`[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

const GROUP_COLOR_SET = new Set<string>(GROUP_COLORS);

export function isSupportedGroupColor(
  value: unknown,
): value is `${chrome.tabGroups.Color}` {
  return typeof value === "string" && GROUP_COLOR_SET.has(value);
}

export function normalizeGroupColor(
  value: unknown,
): `${chrome.tabGroups.Color}` {
  return isSupportedGroupColor(value) ? value : DEFAULT_GROUP_COLOR;
}
