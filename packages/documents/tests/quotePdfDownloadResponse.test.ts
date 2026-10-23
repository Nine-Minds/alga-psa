import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildDocumentFileName } from '@alga-psa/core/fileNames';
import { createDocumentDownloadResponse } from '../src/lib/documentDownloadResponse';

const { parse: parseContentDisposition } = createRequire(import.meta.url)('content-disposition') as {
  parse: (header: string) => { parameters: { filename?: string } };
};

describe('quote PDF download Content-Disposition', () => {
  it.each([
    ['stored title', 'Estimate for renovation', 'Q-0042', 'Estimate for renovation.pdf'],
    ['renamed title artifact', 'Renamed estimate', 'Q-0042', 'Renamed estimate.pdf'],
    ['apostrophe', "Bob's estimate", 'Q-0042', "Bob's estimate.pdf"],
    ['parentheses', 'Estimate (revised)', 'Q-0042', 'Estimate (revised).pdf'],
    ['Unicode title', 'Soumission – Été', 'Q-0042', 'Soumission – Été.pdf'],
    ['Unicode with punctuation', "Soumission – Été (Bob's revised estimate)", 'Q-0042', "Soumission – Été (Bob's revised estimate).pdf"],
    ['empty-title fallback', '///:*?', 'Q-0042', 'Quote_Q-0042.pdf'],
  ])('returns the actual attachment header for %s', async (_scenario, title, number, expectedName) => {
    const documentName = buildDocumentFileName(title, `Quote_${number}`);
    const response = createDocumentDownloadResponse(
      Buffer.from('%PDF-quote'),
      { mime_type: 'application/pdf' },
      { file_id: 'stored-quote-pdf', document_name: documentName },
    );

    expect(response.status).toBe(200);
    const contentDisposition = response.headers.get('Content-Disposition');
    expect(contentDisposition).toBeTruthy();
    expect(parseContentDisposition(contentDisposition!).parameters.filename).toBe(expectedName);
    await expect(response.text()).resolves.toBe('%PDF-quote');
  });
});
