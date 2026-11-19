import { describe, expect, it } from "vitest";

import {
  aggregatePageState,
  type TabProtectionState,
} from "../src/shared/page-state";

describe("page state aggregation", () => {
  it("requires the top document and every reported child frame for full coverage", () => {
    const state: TabProtectionState = {
      frames: {
        "0": {
          childFrameCount: 1,
          documentId: "top",
          formDirty: false,
          frameId: 0,
          mediaPlaying: false,
          pictureInPicture: false,
          streamActive: false,
          updatedAt: 1,
        },
      },
      loading: false,
      tabId: 4,
      topDocumentId: "top",
    };
    expect(aggregatePageState(state)).toMatchObject({
      frameCoverageComplete: false,
      observerReady: true,
    });
    state.frames["2"] = {
      childFrameCount: 0,
      documentId: "child",
      formDirty: true,
      frameId: 2,
      mediaPlaying: false,
      pictureInPicture: false,
      streamActive: false,
      updatedAt: 2,
    };
    expect(aggregatePageState(state)).toMatchObject({
      formDirty: true,
      frameCoverageComplete: true,
    });
  });

  it("treats a loading document as unknown", () => {
    expect(
      aggregatePageState({ frames: {}, loading: true, tabId: 4 }),
    ).toBeUndefined();
  });
});
