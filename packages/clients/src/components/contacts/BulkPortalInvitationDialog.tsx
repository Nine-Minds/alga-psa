'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { IContact } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isValidEmail } from '@alga-psa/validation';
// Through the package entry, like the list that owns this dialog: the relative
// path would pull the server-action graph into every component test that
// renders the Contacts tab.
import { getContactsEligibleForInvitation, sendBulkPortalInvitations } from '@alga-psa/clients/actions';
import type { BulkSendInvitationResult } from '@alga-psa/portal-shared/types';

export type BulkPortalInvitationTarget =
  | { mode: 'selected'; contactIds: string[] }
  | { mode: 'allEligible' };

interface BulkPortalInvitationDialogProps {
  isOpen: boolean;
  clientId: string;
  target: BulkPortalInvitationTarget;
  /** The list's status filter, so a ticked inactive contact is previewed as itself. */
  statusFilter: 'active' | 'inactive' | 'all';
  /** Rows on screen, so a selection can be named even when it is not invitable. */
  contacts: IContact[];
  onClose: () => void;
  onSent: () => void;
}

/** Why a chosen contact will not receive an invitation. */
type SkipReason = 'alreadyHasPortalAccess' | 'missingEmail' | 'sharedMailbox';

/**
 * Confirms a bulk portal invitation before anything is sent, then reports what
 * actually happened per contact. The preview is computed from the same
 * eligibility query the send uses, so the number on the button is the number of
 * emails that go out — not an optimistic count of the rows that were ticked.
 */
const BulkPortalInvitationDialog: React.FC<BulkPortalInvitationDialogProps> = ({
  isOpen,
  clientId,
  target,
  statusFilter,
  contacts,
  onClose,
  onSent,
}) => {
  const { t } = useTranslation('msp/contacts');
  const [eligibleContacts, setEligibleContacts] = useState<IContact[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<BulkSendInvitationResult | null>(null);

  const targetKey = target.mode === 'selected' ? target.contactIds.join(',') : 'all';
  // "Invite all eligible" is the server's own set, which is active contacts
  // only. A named selection is whatever the list was showing, so an inactive
  // contact the user ticked is previewed as invitable rather than reported
  // under the wrong reason.
  const previewStatus = target.mode === 'allEligible' ? 'active' : statusFilter;

  useEffect(() => {
    if (!isOpen) {
      setEligibleContacts(null);
      setLoadError(null);
      setSendResult(null);
      return;
    }

    let isCancelled = false;
    setEligibleContacts(null);
    setLoadError(null);
    getContactsEligibleForInvitation(clientId, previewStatus)
      .then((rows) => {
        if (!isCancelled) setEligibleContacts(rows);
      })
      .catch((err) => {
        console.error('Error loading contacts eligible for portal invitation:', err);
        if (!isCancelled) {
          setLoadError(t('bulkPortalInvitation.errors.loadFailed', {
            defaultValue: 'Could not work out who can be invited. Please try again.',
          }));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, clientId, targetKey, previewStatus, t]);

  const preview = useMemo(() => {
    if (!eligibleContacts) return null;

    const eligibleById = new Map(eligibleContacts.map((contact) => [contact.contact_name_id, contact]));
    const chosen = target.mode === 'selected'
      ? target.contactIds
      : eligibleContacts.map((contact) => contact.contact_name_id);

    const invitable: IContact[] = [];
    const skipped: Array<{ contactId: string; reason: SkipReason }> = [];

    for (const contactId of chosen) {
      const eligible = eligibleById.get(contactId);
      // Not in the eligible set means the contact already has a portal user:
      // the query is "contacts without one".
      if (!eligible) {
        skipped.push({ contactId, reason: 'alreadyHasPortalAccess' });
        continue;
      }
      if (eligible.contact_kind === 'shared_mailbox') {
        skipped.push({ contactId, reason: 'sharedMailbox' });
        continue;
      }
      // Same check the send path runs, so the preview count cannot disagree
      // with the number of emails that actually go out.
      if (!isValidEmail(eligible.email)) {
        skipped.push({ contactId, reason: 'missingEmail' });
        continue;
      }
      invitable.push(eligible);
    }

    const skipCounts = skipped.reduce<Record<SkipReason, number>>(
      (counts, entry) => ({ ...counts, [entry.reason]: counts[entry.reason] + 1 }),
      { alreadyHasPortalAccess: 0, missingEmail: 0, sharedMailbox: 0 },
    );

    return {
      invitable,
      skipped,
      skipCounts,
      groupScoped: invitable.filter((contact) => Boolean(contact.portal_visibility_group_id)).length,
      fullAccess: invitable.filter((contact) => !contact.portal_visibility_group_id).length,
    };
  }, [eligibleContacts, target]);

  const nameOf = useCallback(
    (contactId: string) =>
      eligibleContacts?.find((row) => row.contact_name_id === contactId)?.full_name
      ?? contacts.find((row) => row.contact_name_id === contactId)?.full_name
      ?? contactId,
    [eligibleContacts, contacts],
  );

  const handleSend = async () => {
    if (!preview || preview.invitable.length === 0) return;
    setIsSending(true);
    try {
      // Every contact the user chose goes to the server, not just the ones the
      // preview thinks are invitable: the server is the authority on who is
      // skipped, and the results screen must account for the same people the
      // preview just counted.
      const result = await sendBulkPortalInvitations({
        clientId,
        ...(target.mode === 'selected'
          ? { contactIds: target.contactIds }
          : { allEligible: true }),
      });
      setSendResult(result);
      if (result.sent > 0) onSent();
    } catch (err) {
      console.error('Error sending bulk portal invitations:', err);
      setSendResult({
        success: false,
        total: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        results: [],
        error: t('bulkPortalInvitation.errors.sendFailed', {
          defaultValue: 'Could not send the invitations. Please try again.',
        }),
      });
    } finally {
      setIsSending(false);
    }
  };

  const skipLabels: Record<SkipReason, string> = {
    alreadyHasPortalAccess: t('bulkPortalInvitation.skipReasons.alreadyHasPortalAccess', {
      defaultValue: 'already has portal access',
    }),
    missingEmail: t('bulkPortalInvitation.skipReasons.missingEmail', {
      defaultValue: 'no usable email address',
    }),
    sharedMailbox: t('bulkPortalInvitation.skipReasons.sharedMailbox', {
      defaultValue: 'shared mailbox',
    }),
  };

  const body = () => {
    if (sendResult) {
      return (
        <div className="space-y-3">
          <p className="text-sm">
            {t('bulkPortalInvitation.results.summary', {
              defaultValue: 'Sent {{sent}}, skipped {{skipped}}, failed {{failed}}.',
              sent: sendResult.sent,
              skipped: sendResult.skipped,
              failed: sendResult.failed,
            })}
          </p>
          {sendResult.error && (
            <Alert variant="destructive">
              <AlertDescription>{sendResult.error}</AlertDescription>
            </Alert>
          )}
          {sendResult.results.length > 0 && (
            <ul className="max-h-60 overflow-y-auto space-y-1 text-sm">
              {sendResult.results.map((item) => (
                <li key={item.contactId} className="flex justify-between gap-3 border-b border-gray-100 py-1">
                  <span className="truncate">{item.email || nameOf(item.contactId)}</span>
                  <span className={item.status === 'sent' ? 'text-green-700' : item.status === 'failed' ? 'text-red-700' : 'text-gray-500'}>
                    {item.status === 'sent'
                      ? t('bulkPortalInvitation.results.sent', { defaultValue: 'Sent' })
                      : item.message
                        || (item.status === 'failed'
                          ? t('bulkPortalInvitation.results.failed', { defaultValue: 'Failed' })
                          : t('bulkPortalInvitation.results.skipped', { defaultValue: 'Skipped' }))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    if (loadError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      );
    }

    if (!preview) {
      return (
        <p className="text-sm text-gray-600">
          {t('bulkPortalInvitation.loading', { defaultValue: 'Checking who can be invited...' })}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm">
          {t('bulkPortalInvitation.inviteCount', {
            defaultValue: '{{total}} contacts will be invited to the client portal.',
            total: preview.invitable.length,
          })}
        </p>
        {preview.skipped.length > 0 && (
          <div className="text-sm text-gray-600">
            <p>
              {t('bulkPortalInvitation.skipCount', {
                defaultValue: '{{total}} will be skipped:',
                total: preview.skipped.length,
              })}
            </p>
            <ul className="ml-4 list-disc">
              {(Object.keys(preview.skipCounts) as SkipReason[])
                .filter((reason) => preview.skipCounts[reason] > 0)
                .map((reason) => (
                  <li key={reason}>{`${preview.skipCounts[reason]} — ${skipLabels[reason]}`}</li>
                ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-gray-600">
          {t('bulkPortalInvitation.visibilityNote', {
            defaultValue:
              'Each invitation grants the access the contact already has: {{grouped}} are scoped to a portal visibility group, {{full}} get full access to their client\'s portal data.',
            grouped: preview.groupScoped,
            full: preview.fullAccess,
          })}
        </p>
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id="bulk-portal-invitation-dialog"
      title={t('bulkPortalInvitation.title', { defaultValue: 'Invite contacts to the client portal' })}
      className="max-w-xl"
    >
      <DialogContent>{body()}</DialogContent>
      <DialogFooter>
        {sendResult ? (
          <Button id="bulk-portal-invitation-done" onClick={onClose}>
            {t('common.actions.close', { defaultValue: 'Close' })}
          </Button>
        ) : (
          <>
            <Button
              id="bulk-portal-invitation-send"
              onClick={() => void handleSend()}
              disabled={isSending || !preview || preview.invitable.length === 0}
            >
              {isSending
                ? t('bulkPortalInvitation.actions.sending', { defaultValue: 'Sending...' })
                : t('bulkPortalInvitation.actions.send', {
                  defaultValue: 'Send {{total}} invitations',
                  total: preview?.invitable.length ?? 0,
                })}
            </Button>
            <Button id="bulk-portal-invitation-cancel" variant="secondary" onClick={onClose} disabled={isSending}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default BulkPortalInvitationDialog;
