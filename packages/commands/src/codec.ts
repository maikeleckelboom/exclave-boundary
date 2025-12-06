/**
 * @fileoverview
 * Codec contract for packing/unpacking commands into fixed-width slots.
 *
 * @remarks
 * The codec is product-defined. It knows how to map a command union onto a
 * sequence of 32-bit words inside a command ring. This module stays free of
 * ring primitives, so it can be used in tests and alternate transports.
 */

/**
 * Decode error reported when the command type is not recognized.
 *
 * @remarks
 * This typically maps to `commands.unknownCommand` when escalated into a
 * SeqlokError.
 */
export interface DecodeErrorUnknownCommand {
  readonly kind: "unknownCommand";

  /**
   * Raw command type / discriminant observed during decoding.
   *
   * @example "lane.play", "engine.setTimeRatio", "0x12"
   */
  readonly commandType: string;
}

/**
 * Decode error reported when the payload fails validation.
 *
 * @remarks
 * This typically maps to `commands.invalidPayload` when escalated into a
 * SeqlokError.
 */
export interface DecodeErrorInvalidPayload {
  readonly kind: "invalidPayload";

  /**
   * Logical command type being decoded when validation failed.
   */
  readonly commandType: string;

  /**
   * Optional human-readable hint describing the validation failure.
   */
  readonly reason?: string;
}

/**
 * Structured decode error surfaced by a CommandCodec.
 */
export type DecodeError = DecodeErrorUnknownCommand | DecodeErrorInvalidPayload;

/**
 * Successful decode result.
 */
export interface DecodeOk<C> {
  readonly ok: true;
  readonly command: C;
}

/**
 * Failed decode result.
 */
export interface DecodeFailure {
  readonly ok: false;
  readonly error: DecodeError;
}

/**
 * Result of attempting to decode a single command from a slot.
 */
export type DecodeResult<C> = DecodeOk<C> | DecodeFailure;

/**
 * Type guard for `DecodeError`.
 */
export function isDecodeError(value: unknown): value is DecodeError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    readonly kind?: unknown;
    readonly commandType?: unknown;
  };

  if (
    candidate.kind !== "unknownCommand" &&
    candidate.kind !== "invalidPayload"
  ) {
    return false;
  }

  return typeof candidate.commandType === "string";
}

/**
 * Codec contract for mapping product-level commands to fixed-width slots.
 *
 * @typeParam C - Discriminated union of product-level command types.
 */
export interface CommandCodec<C> {
  /**
   * Number of 32-bit words consumed per encoded command.
   *
   * @remarks
   * Must match the ring layout's `wordsPerSlot`. This is enforced by the
   * binding layer that wires codecs to concrete rings.
   */
  readonly wordsPerSlot: number;

  /**
   * Encode a command into the destination buffer.
   *
   * @param command - Command to encode.
   * @param dst - Destination view over the ring's slot region.
   * @param wordOffset - Index into `dst` where the encoded payload should start.
   *
   * @remarks
   * Implementations must write exactly `wordsPerSlot` 32-bit words.
   * They must not allocate and must not throw on valid input.
   */
  encode(command: C, dst: Uint32Array, wordOffset: number): void;

  /**
   * Decode a command from the source buffer.
   *
   * @param src - Source view over the ring's slot region.
   * @param wordOffset - Index into `src` where the encoded payload starts.
   *
   * @remarks
   * Implementations must read exactly `wordsPerSlot` 32-bit words and
   * return a structured result instead of throwing when decoding fails.
   */
  decode(src: Uint32Array, wordOffset: number): DecodeResult<C>;
}
