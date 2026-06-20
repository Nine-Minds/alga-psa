import { describe, it, expect } from 'vitest';
import { buildTicketThreadHeaders, capReferences } from '../BaseEmailService';

const ROOT = '<ticket-abc@acme.example>';

describe('capReferences', () => {
  it('keeps the root first and preserves order when under the cap', () => {
    expect(capReferences([ROOT, '<a@x>', '<b@x>'], ROOT)).toEqual([ROOT, '<a@x>', '<b@x>']);
  });

  it('caps to root + the most recent N ids', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`);
    const capped = capReferences([ROOT, ...ids], ROOT, 20);
    expect(capped[0]).toBe(ROOT);
    expect(capped).toHaveLength(21); // root + 20
    expect(capped[capped.length - 1]).toBe('<m29@x>'); // newest retained
    expect(capped).not.toContain('<m9@x>'); // oldest dropped
  });

  it('never duplicates the root even if it appears in the rest', () => {
    expect(capReferences([ROOT, ROOT, '<a@x>'], ROOT)).toEqual([ROOT, '<a@x>']);
  });
});

describe('buildTicketThreadHeaders', () => {
  it('uses the root as In-Reply-To when there are no prior ids', () => {
    const { inReplyTo, references } = buildTicketThreadHeaders(ROOT, []);
    expect(inReplyTo).toBe(ROOT);
    expect(references).toEqual([ROOT]);
  });

  it('points In-Reply-To at the most recent prior id and accumulates References', () => {
    const { inReplyTo, references } = buildTicketThreadHeaders(ROOT, ['<a@x>', '<b@x>']);
    expect(inReplyTo).toBe('<b@x>');
    expect(references).toEqual([ROOT, '<a@x>', '<b@x>']);
  });

  it('dedupes prior ids and ignores the root when choosing In-Reply-To', () => {
    const { inReplyTo, references } = buildTicketThreadHeaders(ROOT, ['<a@x>', '<a@x>', ROOT]);
    expect(inReplyTo).toBe('<a@x>');
    expect(references).toEqual([ROOT, '<a@x>']);
  });

  it('caps the chain while keeping the root anchor', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `<m${i}@x>`);
    const { inReplyTo, references } = buildTicketThreadHeaders(ROOT, ids, 20);
    expect(inReplyTo).toBe('<m24@x>');
    expect(references[0]).toBe(ROOT);
    expect(references).toHaveLength(21);
  });
});
