import { describe, expect, it } from 'vitest';
import {
  assertMicrosoftMessageInMonitoredFolders,
  SourceMessageUnavailableError,
} from '@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor';

describe('Microsoft pointer fetch folder scope', () => {
  it('rejects a forged pointer whose message is outside the monitored folders', async () => {
    const adapter = {
      getMessageParentFolderId: async () => 'unmonitored-folder-id',
      resolveFolderIds: async () => new Set(['inbox-folder-id']),
    };

    await expect(assertMicrosoftMessageInMonitoredFolders(adapter, 'forged-message', ['Inbox']))
      .rejects.toMatchObject<Partial<SourceMessageUnavailableError>>({
        name: 'SourceMessageUnavailableError',
        reason: 'microsoft_message_outside_monitored_folder',
      });
  });

  it('accepts a message in a configured folder', async () => {
    const adapter = {
      getMessageParentFolderId: async () => 'support-folder-id',
      resolveFolderIds: async () => new Set(['support-folder-id']),
    };
    await expect(assertMicrosoftMessageInMonitoredFolders(adapter, 'valid-message', ['Support']))
      .resolves.toBeUndefined();
  });
});
