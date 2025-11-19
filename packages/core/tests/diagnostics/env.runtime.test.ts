import { describe, it, expect } from 'vitest';

import {
  summarizeEnvFrom,
  assertSharedArrayBufferSupportFromSummary,
  type EnvGlobal,
} from '../../src/diagnostics/env';
import { SeqlokError } from '../../src/errors/error';

describe('env diagnostics', () => {
  it('classifies node-like environment', () => {
    const env = summarizeEnvFrom({
      process: { versions: { node: '20.0.0' } },
      SharedArrayBuffer: (() => undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(env.kind).toBe('node');
    expect(env.hasSharedArrayBuffer).toBe(true);
    expect(env.crossOriginIsolated).toBeUndefined();
  });

  it('classifies browser main thread with COI + SAB', () => {
    const env = summarizeEnvFrom({
      document: {},
      crossOriginIsolated: true,
      SharedArrayBuffer: (() => undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(env.kind).toBe('browser');
    expect(env.hasSharedArrayBuffer).toBe(true);
    expect(env.crossOriginIsolated).toBe(true);
  });

  it('throws env.unsupported when SAB is missing', () => {
    // Simulate a browser-like host without SharedArrayBuffer.
    const summary = summarizeEnvFrom({
      document: {},
      // no SharedArrayBuffer property → hasSharedArrayBuffer === false
    } as EnvGlobal);

    expect(summary.kind).toBe('browser');
    expect(summary.hasSharedArrayBuffer).toBe(false);

    let thrown: unknown;
    try {
      assertSharedArrayBufferSupportFromSummary('test.env.unsupported', summary);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeqlokError);

    const err = thrown as SeqlokError<'env.unsupported'>;
    expect(err.code).toBe('env.unsupported');
    expect(err.details.feature).toBe('SharedArrayBuffer');
    expect(err.details.where).toBe('test.env.unsupported');
  });

  it('throws env.coopCoepRequired when SAB is present but crossOriginIsolated is false', () => {
    // Browser-like host with SAB but missing COOP/COEP (crossOriginIsolated === false).
    const summary = summarizeEnvFrom({
      document: {},
      crossOriginIsolated: false,
      SharedArrayBuffer: (() => undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(summary.kind).toBe('browser');
    expect(summary.hasSharedArrayBuffer).toBe(true);
    expect(summary.crossOriginIsolated).toBe(false);

    let thrown: unknown;
    try {
      assertSharedArrayBufferSupportFromSummary('test.env.coop-coep', summary);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeqlokError);

    const err = thrown as SeqlokError<'env.coopCoepRequired'>;
    expect(err.code).toBe('env.coopCoepRequired');
    expect(err.details.context).toBe('browser');
    expect(err.details.where).toBe('test.env.coop-coep');
  });
});
