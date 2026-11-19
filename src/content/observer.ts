const INSTALL_KEY = "__htwsObserverInstalled";
const observerWindow = window as unknown as Window & Record<string, unknown>;

if (observerWindow[INSTALL_KEY] !== true) {
  observerWindow[INSTALL_KEY] = true;
  installObserver();
}

function installObserver(): void {
  let formDirty = false;
  let lastSnapshot = "";
  let publishTimer: number | undefined;

  const publish = (force = false): void => {
    if (publishTimer !== undefined) {
      window.clearTimeout(publishTimer);
      publishTimer = undefined;
    }
    const media = [
      ...document.querySelectorAll<HTMLMediaElement>("audio, video"),
    ];
    const snapshot = {
      childFrameCount: document.querySelectorAll("iframe, frame").length,
      formDirty,
      mediaPlaying: media.some(
        (element) =>
          !element.paused && !element.ended && element.readyState > 2,
      ),
      pictureInPicture: document.pictureInPictureElement !== null,
      streamActive: media.some(
        (element) =>
          element.srcObject instanceof MediaStream &&
          element.srcObject
            .getTracks()
            .some((track) => track.readyState === "live"),
      ),
      type: "OBSERVER_SNAPSHOT",
    } as const;
    const serialized = JSON.stringify(snapshot);
    if (!force && serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    void chrome.runtime.sendMessage(snapshot).catch(() => undefined);
  };

  const queuePublish = (): void => {
    if (publishTimer !== undefined) return;
    publishTimer = window.setTimeout(publish, 250);
  };

  const markDirty = (event: Event): void => {
    if (!event.isTrusted) return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      formDirty = true;
      queuePublish();
    }
  };

  for (const eventName of [
    "play",
    "playing",
    "canplay",
    "loadeddata",
    "pause",
    "ended",
    "emptied",
    "enterpictureinpicture",
    "leavepictureinpicture",
  ]) {
    document.addEventListener(eventName, queuePublish, true);
  }
  document.addEventListener("input", markDirty, true);
  document.addEventListener("change", markDirty, true);
  new MutationObserver(queuePublish).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "REQUEST_OBSERVER_SNAPSHOT"
    ) {
      publish(true);
    }
  });
  publish();
}
