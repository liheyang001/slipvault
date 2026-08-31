/**
 * The Worker is a single ESM file that expects the Cloudflare runtime, so its
 * pure helpers are lifted out by source rather than imported. Crude, but it
 * covers the two functions whose bugs are invisible in production: a
 * misclassified auth failure sends you looking in the wrong place, and an
 * unvalidated extraction reaches the database as NaN.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'worker', 'index.js'), 'utf8');

function lift<T>(name: string): T {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in worker/index.js`);
  // Walk braces to find the end of the declaration.
  let depth = 0;
  let i = source.indexOf('{', start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  const body = source.slice(open, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return function ${name}${source.slice(source.indexOf('(', start), open)}${body}`)() as T;
}

const classifyAuthFailure = lift<(err: unknown) => string>('classifyAuthFailure');
const extractionProblem = lift<(data: unknown) => string | null>('extractionProblem');

describe('classifyAuthFailure', () => {
  // Every one of these used to collapse into an identical bare 401.
  it.each([
    [{ message: 'Worker misconfigured: GOOGLE_WEB_CLIENT_ID not set' }, 'server-misconfigured'],
    [{ message: 'Missing bearer token' }, 'no-token'],
    [{ message: 'Token missing sub/email' }, 'incomplete-token'],
    [{ code: 'ERR_JWT_EXPIRED' }, 'token-expired'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' }, 'audience-mismatch'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' }, 'issuer-mismatch'],
    [{ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }, 'bad-signature'],
    [{ code: 'ERR_JWKS_NO_MATCHING_KEY' }, 'unknown-signing-key'],
    [{ code: 'ERR_JWT_INVALID' }, 'malformed-token'],
    [{ code: 'SOMETHING_NEW' }, 'unknown'],
  ])('classifies %p', (err, expected) => {
    expect(classifyAuthFailure(err)).toBe(expected);
  });
});

describe('extractionProblem', () => {
  const valid = { isInvoice: true, total: 20, subtotal: 17.39, tax: 2.61, items: [] };

  it('accepts a well-formed extraction', () => {
    expect(extractionProblem(valid)).toBeNull();
  });

  it('accepts isInvoice:false without checking amounts', () => {
    expect(extractionProblem({ isInvoice: false })).toBeNull();
  });

  it.each(['total', 'subtotal', 'tax'])('rejects a missing %s', (field) => {
    const broken: Record<string, unknown> = { ...valid };
    delete broken[field];
    expect(extractionProblem(broken)).toContain(field);
  });

  it.each([NaN, Infinity, '20', null])('rejects a total of %p', (total) => {
    expect(extractionProblem({ ...valid, total })).toBeTruthy();
  });

  it('rejects negatives and non-objects', () => {
    expect(extractionProblem({ ...valid, tax: -1 })).toBe('tax negative');
    expect(extractionProblem(null)).toBe('not an object');
    expect(extractionProblem([])).toBe('not an object');
    expect(extractionProblem({ total: 20 })).toBe('isInvoice missing');
  });

  it('rejects items that are not an array', () => {
    expect(extractionProblem({ ...valid, items: 'nope' })).toBe('items not an array');
  });
});
