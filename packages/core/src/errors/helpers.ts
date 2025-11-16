import { createError } from './error';

import type { EnvUnsupportedDetails } from './codes/env';

export function throwEnvUnsupported(
  feature: EnvUnsupportedDetails['feature'] & (string & {}),
  reason: string,
  cause?: unknown,
): never {
  throw createError(
    'env.unsupported',
    `${feature} unavailable`,
    {
      feature,
      reason,
    } satisfies EnvUnsupportedDetails,
    cause,
  );
}
