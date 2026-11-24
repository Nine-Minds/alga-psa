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
import {
  getContactsEligibleForInvitation,
  getPortalInvitationStatesForClient,
  sendBulkPortalInvitations,
} from '@alga-psa/clients/actions';
import type {
  BulkSendInvitationResult,
  PortalInvitationContactState,
  PortalInvitationErrorCode,
  PortalInvitationStateTarget,
} from '@alga-psa/portal-shared/types';

export type BulkPortalInvitationTarget =
  | { mode: 'selected'; contactIds: string[] }
  | { mode: 'allEligible' }
  /**
   * The chase-up case: the contacts on screen whose invitation expired or is
   * still pending. `contactIds` is the filtered list the MSP was looking at, so
   * the batch is never wider than that; the states travel with it and the
   * server re-checks both.
   */
  | { mode: 'invitationState'; states: PortalInvitationStateTarget[]; contactIds: string[] };

/**
 * The server's own reasons, in the recipient's language. The per-contact
 * outcomes are shown in this dialog, so they cannot stay English strings from
 * the action; the stable error codes are what gets translated.
 */
const BULK_INVITE_RESULT_KEYS: Partial<Record<PortalInvitationErrorCode, { key: string; defaultValue: string }>> = {
  CONTACT_NOT_FOUND: { key: 'bulkPortalInvitation.results.reasons.contactNotFound', defaultValue: 'Contact not found' },
  CONTACT_MISSING_EMAIL: { key: 'bulkPortalInvitation.results.reasons.missingEmail', defaultValue: 'No email address on the contact' },
  CONTACT_INVALID_EMAIL: { key: 'bulkPortalInvitation.results.reasons.invalidEmail', defaultValue: 'The contact\'s email address is not valid' },
  USER_EXISTS_FOR_CONTACT: { key: 'bulkPortalInvitation.results.reasons.userExists', defaultValue: 'Already has a portal account' },
  PORTAL_USER_ALREADY_EXISTS: { key: 'bulkPortalInvitation.results.reasons.emailInUse', defaultValue: 'The email address belongs to another user' },
  PERMISSION_DENIED_INVITE: { key: 'bulkPortalInvitation.results.reasons.permissionDenied', defaultValue: 'You may not invite this contact' },
  INVITATION_STATE_MISMATCH: { key: 'bulkPortalInvitation.results.reasons.stateMismatch', defaultValue: 'The invitation is no longer in the state you selected' },
  CONTACT_INACTIVE: { key: 'bulkPortalInvitation.results.reasons.inactiveContact', defaultValue: 'The contact is inactive' },
  RATE_LIMITED: { key: 'bulkPortalInvitation.results.reasons.rateLimited', defaultValue: 'Too many invitation attempts for this contact. Try again later.' },
  INVITATION_FAILED: { key: 'bulkPortalInvitation.results.reasons.invitationFailed', defaultValue: 'The invitation could not be sent' },
};

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
type SkipReason = 'alreadyHasPortalAccess' | 'missingEmail' | 'sharedMailbox' | 'emailInUse' | 'inactiveContact';

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
  const [contactStates, setContactStates] = useState<PortalInvitationContactState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<BulkSendInvitationResult | null>(null);

  const targetStates = target.mode === 'invitationState' ? target.states : [];
  const targetKey = target.mode === 'selected'
    ? target.contactIds.join(',')
    : target.mode === 'invitationState'
      ? `state:${targetStates.join(',')}:${target.contactIds.join(',')}`
      : 'all';
  // "Invite all eligible" is the server's own set, which is active contacts
  // only. Every other mode carries ids the list put on screen, so the preview
  // asks for the same statuses the list was showing: otherwise an inactive
  // contact is missing from the eligible rows and gets reported under the wrong
  // reason ("already has portal access") while the server still receives its id.
  const previewStatus = target.mode === 'allEligible' ? 'active' : statusFilter;

  useEffect(() => {
    if (!isOpen) {
      setEligibleContacts(null);
      setContactStates(null);
      setLoadError(null);
      setSendResult(null);
      return;
    }

    let isCancelled = false;
    setEligibleContacts(null);
    setContactStates(null);
    setLoadError(null);
    // The same rules the send runs: who is invitable, whose invitation is in
    // the asked-for state, and whose email the send would refuse. So the count
    // on the button is the number of emails that go out.
    Promise.all([
      getContactsEligibleForInvitation(clientId, previewStatus),
      getPortalInvitationStatesForClient(clientId),
    ])
      .then(([rows, states]) => {
        if (isCancelled) return;
        // A state resend with no states to go on cannot be previewed or counted:
        // say so instead of sitting on "Checking who can be invited..." forever.
        if (target.mode === 'invitationState' && states === null) {
          setLoadError(t('bulkPortalInvitation.errors.statesUnavailable', {
            defaultValue: 'Could not read which invitations are outstanding for this client.',
          }));
          return;
        }
        setEligibleContacts(rows);
        setContactStates(states);
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

  const stateByContactId = useMemo(
    () => new Map((contactStates ?? []).map((entry) => [entry.contactId, entry])),
    [contactStates],
  );

  const preview = useMemo(() => {
    if (!eligibleContacts) return null;
    if (target.mode === 'invitationState' && !contactStates) return null;

    const eligibleById = new Map(eligibleContacts.map((contact) => [contact.contact_name_id, contact]));
    // A state resend acts on the rows the MSP had on screen, narrowed to the
    // states they asked for; "all eligible" is the server's own set.
    const chosen = target.mode === 'selected'
      ? target.contactIds
      : target.mode === 'invitationState'
        ? target.contactIds.filter((contactId) =>
          (targetStates as string[]).includes(stateByContactId.get(contactId)?.state ?? 'none'))
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
      // The send refuses a deactivated contact (its link could never be used),
      // so it is counted as skipped here for the same reason the server gives.
      if (eligible.is_inactive) {
        skipped.push({ contactId, reason: 'inactiveContact' });
        continue;
      }
      // Same check the send path runs, so the preview count cannot disagree
      // with the number of emails that actually go out.
      if (!isValidEmail(eligible.email)) {
        skipped.push({ contactId, reason: 'missingEmail' });
        continue;
      }
      // The send refuses an address another user already owns, so counting it
      // as invitable here would promise an email that never goes out.
      if (stateByContactId.get(contactId)?.emailConflict) {
        skipped.push({ contactId, reason: 'emailInUse' });
        continue;
      }
      invitable.push(eligible);
    }

    const skipCounts = skipped.reduce<Record<SkipReason, number>>(
      (counts, entry) => ({ ...counts, [entry.reason]: counts[entry.reason] + 1 }),
      { alreadyHasPortalAccess: 0, missingEmail: 0, sharedMailbox: 0, emailInUse: 0, inactiveContact: 0 },
    );

    return {
      invitable,
      skipped,
      skipCounts,
      groupScoped: invitable.filter((contact) => Boolean(contact.portal_visibility_group_id)).length,
      fullAccess: invitable.filter((contact) => !contact.portal_visibility_group_id).length,
    };
  }, [eligibleContacts, contactStates, stateByContactId, target, targetStates]);

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
          : target.mode === 'invitationState'
            // The explicit set the MSP saw, plus the states it was chosen by:
            // the server re-checks both before it mails anybody.
            ? { contactIds: target.contactIds, invitationStates: target.states }
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
    emailInUse: t('bulkPortalInvitation.skipReasons.emailInUse', {
      defaultValue: 'email address already belongs to another user',
    }),
    inactiveContact: t('bulkPortalInvitation.skipReasons.inactiveContact', {
      defaultValue: 'inactive contact',
    }),
  };

  const stateLabels: Record<string, string> = {
    pending: t('bulkPortalInvitation.states.pending', { defaultValue: 'Pending' }),
    expired: t('bulkPortalInvitation.states.expired', { defaultValue: 'Expired' }),
  };

  /** The server's own outcome for one contact, in the reader's language. */
  const resultMessage = (item: BulkSendInvitationResult['results'][number]): string => {
    const mapped = item.errorCode ? BULK_INVITE_RESULT_KEYS[item.errorCode] : undefined;
    if (mapped) {
      return t(mapped.key, { defaultValue: mapped.defaultValue });
    }
    return item.message
      || (item.status === 'failed'
        ? t('bulkPortalInvitation.results.failed', { defaultValue: 'Failed' })
        : t('bulkPortalInvitation.results.skipped', { defaultValue: 'Skipped' }));
  };

  // A resend names the exact set it will mail, so the MSP reads the same thing
  // on the button that it chose in the filter.
  const invitationCount = preview?.invitable.length ?? 0;
  const sendLabel = target.mode !== 'invitationState'
    ? t('bulkPortalInvitation.actions.send', {
      defaultValue: 'Send {{total}} invitations',
      total: invitationCount,
    })
    : targetStates.length > 1
      ? t('bulkPortalInvitation.actions.resendOpen', {
        count: invitationCount,
        defaultValue_one: 'Resend {{count}} expired or pending invitation',
        defaultValue_other: 'Resend {{count}} expired or pending invitations',
      })
      : targetStates[0] === 'pending'
        ? t('bulkPortalInvitation.actions.resendPending', {
          count: invitationCount,
          defaultValue_one: 'Resend {{count}} pending invitation',
          defaultValue_other: 'Resend {{count}} pending invitations',
        })
        : t('bulkPortalInvitation.actions.resendExpired', {
          count: invitationCount,
          defaultValue_one: 'Resend {{count}} expired invitation',
          defaultValue_other: 'Resend {{count}} expired invitations',
        });

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
                <li key={item.contactId} className="flex justify-between gap-3 border-b border-[rgb(var(--color-border-100))] py-1">
                  <span className="truncate">{item.email || nameOf(item.contactId)}</span>
                  <span className={item.status === 'sent' ? 'text-[rgb(var(--color-status-success))]' : item.status === 'failed' ? 'text-[rgb(var(--color-status-error))]' : 'text-[rgb(var(--color-text-500))]'}>
                    {item.status === 'sent'
                      ? t('bulkPortalInvitation.results.sent', { defaultValue: 'Sent' })
                      : resultMessage(item)}
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
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('bulkPortalInvitation.loading', { defaultValue: 'Checking who can be invited...' })}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm">
          {target.mode === 'invitationState'
            ? t('bulkPortalInvitation.resendCount', {
              count: preview.invitable.length,
              defaultValue_one:
                '{{count}} contact will get their invitation again, with the full validity period.',
              defaultValue_other:
                '{{count}} contacts will get their invitation again, with the full validity period.',
            })
            : t('bulkPortalInvitation.inviteCount', {
              defaultValue: '{{total}} contacts will be invited to the client portal.',
              total: preview.invitable.length,
            })}
        </p>
        {target.mode === 'invitationState' && preview.invitable.length > 0 && (
          // Who exactly, by name and current state: a count alone leaves the
          // MSP guessing whether the batch matches the list they filtered.
          <ul
            id="bulk-portal-invitation-recipients"
            className="max-h-48 overflow-y-auto space-y-1 text-sm"
          >
            {preview.invitable.map((contact) => (
              <li
                key={contact.contact_name_id}
                className="flex justify-between gap-3 border-b border-[rgb(var(--color-border-100))] py-1"
              >
                <span className="truncate">{contact.full_name}</span>
                <span className="text-[rgb(var(--color-text-500))]">
                  {stateLabels[stateByContactId.get(contact.contact_name_id)?.state ?? ''] ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {preview.skipped.length > 0 && (
          <div className="text-sm text-[rgb(var(--color-text-600))]">
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
        <p className="text-sm text-[rgb(var(--color-text-600))]">
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
      title={target.mode === 'invitationState'
        ? t('bulkPortalInvitation.resendTitle', { defaultValue: 'Resend client portal invitations' })
        : t('bulkPortalInvitation.title', { defaultValue: 'Invite contacts to the client portal' })}
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
                : sendLabel}
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
