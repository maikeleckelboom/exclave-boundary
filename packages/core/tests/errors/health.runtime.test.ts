import { describe, it, expect } from 'vitest';

import {
  interpretHealth,
  isBoundarySafe,
  isRecoverable,
  getDocsUrl,
} from '../../src/errors/health';

import type { ErrorMeta } from '../../src/errors/registry';

function meta(
  overrides: Partial<ErrorMeta> & { severity: ErrorMeta['severity'] },
): ErrorMeta {
  return {
    severity: overrides.severity,
    recoverable: overrides.recoverable ?? false,
    boundarySafe: overrides.boundarySafe ?? false,
    docsUrl: overrides.docsUrl,
    deprecated: overrides.deprecated,
  } as ErrorMeta;
}

describe('interpretHealth', () => {
  it('maps fatal + non-recoverable', () => {
    const m = meta({ severity: 'fatal', recoverable: false, boundarySafe: false });
    const h = interpretHealth(m);

    expect(h.status).toBe('fatal');
    expect(h.label).toBe('Critical');
    expect(h.recoverable).toBe(false);
    expect(h.boundarySafe).toBe(false);
    expect(typeof h.hint).toBe('string');
  });

  it('maps fatal + recoverable', () => {
    const m = meta({ severity: 'fatal', recoverable: true, boundarySafe: false });
    const h = interpretHealth(m);
    expect(h.recoverable).toBe(true);
    expect(h.boundarySafe).toBe(false);
  });

  it('maps error + recoverable/non-recoverable and warning', () => {
    const errRecoverable = interpretHealth(
      meta({ severity: 'error', recoverable: true, boundarySafe: true }),
    );
    const errNonRecoverable = interpretHealth(
      meta({ severity: 'error', recoverable: false, boundarySafe: false }),
    );
    const warn = interpretHealth(
      meta({ severity: 'warning', recoverable: true, boundarySafe: true }),
    );

    expect(errRecoverable.status).toBe('error');
    expect(errNonRecoverable.status).toBe('error');
    expect(warn.status).toBe('warning');
    expect(typeof warn.hint).toBe('string');
  });

  it('delegates to meta for boundarySafe/recoverable/docsUrl helpers', () => {
    const m: ErrorMeta = {
      severity: 'warning',
      recoverable: true,
      boundarySafe: true,
      docsUrl: 'https://example.test/docs',
    };

    expect(isBoundarySafe(m)).toBe(true);
    expect(isRecoverable(m)).toBe(true);
    expect(getDocsUrl(m)).toBe('https://example.test/docs');
  });
});
