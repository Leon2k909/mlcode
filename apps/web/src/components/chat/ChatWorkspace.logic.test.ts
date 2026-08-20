import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkspaceGridTemplate,
  resizeAdjacentPanePair,
  resolveWorkspacePaneDropSide,
} from "./ChatWorkspace.logic";

describe("resizeAdjacentPanePair", () => {
  it("tracks cumulative pointer movement from immutable starting sizes", () => {
    const input = {
      paneSizes: [0.5, 0.5],
      beforeIndex: 0,
      afterIndex: 1,
      startX: 200,
      containerWidth: 1_000,
      minimumPaneWidth: 200,
    } as const;

    const firstMove = resizeAdjacentPanePair({ ...input, currentX: 240 });
    const finalMove = resizeAdjacentPanePair({ ...input, currentX: 300 });
    expect(firstMove[0]).toBeCloseTo(0.54);
    expect(firstMove[1]).toBeCloseTo(0.46);
    expect(finalMove[0]).toBeCloseTo(0.6);
    expect(finalMove[1]).toBeCloseTo(0.4);
  });

  it("clamps both panes to the minimum width without changing other panes", () => {
    const input = {
      paneSizes: [0.34, 0.33, 0.33],
      beforeIndex: 1,
      afterIndex: 2,
      startX: 500,
      containerWidth: 1_500,
      minimumPaneWidth: 300,
    } as const;

    expect(resizeAdjacentPanePair({ ...input, currentX: 0 })).toEqual([0.34, 0.2, 0.46]);
    expect(resizeAdjacentPanePair({ ...input, currentX: 1_500 })).toEqual([0.34, 0.46, 0.2]);
  });
});

describe("workspace grid helpers", () => {
  it("builds pane and separator tracks", () => {
    expect(buildWorkspaceGridTemplate([0.6, 0.4])).toBe("minmax(0, 0.6fr) 0px minmax(0, 0.4fr)");
  });

  it("selects the insertion edge from the dragged item center", () => {
    expect(
      resolveWorkspacePaneDropSide({
        draggedLeft: 100,
        draggedWidth: 200,
        paneLeft: 100,
        paneWidth: 600,
      }),
    ).toBe("before");
    expect(
      resolveWorkspacePaneDropSide({
        draggedLeft: 500,
        draggedWidth: 200,
        paneLeft: 100,
        paneWidth: 600,
      }),
    ).toBe("after");
  });
});
