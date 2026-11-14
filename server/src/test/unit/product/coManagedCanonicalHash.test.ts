import { expect, it } from 'vitest';
import { canonicalHash, canonicalJson } from '../../../../../packages/co-managed/src/canonicalHash';
import { hash } from '../../../../../packages/co-managed/src/threadDisclosureAdmission';
import { coManagedRequestHash } from '../../../../../packages/co-managed/src/projectTaskAudit';

const resource = { kind: 'ticket' as const, tenant: 't', relationshipId: 'r', id: 'k' };
it('does not depend on key order at any depth, including inside arrays', () => {
  const a = { actor: { userId: 'u', tenant: 't' }, request: { content: { document: [{ type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: 'x', styles: {} }] }] }, audience: 'shared_it' } };
  const b = { request: { audience: 'shared_it', content: { document: [{ content: [{ styles: {}, text: 'x', type: 'text' }], props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' }, type: 'paragraph' }] } },
    actor: { tenant: 't', userId: 'u' } };
  expect(canonicalHash(a)).toBe(canonicalHash(b));
  expect(hash(a)).toBe(hash(b)); // disclosure request_hash and preview snapshot
  expect(coManagedRequestHash('k', resource, a)).toBe(coManagedRequestHash('k', resource, b));
});
it('still tells different values apart, and array order matters', () => {
  expect(canonicalHash({ a: [1, 2] })).not.toBe(canonicalHash({ a: [2, 1] }));
  expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: '1' }));
});
it('serializes exactly as JSON does for non-plain values: a Date is its ISO string and undefined keys vanish', () => {
  const when = new Date('2026-10-26T12:34:56.000Z');
  expect(canonicalJson({ when })).toBe(JSON.stringify({ when }));
  expect(canonicalJson({ b: 1, a: { when, gone: undefined, fn: () => 1 }, list: [undefined, when] })).toBe('{"a":{"when":"2026-10-26T12:34:56.000Z"},"b":1,"list":[null,"2026-10-26T12:34:56.000Z"]}');
  expect(canonicalHash({ x: when, y: undefined })).toBe(canonicalHash({ x: new Date(when), z: undefined }));
  expect(canonicalHash({ x: when })).not.toBe(canonicalHash({ x: {} }));
  expect(canonicalJson(undefined)).toBe('null');
});
