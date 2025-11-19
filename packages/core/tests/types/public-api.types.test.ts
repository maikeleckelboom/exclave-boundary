import { describe, it, expect } from 'vitest';

import * as seqlok from '../../src/index';

describe('public API surface (runtime exports)', () => {
  it('exports the expected value symbols and nothing else', () => {
    const runtimeExports = Object.keys(seqlok).sort();

    const expectedExports: string[] = [
      // SPEC
      'defineSpec',

      // PLAN
      'planLayout',

      // BACKING
      'allocateShared',
      'allocateSharedPartitioned',
      'allocateWasmShared',

      // BINDING
      'bindController',
      'bindProcessor',

      // HANDOFF
      'buildHandoff',
      'receiveHandoff',
      'verifyHandoff',

      // ERRORS
      'SeqlokError',
      'isSeqlokError',
      'getErrorMeta',
      'getErrorMessage',
      'isErrorCode',
      'interpretHealth',

      // ENUM UTILITIES
      'enumArrayToLabels',
      'enumIndexFromLabel',
      'enumLabelFromIndex',
      'enumValues',
      'enumLabelsToArray',
      'enumPaletteFor',

      // SWSR RING (runtime surface)
      'SWSR_HEADER_WORDS',
      'SWSR_HEADER_WRITE_INDEX',
      'SWSR_HEADER_READ_INDEX',
      'SWSR_HEADER_WRITE_SEQ',
      'SWSR_HEADER_DROPPED',
      'allocateSwsrRing',
      'bindSwsrRingProducer',
      'bindSwsrRingConsumer',

      // DIAGNOSTICS
      'describeViews',
      'probeEnvironment',
      'assertSharedArrayBufferSupport',
    ].sort();

    expect(runtimeExports).toEqual(expectedExports);
  });

  it('does not define a default export', () => {
    expect('default' in seqlok).toBe(false);
  });
});
