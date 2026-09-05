import { describe, expect, it } from 'vitest';
import { JobStatus } from '@alga-psa/types';
import { selectJobArtifactFileId } from './jobArtifact';

describe('selectJobArtifactFileId', () => {
  it('returns the last artifact, not the first, so an invoice bundle yields the ZIP', () => {
    const details = [
      { step_name: 'generate_invoice_pdf_1', status: JobStatus.Completed, metadata: { file_id: 'pdf-1' } },
      { step_name: 'generate_invoice_pdf_2', status: JobStatus.Completed, metadata: { file_id: 'pdf-2' } },
      { step_name: 'create_zip', status: JobStatus.Completed, metadata: { file_id: 'zip-1' } },
    ];

    expect(selectJobArtifactFileId(details)).toBe('zip-1');
  });

  it('parses string metadata the same as jsonb metadata', () => {
    const details = [
      { step_name: 'generate_invoice_pdf_1', status: JobStatus.Completed, metadata: JSON.stringify({ file_id: 'pdf-1' }) },
      { step_name: 'create_zip', status: JobStatus.Completed, metadata: JSON.stringify({ file_id: 'zip-1' }) },
    ];

    expect(selectJobArtifactFileId(details)).toBe('zip-1');
  });

  it('ignores steps that did not complete', () => {
    const details = [
      { step_name: 'create_zip', status: JobStatus.Completed, metadata: { file_id: 'zip-1' } },
      { step_name: 'create_zip', status: JobStatus.Failed, metadata: { file_id: 'zip-retry' } },
    ];

    expect(selectJobArtifactFileId(details)).toBe('zip-1');
  });

  it('skips steps whose metadata is unparseable rather than aborting the scan', () => {
    const details = [
      { step_name: 'create_zip', status: JobStatus.Completed, metadata: '{not json' },
      { step_name: 'publish', status: JobStatus.Completed, metadata: { file_id: 'zip-1' } },
    ];

    expect(selectJobArtifactFileId(details)).toBe('zip-1');
  });

  it('returns undefined when no step produced a file', () => {
    const details = [
      { step_name: 'send_email', status: JobStatus.Completed, metadata: { details: 'sent' } },
      { step_name: 'send_email', status: JobStatus.Completed, metadata: null },
    ];

    expect(selectJobArtifactFileId(details)).toBeUndefined();
  });

  it('ignores a non-string or empty file_id', () => {
    const details = [
      { step_name: 'a', status: JobStatus.Completed, metadata: { file_id: 42 } },
      { step_name: 'b', status: JobStatus.Completed, metadata: { file_id: '' } },
    ];

    expect(selectJobArtifactFileId(details)).toBeUndefined();
  });
});
