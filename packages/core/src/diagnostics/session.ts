// src/diagnostics/session.ts

import { createError } from '../errors/error';

import type { DiagnosticsCounterDetails } from '../errors/codes/diagnostics';

/**
 * Metadata for a diagnostics session.
 *
 * @remarks
 * A session is a period where diagnostics are actively collecting data.
 * Useful for HUDs, stress tests, or CI runs that sample diagnostics.
 */
export interface DiagnosticsSession {
  readonly id: string;
  readonly startTime: number; // ms since epoch
  readonly endTime: number | null; // ms since epoch, or null if active
  readonly metadata: Record<string, unknown>;
}

/**
 * Currently active diagnostics session, if any.
 */
let activeSession: DiagnosticsSession | null = null;

const FUTURE_TOLERANCE_MS = 1_000;

/**
 * Validate a timestamp for diagnostics purposes.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
function assertValidTimestamp(field: string, timestamp: number): void {
  const now = Date.now();

  const isValid =
    Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + FUTURE_TOLERANCE_MS;

  if (!isValid) {
    const details: DiagnosticsCounterDetails = {
      name: `session.${field}`,
      value: timestamp,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }
}

/**
 * Start a new diagnostics session.
 *
 * @remarks
 * - Fails if a session is already active.
 * - Validates the supplied startTime.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'> on invalid startTime.
 * @throws Error if a session is already active.
 */
export function startDiagnosticsSession(
  id: string,
  metadata: Record<string, unknown> = {},
  startTime: number = Date.now(),
): DiagnosticsSession {
  if (activeSession !== null) {
    throw new Error(
      `Cannot start diagnostics session '${id}': session '${activeSession.id}' is already active`,
    );
  }

  assertValidTimestamp('startTime', startTime);

  const session: DiagnosticsSession = {
    id,
    startTime,
    endTime: null,
    metadata,
  };

  activeSession = session;
  return session;
}

/**
 * End the active diagnostics session, if any.
 *
 * @remarks
 * - Validates the supplied endTime.
 * - Ensures endTime >= startTime.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'> on invalid endTime.
 */
export function endDiagnosticsSession(
  endTime: number = Date.now(),
): DiagnosticsSession | null {
  if (activeSession === null) {
    return null;
  }

  assertValidTimestamp('endTime', endTime);

  if (endTime < activeSession.startTime) {
    const details: DiagnosticsCounterDetails = {
      name: 'session.endTime',
      value: endTime,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }

  const completed: DiagnosticsSession = {
    ...activeSession,
    endTime,
  };

  activeSession = null;
  return completed;
}

/**
 * Get the currently active diagnostics session, if any.
 */
export function getActiveDiagnosticsSession(): DiagnosticsSession | null {
  return activeSession;
}

/**
 * Compute the duration (ms) of a diagnostics session.
 *
 * @remarks
 * For active sessions, uses `Date.now()` as the end.
 */
export function getDiagnosticsSessionDuration(session: DiagnosticsSession): number {
  const end = session.endTime ?? Date.now();
  return end - session.startTime;
}
