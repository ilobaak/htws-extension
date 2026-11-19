export interface FrameProtectionSignal {
  childFrameCount: number;
  documentId: string;
  formDirty: boolean;
  frameId: number;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  streamActive: boolean;
  updatedAt: number;
}

export interface TabProtectionState {
  frames: Record<string, FrameProtectionSignal>;
  loading: boolean;
  tabId: number;
  topDocumentId?: string | undefined;
  url?: string | undefined;
}

export interface PageSafetySnapshot {
  frameCoverageComplete: boolean;
  formDirty: boolean;
  mediaPlaying: boolean;
  observerReady: boolean;
  pictureInPicture: boolean;
  streamActive: boolean;
}

export type PageStateStore = Record<string, TabProtectionState>;

const PAGE_STATE_PREFIX = "pageProtection:";

export async function loadPageStateStore(): Promise<PageStateStore> {
  const stored = await chrome.storage.session.get(null);
  return Object.fromEntries(
    Object.entries(stored)
      .filter(([key]) => key.startsWith(PAGE_STATE_PREFIX))
      .map(([key, value]) => [key.slice(PAGE_STATE_PREFIX.length), value]),
  ) as PageStateStore;
}

export async function loadTabProtectionState(
  tabId: number,
): Promise<TabProtectionState | undefined> {
  const key = pageStateKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] as TabProtectionState | undefined;
}

export async function saveTabProtectionState(
  state: TabProtectionState,
): Promise<void> {
  await chrome.storage.session.set({ [pageStateKey(state.tabId)]: state });
}

export async function removeTabProtectionState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pageStateKey(tabId));
}

export async function clearPageStateStore(): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) =>
    key.startsWith(PAGE_STATE_PREFIX),
  );
  if (keys.length > 0) await chrome.storage.session.remove(keys);
}

export function aggregatePageState(
  state: TabProtectionState | undefined,
): PageSafetySnapshot | undefined {
  if (state === undefined || state.loading) return undefined;
  const frames = Object.values(state.frames);
  const top = frames.find(
    (frame) => frame.frameId === 0 && frame.documentId === state.topDocumentId,
  );
  return {
    frameCoverageComplete:
      top !== undefined &&
      frames.length ===
        1 + frames.reduce((sum, frame) => sum + frame.childFrameCount, 0),
    formDirty: frames.some((frame) => frame.formDirty),
    mediaPlaying: frames.some((frame) => frame.mediaPlaying),
    observerReady: top !== undefined,
    pictureInPicture: frames.some((frame) => frame.pictureInPicture),
    streamActive: frames.some((frame) => frame.streamActive),
  };
}

function pageStateKey(tabId: number): string {
  return `${PAGE_STATE_PREFIX}${tabId}`;
}
