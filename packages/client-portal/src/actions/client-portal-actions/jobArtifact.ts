import { JobStatus } from '@alga-psa/types';

export interface JobDetailArtifactRow {
  step_name?: string | null;
  status?: string | null;
  metadata?: unknown;
}

/**
 * The file id a completed job hands back: the last completed step that produced
 * one.
 *
 * Job steps produce intermediate files on the way to the deliverable — an
 * invoice bundle files a PDF per invoice before it files the ZIP — so "the
 * first file_id in an unordered scan" returns whichever row the planner
 * happened to emit first. Rows must be supplied in step-completion order.
 */
export function selectJobArtifactFileId(details: readonly JobDetailArtifactRow[]): string | undefined {
  let fileId: string | undefined;

  for (const detail of details) {
    if (detail.status && detail.status !== JobStatus.Completed) {
      continue;
    }

    let metadata: Record<string, unknown> | undefined;
    if (typeof detail.metadata === 'string') {
      try {
        metadata = JSON.parse(detail.metadata) as Record<string, unknown>;
      } catch {
        // A step whose metadata did not survive round-tripping tells us nothing
        // about the artifact; the remaining steps still might.
        continue;
      }
    } else {
      metadata = detail.metadata as Record<string, unknown> | undefined;
    }

    if (typeof metadata?.file_id === 'string' && metadata.file_id) {
      fileId = metadata.file_id;
    }
  }

  return fileId;
}
