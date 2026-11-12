import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  runWithTenant: vi.fn(async (_tenant: string, cb: () => Promise<unknown>) => cb()),
  generate: vi.fn(),
  scheduleJob: vi.fn(),
  getJobRunner: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({ runWithTenant: h.runWithTenant }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/documents/lib/documentPreviewGenerator', () => ({ generatePreviewsForDocument: h.generate }));
vi.mock('@alga-psa/jobs/runner', () => ({ getJobRunner: h.getJobRunner }));

import { generateDocumentPreviewsHandler } from '../../../lib/jobs/handlers/generateDocumentPreviewsHandler';
import {
  GENERATE_DOCUMENT_PREVIEWS_JOB,
  scheduleDocumentPreviews,
} from '@alga-psa/documents/lib/documentPreviewJob';

describe('generate-document-previews job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getJobRunner.mockResolvedValue({ scheduleJob: h.scheduleJob });
  });

  it('runs generatePreviewsForDocument inside the tenant context', async () => {
    h.generate.mockResolvedValue({ thumbnail_file_id: 't', preview_file_id: 'p' });

    await generateDocumentPreviewsHandler({ tenantId: 'tenant-1', documentId: 'doc-1' });

    expect(h.runWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(h.generate).toHaveBeenCalledWith('doc-1');
  });

  it('rethrows generation failures so the runner retries', async () => {
    h.generate.mockRejectedValue(new Error('ffmpeg exploded'));
    await expect(generateDocumentPreviewsHandler({ tenantId: 'tenant-1', documentId: 'doc-1' })).rejects.toThrow('ffmpeg exploded');
  });

  it('enqueues by tenant + document id and never throws when the runner is unavailable', async () => {
    h.scheduleJob.mockResolvedValue({ jobId: 'j1', externalId: null });
    expect(await scheduleDocumentPreviews('tenant-1', 'doc-1', 'user-1')).toBe(true);
    expect(h.scheduleJob).toHaveBeenCalledWith(
      GENERATE_DOCUMENT_PREVIEWS_JOB,
      { tenantId: 'tenant-1', documentId: 'doc-1' },
      { userId: 'user-1' },
    );

    h.getJobRunner.mockRejectedValue(new Error('Job runner accessor has not been registered'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await scheduleDocumentPreviews('tenant-1', 'doc-1')).toBe(false);
  });

  it('is registered with the shared handler registry and listed as available', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../lib/jobs/registerAllHandlers.ts'), 'utf8');
    expect(source).toContain('name: GENERATE_DOCUMENT_PREVIEWS_JOB,');
    expect(source).toContain('    GENERATE_DOCUMENT_PREVIEWS_JOB,\n    KB_ARTICLE_IMPORT_JOB,');
  });

  it('the EE Temporal worker forwards the same job name to the server', () => {
    const activities = fs.readFileSync(
      path.resolve(__dirname, '../../../../../ee/temporal-workflows/src/activities/job-activities.ts'),
      'utf8',
    );
    expect(GENERATE_DOCUMENT_PREVIEWS_JOB).toBe('generate-document-previews');
    expect(activities).toContain(
      "registerJobHandlerForActivities('generate-document-previews', forwardJobToServer('generate-document-previews'));",
    );
  });
});
