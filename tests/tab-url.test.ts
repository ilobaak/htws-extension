import { describe, expect, it } from "vitest";

import {
  classifyTabUrl,
  isArchiveableUrl,
  isBookmarkableUrl,
} from "../src/core/tab-url";

describe("tab URL policy", () => {
  it.each(["chrome://extensions/", "brave://bookmarks/"])(
    "archives but does not bookmark %s",
    (url) => {
      expect(classifyTabUrl(url)).toBe("internal");
      expect(isArchiveableUrl(url)).toBe(true);
      expect(isBookmarkableUrl(url)).toBe(false);
    },
  );

  it("archives and bookmarks normal websites", () => {
    expect(classifyTabUrl("https://example.com/")).toBe("website");
    expect(isArchiveableUrl("https://example.com/")).toBe(true);
    expect(isBookmarkableUrl("https://example.com/")).toBe(true);
  });

  it.each([
    "chrome-untrusted://terminal/",
    "chrome-extension://other/page.html",
    "file:///private.txt",
    "data:text/plain,hello",
  ])("rejects %s", (url) => {
    expect(classifyTabUrl(url)).toBe("unsupported");
    expect(isArchiveableUrl(url)).toBe(false);
    expect(isBookmarkableUrl(url)).toBe(false);
  });
});
