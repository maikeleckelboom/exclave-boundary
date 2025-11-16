import { describe, it, expect } from 'vitest';

import {
  ERROR_META,
  ERROR_MESSAGES,
  getErrorMeta,
  getErrorMessage,
  isErrorCode,
  type ErrorCode,
  type ErrorMeta,
} from '../../src/errors/registry';

/**
 * Minimal case descriptor you fill in per error code you care about.
 *
 * This lets us pin *semantic* expectations for selected codes,
 * while structural invariants cover the full registry.
 */
interface ErrorRegistryCase<C extends ErrorCode> {
  readonly code: C;
  readonly expectedMeta: Pick<ErrorMeta, 'severity' | 'recoverable' | 'safeToExpose'>;
  readonly messageIncludes?: string | RegExp;
}

/**
 * Curated semantic cases.
 *
 * These are "anchor" codes where the semantics really matter.
 * If you adjust severity/recoverability for these, tests will scream.
 */
const CASES: readonly ErrorRegistryCase<ErrorCode>[] = [
  {
    code: 'env.unsupported',
    expectedMeta: {
      severity: 'fatal',
      recoverable: false,
      safeToExpose: true,
    },
    messageIncludes: /Required env feature unavailable/i,
  },
  {
    code: 'env.coopCoepRequired',
    expectedMeta: {
      severity: 'error',
      recoverable: true,
      safeToExpose: true,
    },
    messageIncludes: /COOP\/COEP headers required/i,
  },
  {
    code: 'backing.wasmMemoryNotShared',
    expectedMeta: {
      severity: 'error',
      recoverable: true,
      safeToExpose: true,
    },
    messageIncludes: /WebAssembly\.Memory is not shared/i,
  },
  {
    code: 'binding.snapshotIntoTypeMismatch',
    expectedMeta: {
      severity: 'error',
      recoverable: true,
      safeToExpose: false,
    },
    messageIncludes: /typed array mismatch/i,
  },
  {
    code: 'binding.snapshotRetryExhausted',
    expectedMeta: {
      severity: 'warning',
      recoverable: true,
      safeToExpose: false,
    },
    messageIncludes: /Snapshot retries exhausted/i,
  },
  {
    code: 'plan.overflowRisk',
    expectedMeta: {
      severity: 'warning',
      recoverable: true,
      safeToExpose: true,
    },
    messageIncludes: /soft limit/i,
  },
  {
    code: 'spec.builderInvalid',
    expectedMeta: {
      severity: 'error',
      recoverable: false,
      safeToExpose: false,
    },
    messageIncludes: /Spec builder validation failed/i,
  },
  {
    code: 'internal.unreachable',
    expectedMeta: {
      severity: 'fatal',
      recoverable: false,
      safeToExpose: false,
    },
    messageIncludes: /Unreachable code executed/i,
  },
  {
    code: 'orchestration.createFailed',
    expectedMeta: {
      severity: 'error',
      recoverable: true,
      safeToExpose: true,
    },
    messageIncludes: /creation\/orchestration failed/i,
  },
  {
    code: 'diagnostics.counterInvalid',
    expectedMeta: {
      severity: 'warning',
      recoverable: true,
      safeToExpose: false,
    },
    messageIncludes: /Diagnostics counter invalid/i,
  },
];

/**
 * Helper: get all codes from the registry maps in a type-safe-ish way.
 *
 * NOTE: This reflects the runtime map, not the ErrorCode union directly.
 * The ErrorCode → map alignment is guaranteed at compile-time by registry.ts.
 */
function getAllCodes(): ErrorCode[] {
  return Object.keys(ERROR_META) as ErrorCode[];
}

describe('error registry – structural invariants', () => {
  it('has matching keys between ERROR_META and ERROR_MESSAGES', () => {
    const codesFromMeta = Object.keys(ERROR_META).sort();
    const codesFromMessages = Object.keys(ERROR_MESSAGES).sort();

    expect(codesFromMeta).toEqual(codesFromMessages);
  });

  it('contains only unique codes', () => {
    const allCodes = getAllCodes();
    const unique = new Set(allCodes);

    expect(unique.size).toBe(allCodes.length);
  });

  it('exposes meta and messages for every registered error code', () => {
    const allCodes = getAllCodes();

    for (const code of allCodes) {
      const meta = ERROR_META[code];
      const msg = ERROR_MESSAGES[code];

      expect(meta).toBeDefined();
      expect(typeof meta.severity).toBe('string');
      expect(typeof meta.recoverable).toBe('boolean');
      expect(typeof meta.safeToExpose).toBe('boolean');

      expect(msg).toBeDefined();
      expect(typeof msg).toBe('string');
    }
  });

  it('getErrorMeta/getErrorMessage and isErrorCode stay aligned with the registry', () => {
    const allCodes = getAllCodes();

    for (const code of allCodes) {
      expect(isErrorCode(code)).toBe(true);
      expect(getErrorMeta(code)).toBe(ERROR_META[code]);
      expect(getErrorMessage(code)).toBe(ERROR_MESSAGES[code]);
    }

    // A few obviously invalid values to exercise the negative branch.
    const invalidSamples: readonly string[] = [
      'nope.not.a.code',
      'binding.unknown_code',
      '',
      'env',
      'layout',
    ];

    for (const candidate of invalidSamples) {
      expect(isErrorCode(candidate)).toBe(false);
    }
  });
});

describe('error registry – semantic expectations (selected codes)', () => {
  it.each(CASES)('matches meta and message semantics for $code', (testCase) => {
    const { code, expectedMeta, messageIncludes } = testCase;

    const meta = getErrorMeta(code);
    expect(meta.severity).toBe(expectedMeta.severity);
    expect(meta.recoverable).toBe(expectedMeta.recoverable);
    expect(meta.safeToExpose).toBe(expectedMeta.safeToExpose);

    if (messageIncludes !== undefined) {
      const msg = getErrorMessage(code);
      if (typeof messageIncludes === 'string') {
        expect(msg).toContain(messageIncludes);
      } else {
        expect(msg).toMatch(messageIncludes);
      }
    }
  });
});

describe('error registry – domain-level invariants by prefix', () => {
  it('internal.* errors are always fatal, non-recoverable and not safe to expose', () => {
    for (const code of getAllCodes()) {
      if (code.startsWith('internal.')) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe('fatal');
        expect(meta.recoverable).toBe(false);
        expect(meta.safeToExpose).toBe(false);
      }
    }
  });

  it('spec.* errors are non-recoverable (author-time validation failures)', () => {
    for (const code of getAllCodes()) {
      if (code.startsWith('spec.')) {
        const meta = getErrorMeta(code);
        expect(meta.recoverable).toBe(false);
      }
    }
  });

  it('diagnostics.* errors are warnings, recoverable, and not safe to expose', () => {
    for (const code of getAllCodes()) {
      if (code.startsWith('diagnostics.')) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe('warning');
        expect(meta.recoverable).toBe(true);
        expect(meta.safeToExpose).toBe(false);
      }
    }
  });

  it('env.* errors are safe to expose (they are about environment setup)', () => {
    for (const code of getAllCodes()) {
      if (code.startsWith('env.')) {
        const meta = getErrorMeta(code);
        expect(meta.safeToExpose).toBe(true);
      }
    }
  });

  it('binding.snapshotInto* and binding.*Retry* are not safe to expose (diagnostic detail only)', () => {
    for (const code of getAllCodes()) {
      if (
        code.startsWith('binding.snapshotInto') ||
        code === 'binding.snapshotRetryExhausted' ||
        code === 'binding.coherentRetryExhausted'
      ) {
        const meta = getErrorMeta(code);
        expect(meta.safeToExpose).toBe(false);
      }
    }
  });

  it('handoff.* errors are non-recoverable and safe to expose (handshake contract failures)', () => {
    for (const code of getAllCodes()) {
      if (code.startsWith('handoff.')) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe('error');
        expect(meta.recoverable).toBe(false);
        expect(meta.safeToExpose).toBe(true);
      }
    }
  });
});
