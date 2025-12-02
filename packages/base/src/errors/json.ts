/**
 * @fileoverview
 * JSON-safe value types shared by error details and envelopes.
 *
 * @remarks
 * Error payloads should always be representable as plain JSON so they can be
 * sent across postMessage, workers, or persisted in logs without surprises.
 */

/**
 * Primitive JSON values.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Recursive JSON value type.
 *
 * @remarks
 * - Arrays are readonly to discourage accidental mutation.
 * - Objects are readonly and string-keyed.
 */
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
