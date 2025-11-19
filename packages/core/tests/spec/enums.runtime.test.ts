import { describe, it, expect } from 'vitest';

import {
  defineSpec,
  enumValues,
  enumIndexFromLabel,
  enumLabelFromIndex,
  enumArrayToLabels,
  enumLabelsToArray,
  enumPaletteFor,
} from '../../src';
import { SeqlokError } from '../../src/errors/error';
import { enumGuardFor } from '../../src/spec/enums'; // internal helper, not re-exported

const spec = defineSpec(({ param, meter }) => ({
  params: {
    mode: param.enum(['normal', 'stretch', 'freeze']),
  },
  meters: {
    level: meter.f32(),
  },
}));

describe('enum helpers', () => {
  it('round-trips labels and indices', () => {
    const values = enumValues(spec, 'mode');
    expect(values).toEqual(['normal', 'stretch', 'freeze']);

    expect(enumIndexFromLabel(spec, 'mode', 'stretch')).toBe(1);
    expect(enumLabelFromIndex(spec, 'mode', 0)).toBe('normal');

    const indices = enumLabelsToArray(spec, 'mode', ['freeze', 'normal']);
    expect(Array.from(indices)).toEqual([2, 0]);

    const labels = enumArrayToLabels(spec, 'mode', indices);
    expect(labels).toEqual(['freeze', 'normal']);
  });

  it('throws spec.enumInvalid for bad index in enumArrayToLabels', () => {
    const indices = Int32Array.from([0, 99]);

    expect(() => enumArrayToLabels(spec, 'mode', indices)).toThrow(SeqlokError);

    try {
      enumArrayToLabels(spec, 'mode', indices);
    } catch (error) {
      const base = error as SeqlokError;
      expect(base.code).toBe('spec.enumInvalid');

      type EnumInvalidError = SeqlokError<'spec.enumInvalid'>;
      const err = base as EnumInvalidError;

      expect(err.details.key).toBe('mode');
      expect(err.details.invalidIndex).toBe(99);
    }
  });

  it('throws spec.enumInvalid for bad label in enumLabelsToArray', () => {
    const labels = ['normal', 'nope'] as const;

    // @ts-expect-error – intentional invalid label to hit the runtime path
    expect(() => enumLabelsToArray(spec, 'mode', labels)).toThrow(SeqlokError);

    try {
      // @ts-expect-error – intentional invalid label to hit the runtime path
      enumLabelsToArray(spec, 'mode', labels);
    } catch (error) {
      const err = error as SeqlokError;
      expect(err.code).toBe('spec.enumInvalid');
    }
  });

  it('enumPaletteFor and enumGuardFor behave as advertised', () => {
    const palette = enumPaletteFor(spec, 'mode');
    expect(palette.values).toEqual(['normal', 'stretch', 'freeze']);
    expect(palette.indexFrom('freeze')).toBe(2);
    expect(palette.labelFrom(1)).toBe('stretch');
    expect(palette.labelFrom(99)).toBeUndefined();

    const guard = enumGuardFor(spec, 'mode');
    expect(guard('normal')).toBe(true);
    expect(guard('wat')).toBe(false);
  });
});
