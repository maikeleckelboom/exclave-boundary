import { SeqlokError } from '../../src/errors/error';

import type { ErrorCode, ErrorPayload } from '../../src/errors/registry';

export function expectSeqlokError<C extends ErrorCode>(
  thrown: unknown,
  code: C,
): asserts thrown is SeqlokError<C> {
  if (!(thrown instanceof SeqlokError)) {
    throw new Error(`Expected SeqlokError<${code}>, got ${String(thrown)}`);
  }
  if (thrown.code !== code) {
    throw new Error(`Expected code ${code}, got ${String(thrown.code)}`);
  }
}

export function getDetails<C extends ErrorCode>(err: SeqlokError<C>): ErrorPayload<C> {
  return err.details;
}
