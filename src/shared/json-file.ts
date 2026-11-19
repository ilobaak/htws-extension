const MAX_JSON_FILE_BYTES = 10 * 1024 * 1024;

export function downloadJson(data: unknown, filenamePrefix: string): void {
  const exportedAt = new Date();
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${filenamePrefix}-${exportedAt
    .toISOString()
    .replaceAll(":", "-")
    .replace(".000Z", "Z")}.json`;
  link.href = url;
  link.click();
  // Chromium may not begin reading the object URL until after the click handler
  // returns. Revoking it synchronously can cancel an otherwise valid download.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > MAX_JSON_FILE_BYTES) {
    throw new Error("JSON imports are limited to 10 MB.");
  }
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
}
