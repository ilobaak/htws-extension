export type TabUrlKind = "internal" | "unsupported" | "website";

export function classifyTabUrl(value: string): TabUrlKind {
  if (value.length === 0 || value.length > 10_000) return "unsupported";
  try {
    const protocol = new URL(value).protocol;
    if (protocol === "http:" || protocol === "https:") return "website";
    if (protocol === "chrome:" || protocol === "brave:") return "internal";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

export function isArchiveableUrl(value: string): boolean {
  return classifyTabUrl(value) !== "unsupported";
}

export function isBookmarkableUrl(value: string): boolean {
  return classifyTabUrl(value) === "website";
}

export function isInternalUrl(value: string): boolean {
  return classifyTabUrl(value) === "internal";
}

export function isWebsiteUrl(value: string): boolean {
  return classifyTabUrl(value) === "website";
}
