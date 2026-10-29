import type { Knex } from 'knex';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

export interface SharedWorkMeetingDocumentsProvider {
  admitMeetingDocuments(db: Knex, tenant: string, documentIds: string[],
    identify: () => Promise<{ kind: 'session'; tenant: string; userId: string; sessionId: string }
      | { kind: 'api_key'; tenant: string; userId: string; apiKeyId: string }>
  ): Promise<{ handled: false } | { handled: true; deniedDocumentIds: string[] }>;
}

// LEVERAGE: pattern shared-work-seam — scheduling, clients and documents each declare one seam over the same generic registry.
export const meetingDocumentsSeam = sharedWorkSeam<SharedWorkMeetingDocumentsProvider>('meetingDocuments');
