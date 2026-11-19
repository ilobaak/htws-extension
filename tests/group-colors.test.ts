import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUP_COLOR,
  GROUP_COLORS,
  isSupportedGroupColor,
  normalizeGroupColor,
} from "../src/shared/group-colors";

describe("group colors", () => {
  it("recognizes every browser group color", () => {
    expect(GROUP_COLORS).toHaveLength(9);
    expect(GROUP_COLORS.every(isSupportedGroupColor)).toBe(true);
  });

  it.each([undefined, null, "", "beige", 12, {}])(
    "falls back safely for unsupported value %s",
    (value) => {
      expect(normalizeGroupColor(value)).toBe(DEFAULT_GROUP_COLOR);
    },
  );
});
