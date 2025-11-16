import { createError } from '../errors/error';

export interface ScalarRangeInput {
  readonly min?: number;
  readonly max?: number;
}

export interface ScalarRangeOptions {
  readonly integer: boolean;
}

/**
 * Utility to create ScalarRangeInput without mutation.
 */
export function createRangeInput(min?: number, max?: number): ScalarRangeInput {
  if (min !== undefined && max !== undefined) {
    return { min, max };
  }
  if (min !== undefined) {
    return { min };
  }
  if (max !== undefined) {
    return { max };
  }
  return {};
}

/**
 * Validates scalar range input for f32/i32.
 *
 * - Both bounds (min + max): NaN/Infinity checks, min < max, optional integer checks.
 * - Partial bounds: NaN/Infinity checks, optional integer checks for the provided side.
 */
export function assertValidateScalarRange(
  kindKey: string,
  { min, max }: ScalarRangeInput,
  options?: ScalarRangeOptions,
): void {
  const integer = options?.integer === true;

  if (min !== undefined && max !== undefined) {
    if (Number.isNaN(min) || Number.isNaN(max)) {
      throw createError('spec.rangeInvalid', 'Range cannot contain NaN', {
        key: kindKey,
        min,
        max,
        reason: 'nan',
      });
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw createError('spec.rangeInvalid', 'Range must be finite', {
        key: kindKey,
        min,
        max,
        reason: 'infinite',
      });
    }

    if (!(min < max)) {
      throw createError('spec.rangeInvalid', 'Range must satisfy min < max', {
        key: kindKey,
        min,
        max,
        reason: 'inverted',
      });
    }

    if (integer) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        /* Reuse 'inverted' as the generic "range shape invalid" reason. */
        throw createError('spec.rangeInvalid', 'Integer range must use integer values', {
          key: kindKey,
          min,
          max,
          reason: 'inverted',
        });
      }
    }
  }

  if (min !== undefined) {
    if (Number.isNaN(min)) {
      throw createError('spec.rangeInvalid', 'min cannot be NaN', {
        key: kindKey,
        min,
        reason: 'nan',
      });
    }
    if (!Number.isFinite(min)) {
      throw createError('spec.rangeInvalid', 'min must be finite', {
        key: kindKey,
        min,
        reason: 'infinite',
      });
    }
    if (integer && !Number.isInteger(min)) {
      throw createError('spec.rangeInvalid', 'min must be an integer', {
        key: kindKey,
        min,
        reason: 'inverted',
      });
    }
  }

  if (max !== undefined) {
    if (Number.isNaN(max)) {
      throw createError('spec.rangeInvalid', 'max cannot be NaN', {
        key: kindKey,
        max,
        reason: 'nan',
      });
    }
    if (!Number.isFinite(max)) {
      throw createError('spec.rangeInvalid', 'max must be finite', {
        key: kindKey,
        max,
        reason: 'infinite',
      });
    }
    if (integer && !Number.isInteger(max)) {
      throw createError('spec.rangeInvalid', 'max must be an integer', {
        key: kindKey,
        max,
        reason: 'inverted',
      });
    }
  }
}

/**
 * Validates and normalizes array length for params/meters.
 */
export function parseArrayLen(length: number | { readonly length: number }): number {
  const v = typeof length === 'number' ? length : length.length;

  if (!Number.isFinite(v) || Number.isNaN(v) || !Number.isInteger(v)) {
    throw createError('spec.arrayInvalid', 'Array length must be a positive integer', {
      key: 'array.length',
      length: v,
      reason: 'fractional',
    });
  }

  if (v <= 0) {
    throw createError('spec.arrayInvalid', 'Array length must be a positive integer', {
      key: 'array.length',
      length: v,
      reason: 'nonPositive',
    });
  }

  return v;
}

/**
 * @internal: true for non-array objects (avoids Array.prototype.values shadowing).
 */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Validates enum value lists and guarantees non-empty, non-empty-strings.
 */
export function asNonEmpty<V extends readonly string[]>(values: V): V {
  if (values.length === 0) {
    throw createError('spec.enumInvalid', 'Enum requires at least one value', {
      key: 'enum.values',
      values,
    });
  }

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (typeof v !== 'string' || v.length === 0) {
      throw createError('spec.enumInvalid', 'Enum values must be non-empty strings', {
        key: 'enum.values',
        values,
        invalidIndex: i,
      });
    }
  }

  return values;
}
