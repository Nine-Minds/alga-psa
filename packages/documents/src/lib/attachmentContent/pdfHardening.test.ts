import { describe, expect, it, vi } from 'vitest';
import * as F from './__fixtures__/build';
import { fileSource } from './__fixtures__/sources';
import { DEFAULT_BUDGET, readAttachmentContent } from './index';

const getDocumentProxy = vi.hoisted(() => vi.fn());
vi.mock('unpdf', () => ({ getDocumentProxy }));

describe('pdf.js hardening (R3)', () => {
  it('opens every PDF with isEvalSupported:false (CVE-2024-4367)', async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'a long enough line of text' }] }) }), destroy: async () => undefined });
    await readAttachmentContent([fileSource('a.pdf', 'application/pdf', F.bornDigitalPdf())], { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET);
    expect(getDocumentProxy).toHaveBeenCalledTimes(1);
    expect(getDocumentProxy.mock.calls[0][1]).toMatchObject({ isEvalSupported: false });
  });
});
