/**
 * @fileoverview
 * Playground block slicer for timeline-level scheduled commands.
 */

export interface ScheduledCommandBase {
  /**
   * Absolute frame at which this command should take effect.
   */
  readonly atFrame: number;

  /**
   * Priority used to break ties between commands scheduled at the same frame.
   */
  readonly priority: number;
}

/**
 * A single slice of an audio block on a timeline.
 */
export interface BlockSegment<C extends ScheduledCommandBase> {
  readonly frames: number;
  readonly commandsAfter: readonly C[];
}

/**
 * Per-timeline slicer state.
 */
export interface SlicerState<C extends ScheduledCommandBase> {
  readonly pending: readonly C[];
}

/**
 * Create an empty slicer state.
 */
export function createSlicerState<
  C extends ScheduledCommandBase,
>(): SlicerState<C> {
  return { pending: [] };
}

/**
 * Append newly drained commands to the slicer state.
 */
export function appendCommands<C extends ScheduledCommandBase>(
  state: SlicerState<C>,
  newlyDrained: readonly C[],
): SlicerState<C> {
  if (state.pending.length === 0) {
    return { pending: newlyDrained.slice() };
  }

  if (newlyDrained.length === 0) {
    return state;
  }

  const combined: C[] = [];
  combined.push(...state.pending);
  combined.push(...newlyDrained);
  return { pending: combined };
}

/**
 * Advance the slicer over a single block.
 *
 * @param state        Current slicer state.
 * @param blockStart   Frame index of the first frame in this block.
 * @param blockFrames  Number of frames in this block.
 */
export function sliceBlock<C extends ScheduledCommandBase>(
  state: SlicerState<C>,
  blockStart: number,
  blockFrames: number,
): { segments: BlockSegment<C>[]; nextState: SlicerState<C> } {
  const blockEnd = blockStart + blockFrames;

  const remaining: C[] = [];
  const inBlock: { command: C; effectiveAt: number }[] = [];

  for (const command of state.pending) {
    const { atFrame } = command;

    if (atFrame < blockStart) {
      // Late command: clamp to blockStart so it still fires deterministically.
      inBlock.push({ command, effectiveAt: blockStart });
    } else if (atFrame < blockEnd) {
      inBlock.push({ command, effectiveAt: atFrame });
    } else {
      remaining.push(command);
    }
  }

  // Sort by (effectiveAt, priority).
  inBlock.sort((a, b) => {
    if (a.effectiveAt !== b.effectiveAt) {
      return a.effectiveAt - b.effectiveAt;
    }
    return a.command.priority - b.command.priority;
  });

  const segments: BlockSegment<C>[] = [];
  let cursor = blockStart;
  let i = 0;

  while (i < inBlock.length) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const nextAt = inBlock[i]!.effectiveAt;
    const frames = nextAt - cursor;

    const commandsAtFrame: C[] = [];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (i < inBlock.length && inBlock[i]!.effectiveAt === nextAt) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      commandsAtFrame.push(inBlock[i]!.command);
      i += 1;
    }

    segments.push({
      frames,
      commandsAfter: commandsAtFrame,
    });

    cursor = nextAt;
  }

  const tailFrames = blockEnd - cursor;
  if (tailFrames > 0) {
    segments.push({
      frames: tailFrames,
      commandsAfter: [],
    });
  }

  return {
    segments,
    nextState: { pending: remaining },
  };
}
