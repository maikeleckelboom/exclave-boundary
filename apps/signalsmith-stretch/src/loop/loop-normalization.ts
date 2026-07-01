export interface ActiveLoopRange {
  readonly endFrame: number;
  readonly startFrame: number;
}

export function isActiveLoopRange(range: ActiveLoopRange): boolean {
  return range.endFrame > range.startFrame;
}

export function sourceFrameInsideLoopRange(
  sourceFrame: number,
  range: ActiveLoopRange,
): boolean {
  return (
    isActiveLoopRange(range) &&
    sourceFrame >= range.startFrame &&
    sourceFrame < range.endFrame
  );
}

export function normalizeSeekFrameIntoLoopRange(
  sourceFrame: number,
  range: ActiveLoopRange,
): number {
  if (!isActiveLoopRange(range)) {
    return sourceFrame;
  }

  if (sourceFrame < range.startFrame) {
    return range.startFrame;
  }

  if (sourceFrame < range.endFrame) {
    return sourceFrame;
  }

  const length = range.endFrame - range.startFrame;
  return range.startFrame + ((sourceFrame - range.startFrame) % length);
}

export function wrapFrameIntoLoopRange(
  sourceFrame: number,
  range: ActiveLoopRange,
): number {
  if (!isActiveLoopRange(range)) {
    return sourceFrame;
  }

  const length = range.endFrame - range.startFrame;
  const offset = positiveModulo(sourceFrame - range.startFrame, length);
  return range.startFrame + offset;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
