'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { PartialBlock } from '@blocknote/core';
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
  // Content a prefill staged before the editor mounted; the host seeds `initialContent` from it.
  const [pendingContent, setPendingContent] = useState<PartialBlock[] | null>(null);

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
    setPendingContent(null);
  }, [emailRecipients.reset, defaultNotificationSuppression]);

  return {
    isOpen, setIsOpen, placement, open,
    isInternal, setIsInternal,
    configuredAudiences, audienceSelectable, portalSubmit, offeredAudiences, chosenAudience, audienceMissing,
    composerAudience, setComposerAudience, handleAudienceChange,
    isResolution, setIsResolution,
    resolutionCloseStatusId, setResolutionCloseStatusId,
    notificationSuppression, setNotificationSuppression, defaultNotificationSuppression,
    isSchedule, setIsSchedule, scheduledPublishAt, setScheduledPublishAt, scheduledInstant, scheduleInstantValid,
    emailRecipients,
    pendingContent, setPendingContent,
    buildSubmitArgs, resetAfterSubmit,
  };
}

export type TicketCommentComposer = ReturnType<typeof useTicketCommentComposer>;

// ---------------------------------------------------------------------------------------------
// Prefill (`base-composer-prefill`): a handle a host's caller uses to put text, and optionally
// visibility / audience / resolution, into the composer. No caller exists in this card.
// ---------------------------------------------------------------------------------------------

export interface TicketComposerPrefill {
  content: PartialBlock[];
  visibility?: 'client' | 'internal';
  audience?: ComposerAudience;
  resolution?: boolean;
}

export type TicketComposerPrefillResult = { ok: true } | { ok: false; reason: 'dirty' | 'read-only' };

export interface TicketComposerHandle {
  prefill(prefill: TicketComposerPrefill, opts?: { replace?: boolean }): TicketComposerPrefillResult;
  isOpen(): boolean;
  hasContent(): boolean;
}

/** The slice of BlockNote's editor a prefill needs; keeps this file free of editor internals. */
export interface PrefillEditor {
  document: ReadonlyArray<{ id: string }>;
  replaceBlocks(blocksToRemove: string[], blocksToInsert: PartialBlock[]): void;
}

export interface ComposerPrefillParams {
  composer: TicketCommentComposer;
  /** A read-only screen refuses. */
  readOnly: boolean;
  /** The guard's tracked state: whether the editor holds typed text. */
  hasContent: boolean;
  editorRef: MutableRefObject<PrefillEditor | null>;
  /**
   * What the host does with changed draft content (classic: track + forward; Bento: also arm Send).
   * Called with the prefilled content so the submit path sends what is shown.
   */
  onContentChange: (content: PartialBlock[]) => void;
}

/**
 * Rules: refuse when read-only; refuse a dirty composer unless `replace`; open a closed composer keeping the
 * current placement; apply resolution, then audience through the controller's own rules (an audience that is
 * not offered is dropped, so resolution + `shared_it` keeps the resolution and drops the audience); a bare
 * visibility is ignored when an audience is required or on the portal, which cannot post internally. Never
 * confirms: whether to ask first is the caller's UI.
 */
export function useComposerPrefill({ composer, readOnly, hasContent, editorRef, onContentChange }: ComposerPrefillParams): TicketComposerHandle {
  const latest = useRef({ composer, readOnly, hasContent, onContentChange });
  latest.current = { composer, readOnly, hasContent, onContentChange };

  return useMemo<TicketComposerHandle>(() => ({
    prefill(prefill, opts) {
      const { composer: c, readOnly: ro, hasContent: dirty, onContentChange: changed } = latest.current;
      if (ro) return { ok: false, reason: 'read-only' };
      if (dirty && !opts?.replace) return { ok: false, reason: 'dirty' };

      if (!c.isOpen) c.open(c.placement);
      if (prefill.resolution != null) c.setIsResolution(prefill.resolution);
      if (prefill.audience != null && c.audienceSelectable) {
        const nativeOnly = (prefill.resolution ?? c.isResolution) && prefill.audience === 'shared_it';
        const offered = c.configuredAudiences != null && c.configuredAudiences.includes(prefill.audience) && !nativeOnly;
        if (offered) c.handleAudienceChange(prefill.audience);
      } else if (prefill.visibility != null && !c.audienceSelectable && !c.portalSubmit) {
        c.setIsInternal(prefill.visibility === 'internal');
      }

      const editor = editorRef.current;
      if (editor) editor.replaceBlocks(editor.document.map((block) => block.id), prefill.content);
      else c.setPendingContent(prefill.content);
      changed(prefill.content);
      return { ok: true };
    },
    isOpen: () => latest.current.composer.isOpen,
    hasContent: () => latest.current.hasContent,
  }), [editorRef]);
}
