export type WorkspacePaneDropSide = "before" | "after";

export interface WorkspacePaneResizeInput {
  readonly paneSizes: ReadonlyArray<number>;
  readonly beforeIndex: number;
  readonly afterIndex: number;
  readonly startX: number;
  readonly currentX: number;
  readonly containerWidth: number;
  readonly minimumPaneWidth: number;
}

export function resizeAdjacentPanePair(input: WorkspacePaneResizeInput): ReadonlyArray<number> {
  const before = input.paneSizes[input.beforeIndex];
  const after = input.paneSizes[input.afterIndex];
  if (
    before === undefined ||
    after === undefined ||
    input.beforeIndex === input.afterIndex ||
    input.containerWidth <= 0
  ) {
    return [...input.paneSizes];
  }

  const pairTotal = before + after;
  const minimum = Math.min(pairTotal / 2, input.minimumPaneWidth / input.containerWidth);
  const delta = (input.currentX - input.startX) / input.containerWidth;
  const nextBefore = Math.max(minimum, Math.min(pairTotal - minimum, before + delta));
  const sizes = [...input.paneSizes];
  sizes[input.beforeIndex] = nextBefore;
  sizes[input.afterIndex] = pairTotal - nextBefore;
  return sizes;
}

export function buildWorkspaceGridTemplate(paneSizes: ReadonlyArray<number>): string {
  return paneSizes.map((size) => `minmax(0, ${size}fr)`).join(" 0px ");
}

export function resolveWorkspacePaneDropSide(input: {
  readonly draggedLeft: number;
  readonly draggedWidth: number;
  readonly paneLeft: number;
  readonly paneWidth: number;
}): WorkspacePaneDropSide {
  const draggedCenter = input.draggedLeft + input.draggedWidth / 2;
  const paneCenter = input.paneLeft + input.paneWidth / 2;
  return draggedCenter < paneCenter ? "before" : "after";
}
