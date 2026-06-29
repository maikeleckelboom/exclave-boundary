export interface SchedulableCommand {
  readonly scheduledOutputFrame: number;
  readonly sequence: number;
}

export type ScheduleCommandResult = "ready" | "queued" | "dropped";

export interface ScheduledCommandQueueOptions {
  readonly capacity?: number;
}

const DEFAULT_SCHEDULED_COMMAND_CAPACITY = 8;

export class ScheduledCommandQueue<TCommand extends SchedulableCommand> {
  private readonly capacity: number;
  private readonly pending: TCommand[] = [];
  private droppedTotal = 0;

  constructor(options: ScheduledCommandQueueOptions = {}) {
    this.capacity = Math.max(
      1,
      Math.floor(options.capacity ?? DEFAULT_SCHEDULED_COMMAND_CAPACITY),
    );
  }

  get dropped(): number {
    return this.droppedTotal;
  }

  get size(): number {
    return this.pending.length;
  }

  schedule(
    command: TCommand,
    currentOutputFrame: number,
  ): ScheduleCommandResult {
    if (!isFutureFrame(command.scheduledOutputFrame, currentOutputFrame)) {
      return "ready";
    }

    if (this.pending.length >= this.capacity) {
      this.droppedTotal += 1;
      return "dropped";
    }

    this.pending.push(command);
    this.pending.sort(compareScheduledCommands);
    return "queued";
  }

  drainReady(
    currentOutputFrame: number,
    apply: (command: TCommand) => void,
  ): void {
    while (this.pending.length > 0) {
      const next = this.pending[0];

      if (
        !next ||
        isFutureFrame(next.scheduledOutputFrame, currentOutputFrame)
      ) {
        return;
      }

      this.pending.shift();
      apply(next);
    }
  }
}

function isFutureFrame(
  scheduledOutputFrame: number,
  currentOutputFrame: number,
): boolean {
  return (
    Number.isFinite(scheduledOutputFrame) &&
    scheduledOutputFrame > currentOutputFrame
  );
}

function compareScheduledCommands<TCommand extends SchedulableCommand>(
  left: TCommand,
  right: TCommand,
): number {
  return (
    left.scheduledOutputFrame - right.scheduledOutputFrame ||
    left.sequence - right.sequence
  );
}
