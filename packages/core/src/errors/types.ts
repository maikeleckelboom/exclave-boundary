/**
 * Centralized error type exports.
 *
 * All error types are re-exported from their respective modules.
 * This file serves as a convenient single import point for error types.
 */
export {
  ERROR_META,
  type ErrorCode,
  type ErrorPayload,
  type ErrorDetails,
  type ErrorMeta,
  type TypedArrayName,
} from './registry';

export { interpretHealth, type HealthInterpretation } from './health';

export type * from './codes/primitives';
export type * from './codes/env';
export type * from './codes/plan';
export type * from './codes/backing';
export type * from './codes/handoff';
export type * from './codes/binding';
export type * from './codes/orchestration';
export type * from './codes/diagnostics';
export type * from './codes/internal';
export type * from './codes/spec';
