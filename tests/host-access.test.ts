import { describe, expect, it } from "vitest";

import {
  classifyHostAccess,
  mapSettledWithConcurrency,
  matchOriginPattern,
} from "../src/background/host-access";

describe("host access", () => {
  it("classifies all-site, selected-site, and absent access", () => {
    expect(
      classifyHostAccess("https://example.com", ["http://*/*", "https://*/*"]),
    ).toBe("all");
    expect(
      classifyHostAccess("https://example.com", ["https://example.com/*"]),
    ).toBe("selected");
    expect(classifyHostAccess("https://example.com", [])).toBe("none");
  });

  it("matches wildcard subdomain grants without matching lookalikes", () => {
    expect(
      matchOriginPattern("https://a.example.com/x", "https://*.example.com/*"),
    ).toBe(true);
    expect(
      matchOriginPattern("https://notexample.com/x", "https://*.example.com/*"),
    ).toBe(false);
  });

  it("bounds observer bootstrap work and continues after a failure", async () => {
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await mapSettledWithConcurrency(
      Array.from({ length: 30 }, (_, index) => index),
      4,
      async (index) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        if (index === 5) throw new Error("inaccessible tab");
        completed.push(index);
      },
    );

    expect(maximumActive).toBe(4);
    expect(completed).toHaveLength(29);
  });
});
