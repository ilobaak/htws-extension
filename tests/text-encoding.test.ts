import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const rootFiles = [
  "activity.html",
  "hibernated.html",
  "options.html",
  "popup.html",
];
const sourceExtensions = new Set([".css", ".html", ".ts"]);
const malformedText = [/\u00c2(?=[^\s])/u, /\u00c3/u, /\u00e2/u, /\ufffd/u];

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

describe("user-facing text encoding", () => {
  it("contains no common mojibake sequences", () => {
    const files = [
      ...rootFiles.map((file) => join(process.cwd(), file)),
      ...collectSourceFiles(join(process.cwd(), "src")),
    ];
    const failures = files.flatMap((file) => {
      const contents = readFileSync(file, "utf8");
      return malformedText.some((pattern) => pattern.test(contents))
        ? [file]
        : [];
    });

    expect(failures).toEqual([]);
  });

  it("gives every static button a hover explanation", () => {
    const missingTitles = rootFiles.flatMap((file) => {
      const contents = readFileSync(join(process.cwd(), file), "utf8");
      return [...contents.matchAll(/<button\b[^>]*>/gs)].flatMap((match) =>
        /\btitle\s*=/.test(match[0]) ? [] : [`${file}: ${match[0]}`],
      );
    });

    expect(missingTitles).toEqual([]);
  });
});
