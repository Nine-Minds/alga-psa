'use client';

import { useCallback, useMemo, useState } from 'react';
import { dateToWallTimeString, getUserTimeZone, zonedWallTimeToUtc } from '@alga-psa/core';
import { audienceIsInternal, nativeComposerAudiences, type ComposerAudience } from '../CommentAudienceControl';
import { useCommentEmailRecipientsDraft, type CommentEmailRecipientsPayload } from '../CommentEmailRecipientsControl';
import type { TicketNotificationSuppressionValue } from '../TicketNotificationSuppressionControl';
import { useDefaultNotificationSuppression } from '../../../lib/notificationSuppressionDefaults';

export const NO_STATUS_CHANGE = '__no_status_change__';

/** The argument tuple every host hands to `onAddNewComment`. */
export type ComposerSubmitArgs = [
  isInternal: boolean,
  isResolution: boolean,
  closeStatusId?: string | null,
  options?: TicketNotificationSuppressionValue,
  schedule?: { publishAt: string; timeZone: string } | null,
  emailRecipients?: CommentEmailRecipientsPayload,
  audienceId?: ComposerAudience | null,
];

export type ComposerPlacement = 'top' | 'bottom';

export interface TicketCommentComposerParams {
  /** The data source's conversation audiences; `null` means the ordinary Internal switch applies. */
  configuredAudiences: readonly ComposerAudience[] | null;
  /** The host's own condition for showing the audience select (classic also hides it on the portal). */
  audienceSelectable: boolean;
  /** Whether the host offers one-off Cc/Bcc on this composer. */
  allowEmailRecipients: boolean;
  /** The client portal submits `(false, isResolution)` and nothing else. */
  portalSubmit?: boolean;
  /**
   * Visibility to seed when the composer opens without an audience select; `null` leaves it alone.
   * Host policy as data: classic reads the active tab, Bento reads `defaultReplyInternal`.
   */
  seedVisibility?: (wasOpen: boolean) => 'client' | 'internal' | null;
  /** Visibility before the first open (Bento seeds it from `defaultReplyInternal`). */
  initialInternal?: boolean;
}

/**
 * The headless, non-visual state of a ticket comment composer: visibility and audience, resolution,
 * close status, notification suppression, schedule, Cc/Bcc, and the submit argument tuple. Classic
 * `TicketConversation` and `BentoTimelineTile` each keep their own layout and policy and share this.
 */
export function useTicketCommentComposer(params: TicketCommentComposerParams) {
  const { configuredAudiences, audienceSelectable, allowEmailRecipients, portalSubmit = false, seedVisibility, initialInternal = false } = params;

  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<ComposerPlacement>('top');
  const [isInternal, setIsInternal] = useState(initialInternal);
  const [composerAudience, setComposerAudience] = useState<ComposerAudience | null>(null);
  const [isResolution, setIsResolution] = useState(false);
  const [isSchedule, setIsSchedule] = useState(false);
  const [scheduledPublishAt, setScheduledPublishAt] = useState<Date | undefined>(undefined);
  const [resolutionCloseStatusId, setResolutionCloseStatusId] = useState<string>(NO_STATUS_CHANGE);
  const defaultNotificationSuppression = useDefaultNotificationSuppression();
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>(
    defaultNotificationSuppression
  );
  const emailRecipients = useCommentEmailRecipientsDraft();

  // A resolution closes the ticket through the native path, so it never offers `shared_it`.
  const offeredAudiences = configuredAudiences == null
    ? []
    : isResolution ? nativeComposerAudiences(configuredAudiences) : configuredAudiences;
  const chosenAudience = composerAudience != null && offeredAudiences.includes(composerAudience) ? composerAudience : null;
  // Fail closed: a co-managed comment with no audience is never sent.
  const audienceMissing = audienceSelectable && chosenAudience == null;
  const handleAudienceChange = useCallback((next: ComposerAudience) => {
    setComposerAudience(next);
    setIsInternal(audienceIsInternal(next));
  }, []);

  const scheduledInstant = useMemo(() => {
    if (!isSchedule || !scheduledPublishAt) return null;
    try {
      return zonedWallTimeToUtc(dateToWallTimeString(scheduledPublishAt), getUserTimeZone());
    } catch {
      return null;
    }
  }, [isSchedule, scheduledPublishAt]);
  /** True when no schedule is requested or the chosen instant is in the future. Hosts decide whether internal notes skip it. */
  const scheduleInstantValid = !isSchedule || Boolean(scheduledInstant && scheduledInstant.getTime() > Date.now());

  const open = useCallback((nextPlacement: ComposerPlacement) => {
    if (audienceSelectable) {
      // Opening a fresh composer never carries a previous audience; an open draft keeps its choice.
      if (!isOpen) { setComposerAudience(null); setIsInternal(false); }
    } else {
      const seed = seedVisibility?.(isOpen) ?? null;
      if (seed) setIsInternal(seed === 'internal');
    }
    setPlacement(nextPlacement);
    setIsOpen(true);
  }, [audienceSelectable, isOpen, seedVisibility]);

  const buildSubmitArgs = useCallback((): ComposerSubmitArgs => {
    if (portalSubmit) return [false, isResolution];
    const closeStatusId = isResolution && resolutionCloseStatusId !== NO_STATUS_CHANGE ? resolutionCloseStatusId : null;
    return [
      isInternal,
      isResolution,
      closeStatusId,
      closeStatusId && notificationSuppression.suppressContactNotifications ? notificationSuppression : undefined,
      isSchedule && !isInternal && scheduledInstant
        ? { publishAt: scheduledInstant.toISOString(), timeZone: getUserTimeZone() }
        : null,
      // Never sent with an internal note, even though the draft is kept.
      allowEmailRecipients && !isInternal ? emailRecipients.payload : undefined,
      ...(audienceSelectable ? [chosenAudience] as const : []),
    ] as ComposerSubmitArgs;
  }, [portalSubmit, isInternal, isResolution, resolutionCloseStatusId, notificationSuppression, isSchedule, scheduledInstant, allowEmailRecipients, emailRecipients.payload, audienceSelectable, chosenAudience]);

  /** After a confirmed publish. Visibility and open state are the host's: classic resets Internal, Bento keeps it. */
  const resetAfterSubmit = useCallback(() => {
    setComposerAudience(null);
    emailRecipients.reset();
    setIsResolution(false);
    setResolutionCloseStatusId(NO_STATUS_CHANGE);
    setNotificationSuppression(defaultNotificationSuppression());
    setIsSchedule(false);
    setScheduledPublishAt(undefined);
  }, [emailRecipients.reset, defaultNotificationSuppression]);

  return {
    isOpen, setIsOpen, placement, open,
    isInternal, setIsInternal,
    configuredAudiences, audienceSelectable, offeredAudiences, chosenAudience, audienceMissing,
    composerAudience, setComposerAudience, handleAudienceChange,
    isResolution, setIsResolution,
    resolutionCloseStatusId, setResolutionCloseStatusId,
    notificationSuppression, setNotificationSuppression, defaultNotificationSuppression,
    isSchedule, setIsSchedule, scheduledPublishAt, setScheduledPublishAt, scheduledInstant, scheduleInstantValid,
    emailRecipients,
    buildSubmitArgs, resetAfterSubmit,
  };
}

export type TicketCommentComposer = ReturnType<typeof useTicketCommentComposer>;
