/**
 * @fileoverview
 * Introspect session lifecycle management.
 *
 * @remarks
 * - Tracks the lifecycle and metadata of introspect runs (HUDs, CI, stress tests).
 * - Validates session timestamps via structured introspect.counterInvalid errors.
 * - Integrates with the error registry for consistent introspect reporting.
 */

import {
  createIntrospectError,
  type IntrospectCounterDetails,
} from "./errors/introspect";

/**
 * Metadata for a introspect session.
 *
 * @remarks
 * A session is a period where introspect are actively collecting data.
 * Useful for HUDs, stress tests, or CI runs that sample introspect.
 * @property `startTime` ms since epoch
 * @property `endTime` ms since epoch, or null if active
 */
export interface IntrospectSession {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly metadata: Record<string, unknown>;
}

/**
 * Currently active introspect session, if any.
 */
let activeSession: IntrospectSession | null = null;

const FUTURE_TOLERANCE_MS = 1_000;

/**
 * Validate a timestamp for introspect purposes.
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
function assertValidTimestamp(field: string, timestamp: number): void {
  const now = Date.now();

  const isValid =
    Number.isFinite(timestamp) &&
    timestamp > 0 &&
    timestamp <= now + FUTURE_TOLERANCE_MS;

  if (!isValid) {
    const details: IntrospectCounterDetails = {
      name: `session.${field}`,
      value: timestamp,
    };

    throw createIntrospectError("counterInvalid", details);
  }
}

/**
 * Start a new introspect session.
 *
 * @remarks
 * - Fails if a session is already active.
 * - Validates the supplied startTime.
 *
 * @throws SeqlokError<'introspect.counterInvalid'> on invalid startTime.
 * @throws Error if a session is already active.
 */
export function startIntrospectSession(
  id: string,
  metadata: Record<string, unknown> = {},
  startTime: number = Date.now(),
): IntrospectSession {
  if (activeSession !== null) {
    throw new Error(
      `Cannot start introspect session '${id}': session '${activeSession.id}' is already active`,
    );
  }

  assertValidTimestamp("startTime", startTime);

  const session: IntrospectSession = {
    id,
    startTime,
    endTime: null,
    metadata,
  };

  activeSession = session;
  return session;
}

/**
 * End the active introspect session, if any.
 *
 * @remarks
 * - Validates the supplied endTime.
 * - Ensures endTime >= startTime.
 *
 * @throws SeqlokError<'introspect.counterInvalid'> on invalid endTime.
 */
export function endIntrospectSession(
  endTime: number = Date.now(),
): IntrospectSession | null {
  if (activeSession === null) {
    return null;
  }

  assertValidTimestamp("endTime", endTime);

  if (endTime < activeSession.startTime) {
    const details: IntrospectCounterDetails = {
      name: "session.endTime",
      value: endTime,
    };

    throw createIntrospectError("counterInvalid", details);
  }

  const completed: IntrospectSession = {
    ...activeSession,
    endTime,
  };

  activeSession = null;
  return completed;
}

/**
 * Get the currently active introspect session, if any.
 */
export function getActiveIntrospectSession(): IntrospectSession | null {
  return activeSession;
}

/**
 * Compute the duration (ms) of an introspect session.
 *
 * @remarks
 * For active sessions, uses `Date.now()` as the end.
 */
export function getIntrospectSessionDuration(
  session: IntrospectSession,
): number {
  const end = session.endTime ?? Date.now();
  return end - session.startTime;
}
