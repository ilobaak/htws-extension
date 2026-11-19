import { classifyHostAccess, getGrantedOrigins } from "./host-access";
import type { ObserverSnapshotMessage } from "../shared/messages";
import {
  clearPageStateStore,
  loadTabProtectionState,
  removeTabProtectionState,
  saveTabProtectionState,
  type PageStateStore,
  type TabProtectionState,
} from "../shared/page-state";

let updateQueue: Promise<void> = Promise.resolve();

export function handleObserverSnapshot(
  message: ObserverSnapshotMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  return enqueue(async () => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab?.id === undefined ||
      sender.tab.incognito ||
      sender.documentId === undefined ||
      sender.frameId === undefined ||
      (sender.documentLifecycle !== undefined &&
        sender.documentLifecycle !== "active") ||
      sender.url === undefined
    ) {
      return;
    }

    const origins = await getGrantedOrigins();
    if (classifyHostAccess(sender.url, origins) === "none") return;

    const existing = await loadTabProtectionState(sender.tab.id);
    if (existing?.loading === true) return;
    const state: TabProtectionState = existing ?? {
      frames: {},
      loading: false,
      tabId: sender.tab.id,
      url: sender.tab.url,
    };
    if (sender.frameId !== 0 && state.topDocumentId === undefined) {
      return;
    }
    if (sender.frameId === 0) state.topDocumentId = sender.documentId;
    state.frames[String(sender.frameId)] = {
      childFrameCount: message.childFrameCount,
      documentId: sender.documentId,
      formDirty: message.formDirty,
      frameId: sender.frameId,
      mediaPlaying: message.mediaPlaying,
      pictureInPicture: message.pictureInPicture,
      streamActive: message.streamActive,
      updatedAt: Date.now(),
    };
    state.url = sender.tab.url;
    await saveTabProtectionState(state);
  });
}

export function markTabLoading(tabId: number, url?: string): Promise<void> {
  return enqueue(async () => {
    await saveTabProtectionState({ frames: {}, loading: true, tabId, url });
  });
}

export function markTabComplete(tabId: number, url?: string): Promise<void> {
  return enqueue(async () => {
    await saveTabProtectionState({ frames: {}, loading: false, tabId, url });
  });
}

export function removeTabState(tabId: number): Promise<void> {
  return enqueue(async () => {
    await removeTabProtectionState(tabId);
  });
}

export function clearPageStates(): Promise<void> {
  return enqueue(clearPageStateStore);
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  updateQueue = updateQueue.then(operation, operation);
  return updateQueue;
}

export function getTabState(store: PageStateStore, tabId: number | undefined) {
  return tabId === undefined ? undefined : store[String(tabId)];
}
