import { describe, expect, it } from 'vitest';
import { buildDocumentFileName } from '@alga-psa/core/fileNames';
import { createDocumentDownloadResponse } from '../src/lib/documentDownloadResponse';

describe('quote PDF download Content-Disposition', () => {
  it.each([
    ['stored title', 'Estimate for renovation', 'Q-0042', 'Estimate for renovation.pdf'],
    ['renamed title artifact', 'Renamed estimate', 'Q-0042', 'Renamed estimate.pdf'],
    ['Unicode title', 'Soumission – Été', 'Q-0042', 'Soumission – Été.pdf'],
    ['empty-title fallback', '///:*?', 'Q-0042', 'Quote_Q-0042.pdf'],
  ])('returns the actual attachment header for %s', async (_scenario, title, number, expectedName) => {
    const documentName = buildDocumentFileName(title, `Quote_${number}`);
    const response = createDocumentDownloadResponse(
      Buffer.from('%PDF-quote'),
      { mime_type: 'application/pdf' },
      { file_id: 'stored-quote-pdf', document_name: documentName },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${expectedName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(expectedName)}`
    );
    expect(decodeURIComponent(response.headers.get('Content-Disposition')!.split("filename*=UTF-8''")[1])).toBe(expectedName);
    await expect(response.text()).resolves.toBe('%PDF-quote');
  });
});
