/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('resolution comment close contract', () => {
  it('T049: bento comment callbacks carry closeStatusId and suppression options', () => {
    const tile = read('./BentoTimelineTile.tsx');
    const layout = read('./TicketBentoLayout.tsx');

    expect(tile).toContain('closeStatusId?: string | null');
    expect(tile).toContain('options?: TicketNotificationSuppressionValue');
    expect(layout).toContain('closeStatusId?: string | null');
    expect(layout).toContain('options?: TicketNotificationSuppressionValue');
    expect(layout).toContain('onAddNewComment={props.onAddNewComment}');
  });

  it('T050: closed statuses are threaded into the grid composer select', () => {
    const details = read('../TicketDetails.tsx');
    const layout = read('./TicketBentoLayout.tsx');
    const tile = read('./BentoTimelineTile.tsx');

    expect(details).toContain('closedStatusOptions={closedStatusOptions}');
    expect(layout).toContain('closedStatusOptions?: { value: string; label: string }[]');
    expect(layout).toContain('closedStatusOptions={props.closedStatusOptions}');
    expect(tile).toContain('closedStatusOptions = []');
    expect(tile).toContain('id={`${id}-composer-close-status-select`}');
    expect(tile).toContain('...closedStatusOptions');
  });

  it('T051/T052/T053: resolution close uses the shared ticket status update path and forwards suppression', () => {
    const details = read('../TicketDetails.tsx');
    const tile = read('./BentoTimelineTile.tsx');

    expect(details).toContain('metadata: { closes_ticket: true }');
    expect(details).toContain("await handleSelectChange('status_id', closeStatusId, true)");
    expect(details).toContain('{ skipResolutionPrompt: true }');
    expect(tile).toContain('const success = await onAddNewComment(');
    expect(tile).toContain('closeStatusId && notificationSuppression.suppressContactNotifications');
    expect(tile).toContain('? notificationSuppression');
  });

  it('T054: entry resolution composer exposes and forwards the same suppression control', () => {
    const conversation = read('../TicketConversation.tsx');

    expect(conversation).toContain('TicketNotificationSuppressionControl');
    expect(conversation).toContain('idPrefix={`${compId}-resolution-notification-suppression`}');
    expect(conversation).toContain('const suppressionOptions =');
    expect(conversation).toContain('suppressionOptions');
    expect(conversation).toContain('setNotificationSuppression(defaultNotificationSuppression())');
  });

  it('T055: no close status selected keeps a resolution comment as comment-only', () => {
    const conversation = read('../TicketConversation.tsx');
    const tile = read('./BentoTimelineTile.tsx');

    expect(conversation).toContain('value: NO_STATUS_CHANGE');
    expect(conversation).toContain(': null;');
    expect(tile).toContain('value: NO_STATUS_CHANGE');
    expect(tile).toContain(': null;');
  });

  it('T037: suppression controls default back to unchecked on each operation surface', () => {
    const sources = [
      '../TicketInfo.tsx',
      './BentoHero.tsx',
      '../TicketConversation.tsx',
      './BentoTimelineTile.tsx',
      '../../BulkChangeStatusDialog.tsx',
      '../../BulkChangePriorityDialog.tsx',
      '../../BulkAssignTicketsDialog.tsx',
      '../../BulkSetDueDateDialog.tsx',
      '../../TicketingDashboard.tsx',
    ].map(read);

    for (const source of sources) {
      expect(source).toContain('suppressContactNotifications: false');
      expect(source).toContain('suppressInternalNotifications: false');
    }

    expect(read('../TicketConversation.tsx')).toContain('setNotificationSuppression(defaultNotificationSuppression())');
    expect(read('./BentoTimelineTile.tsx')).toContain('setNotificationSuppression(defaultNotificationSuppression())');
    expect(read('./BentoHero.tsx')).toContain('setNotificationSuppression(defaultNotificationSuppression())');
    expect(read('../../TicketingDashboard.tsx')).toContain('setBulkMoveNotificationSuppression(defaultNotificationSuppression())');
  });

  it('prompts for and records a resolution before a status-based close', () => {
    const details = read('../TicketDetails.tsx');
    const dialog = read('../TicketResolutionDialog.tsx');

    expect(details).toContain('await addResolutionBeforeClose(targetStatusId)');
    expect(details).toContain('addTicketCommentWithCache(');
    expect(details).toContain('<TicketResolutionDialog');
    expect(details).toContain('check = await checkTicketClosure(ticket.ticket_id, targetStatusId)');
    expect(dialog).toContain("title={t('info.closeTicketTitle', 'Close ticket')}");
    expect(dialog).toContain('footer={footer}');
    expect(dialog).toContain('disabled={!trimmedResolution}');
  });
});
