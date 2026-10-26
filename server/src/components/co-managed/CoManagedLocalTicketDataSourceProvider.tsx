'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IComment } from '@alga-psa/types';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { composeTicketDataSource, type TicketConversationAudiences, type TicketDataSource } from '@alga-psa/tickets/lib/ticketDataSource';
import { NATIVE_TICKET_CAPABILITIES } from '@alga-psa/tickets/lib/ticketDataSource';
import { nativeTicketDataSource } from '@alga-psa/tickets/lib/nativeTicketDataSource';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getCoManagedTicketScreenAction } from '@/lib/actions/coManagedSharedWorkActions';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import CoManagedTicketSection from './CoManagedTicketSection';
import CoManagedEffortSummary from './CoManagedEffortSummary';
import CoManagedThreadDisclosure from './CoManagedThreadDisclosure';
import { newCoManagedOperationId } from './coManagedOperationId';
import { createAttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { createTicketCommentWriter, TicketCommentWriteError } from './ticketCommentWriter';
import SharedCommentAttachmentPicker from './SharedCommentAttachmentPicker';
import CoManagedTicketAttachmentsProvider from './CoManagedTicketAttachmentsProvider';

const ALL_AUDIENCES: CommentAudience[] = ['requester', 'shared_it', 'organization_private'];
const MAX_MAP_PAGES = 20;

type ConversationScreen = Awaited<ReturnType<typeof getCoManagedTicketConversationScreenAction>>;
type ThreadRef = { storeTenant: string; threadId: string };
type KnownComment = { audience: CommentAudience; storeTenant: string; threadId: string; own: boolean; topLevel: boolean };

/** Commentary on `{ actionError }`: the same shape native comment actions return, so the screen's existing error handling shows it. */
const actionError = (message: string) => ({ actionError: message });

type NativeComments = TicketDataSource['comments'];
/**
 * Native comment writes on a co_managed workspace's ticket. The server refuses a requester-visible staff
 * comment that does not name its audience, so these name the one the native composer showed: its Internal
 * switch is the user's explicit choice between requester-visible and private to this organization.
 */
const nativeAudienceComments = (native: NativeComments): Pick<NativeComments, 'addTicketCommentWithCacheForCurrentUser' | 'createComment'> => ({
  addTicketCommentWithCacheForCurrentUser: (ticketIdArg, content, isInternal, isResolution, closesTicket, suppression, schedule, emailRecipients) =>
    native.addTicketCommentWithCacheForCurrentUser(ticketIdArg, content, isInternal, isResolution, closesTicket, suppression, schedule, emailRecipients,
      { audienceId: isInternal ? 'organization_private' : 'requester' }),
  createComment: (comment, emailRecipients) => native.createComment(comment.parent_comment_id ? comment
    : { ...comment, audienceId: comment.is_internal ? 'organization_private' : 'requester' }, emailRecipients),
});

/**
 * Customer-side (local) co-managed ticket: the NATIVE ticket screen with the
 * Internal toggle replaced by the co-managed audience control, audience-aware
 * comment writes, and the Co-managed section slot. Everything not overridden
 * below is the native data source, unchanged.
 *
 * Audience writes go through the existing co-managed comment command
 * (`createCoManagedTicketCommentAction`); this component adds no authority.
 */
/** A co_managed tenant's native ticket screen. `readOnly` is the workspace lifecycle
 * (pending acceptance or ended): the screen then offers no edits the server would refuse. */
export default function CoManagedLocalTicketDataSourceProvider({ ticketId, readOnly = false, children }: {
  ticketId: string; readOnly?: boolean; children: React.ReactNode;
}) {
  const { t } = useTranslation('msp/licensing');
  // Presentation gate only (same flag as CoManagedFeatureBoundary). The provider stays mounted either way so the
  // native screen never remounts when the flag resolves; off or unresolved means the plain native data source.
  const { enabled: flagEnabled, error: flagError } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const enabled = flagEnabled === true && !flagError;
  const tRef = useRef(t);
  tRef.current = t;
  const [screenState, setScreenState] = useState<{ resource: CoManagedSharedResource; customerName: string } | 'failed' | null>(null);
  const [writeAudiences, setWriteAudiences] = useState<CommentAudience[] | null>(null);
  const [disclosure, setDisclosure] = useState<{ thread: ThreadRef; actor: { tenant: string; userId: string }; audiences: CommentAudience[]; done: () => void } | null>(null);
  const known = useRef(new Map<string, KnownComment>());
  const actor = useRef<{ tenant: string; userId: string } | null>(null);
  const resource = useRef<CoManagedSharedResource | null>(null);
  const resourceReady = useRef<Promise<CoManagedSharedResource | null>>(Promise.resolve(null));
  const [draftLimits, setDraftLimits] = useState<ConversationScreen['draftAttachments'] | null>(null);
  const conversationState = useRef<ConversationScreen | null>(null);
  const staging = useMemo(() => createAttachmentStaging(newCoManagedOperationId), [ticketId]);
  const writer = useRef<ReturnType<typeof createTicketCommentWriter> | null>(null);

  const loadConversationMap = useCallback(async (target: CoManagedSharedResource) => {
    let before: Awaited<ReturnType<typeof getCoManagedTicketConversationScreenAction>>['nextBefore'] | undefined;
    const next = new Map<string, KnownComment>();
    let first: ConversationScreen | null = null;
    for (let page = 0; page < MAX_MAP_PAGES; page++) {
      const screen = await getCoManagedTicketConversationScreenAction(target, before ?? undefined);
      first ??= screen;
      for (const item of screen.items) {
        next.set(item.commentId, { audience: item.audience, storeTenant: item.storeTenant, threadId: item.threadId, topLevel: !item.parentCommentId,
          own: item.author?.kind === 'user' && item.author.tenant === screen.actor.tenant && item.author.id === screen.actor.userId });
      }
      if (!screen.nextBefore) break;
      before = screen.nextBefore;
    }
    known.current = next;
    if (first) { actor.current = first.actor; conversationState.current = first; setWriteAudiences(first.writeAudiences); setDraftLimits(first.draftAttachments); }
  }, []);

  useEffect(() => {
    setScreenState(null); setWriteAudiences(null); setDraftLimits(null); known.current = new Map();
    conversationState.current = null; writer.current = null; staging.clear();
    if (!enabled) return;
    let cancelled = false;
    const loading = getCoManagedTicketScreenAction({ kind: 'local', ticketId }).then(async screen => {
      if (cancelled) return null;
      resource.current = screen.summary.resource;
      setScreenState({ resource: screen.summary.resource, customerName: screen.customerName });
      try { await loadConversationMap(screen.summary.resource); } catch { /* audience control stays at its defaults; the server still authorizes each write */ }
      return screen.summary.resource;
    }).catch(() => { if (!cancelled) setScreenState('failed'); return null; });
    resourceReady.current = loading;
    return () => { cancelled = true; };
  }, [ticketId, enabled, loadConversationMap, staging]);

  /** One audience-aware write; returns the new comment id. */
  const writeComment = useCallback(async (input: { content: string; audience: CommentAudience; parentCommentId?: string }): Promise<string> => {
    const target = await resourceReady.current;
    if (!target) throw new Error(tRef.current('coManaged.editor.errors.forbidden'));
    writer.current ??= createTicketCommentWriter({ resource: target, staging,
      context: () => {
        const current = conversationState.current;
        return { canWrite: Boolean(current?.writeAudiences.length), actorTenant: current?.actor.tenant ?? '',
          writeAudiences: current?.writeAudiences ?? [], draftAttachments: current?.draftAttachments ?? { audiences: [], maxFiles: 0, maxBytes: 0 } };
      },
      parent: async commentId => {
        const entry = known.current.get(commentId);
        if (entry) return { storeTenant: entry.storeTenant, threadId: entry.threadId, commentId };
        const comment = await nativeTicketDataSource.comments.findCommentById(commentId);
        return comment?.thread_id ? { storeTenant: target.tenant, threadId: comment.thread_id, commentId } : null;
      },
    });
    try {
      const receipt = await writer.current(input);
      known.current.set(receipt.commentId, { audience: input.audience, storeTenant: receipt.storeTenant, threadId: receipt.threadId,
        topLevel: !input.parentCommentId, own: true });
      return receipt.commentId;
    } catch (error) {
      const code = error instanceof TicketCommentWriteError ? error.code : 'unknownOutcome';
      throw new Error(tRef.current(code === 'unknownOutcome' ? 'coManaged.conversation.unknownOutcome' : `coManaged.editor.errors.${code}`));
    }
  }, [staging]);

  const dataSource = useMemo<TicketDataSource>(() => {
    // Native until the co-managed screen has loaded; a ticket that is not co-managed stays native.
    // A co_managed tenant never has native time-entry authority, so that panel is never offered,
    // and the workspace lifecycle decides whether the screen can write at all.
    if (!enabled || screenState === 'failed') {
      return composeTicketDataSource(nativeTicketDataSource, {
        capabilities: { ...NATIVE_TICKET_CAPABILITIES, timeEntry: false },
        ...(readOnly ? { screen: { readOnly: true } } : {}),
        comments: nativeAudienceComments(nativeTicketDataSource.comments),
      });
    }
    if (!screenState) {
      // Still learning whether this ticket is shared: its audiences are unresolved, so a write
      // fails closed rather than guessing. The composer offers the audience control once loaded.
      const unresolved = async () => actionError(tRef.current('coManaged.conversation.audienceUnresolved')) as never;
      return composeTicketDataSource(nativeTicketDataSource, {
        capabilities: { ...NATIVE_TICKET_CAPABILITIES, timeEntry: false },
        ...(readOnly ? { screen: { readOnly: true } } : {}),
        comments: { addTicketCommentWithCacheForCurrentUser: unresolved, createComment: unresolved },
      });
    }
    const customerName = screenState.customerName;
    const allowed = writeAudiences ?? ALL_AUDIENCES;
    const label = (audience: CommentAudience) => audience === 'organization_private' && customerName
      ? tRef.current('coManaged.section.privateTo', { organization: customerName })
      : tRef.current(`coManaged.conversation.audiences.${audience}`);
    const audienceOf = (comment: IComment): CommentAudience =>
      (comment.comment_id ? known.current.get(comment.comment_id)?.audience : undefined) ?? (comment.is_internal ? 'shared_it' : 'requester');
    const options = allowed.map(audience => ({ id: audience, label: label(audience), internal: audience !== 'requester' }));
    const defaultAudience = allowed.includes('shared_it') ? 'shared_it' : allowed[0];
    // No writable audience (for example a retained read-only ticket): keep the native toggle.
    const audiences: TicketConversationAudiences | undefined = !options.length ? undefined : {
      options,
      defaultId: defaultAudience ?? 'shared_it',
      controlLabel: tRef.current('coManaged.conversation.audience'),
      getCommentAudience: comment => { const audience = audienceOf(comment); return { id: audience, label: label(audience) }; },
      canChangeCommentAudience: comment => {
        const entry = comment.comment_id ? known.current.get(comment.comment_id) : undefined;
        return Boolean(entry?.own && entry.topLevel && allowed.includes(entry.audience));
      },
      changeCommentAudience: comment => new Promise<void>(resolve => {
        const entry = comment.comment_id ? known.current.get(comment.comment_id) : undefined;
        if (!entry || !actor.current) return; // never settles: no reload for a change that did not start
        // The disclosure dialog previews and confirms; the screen reloads only after it saves.
        setDisclosure({ thread: { storeTenant: entry.storeTenant, threadId: entry.threadId }, actor: actor.current,
          audiences: entry.storeTenant === resource.current?.tenant ? allowed : allowed.filter(value => value !== 'organization_private'), done: resolve });
      }),
    };

    const addComment: TicketDataSource['comments']['addTicketCommentWithCacheForCurrentUser'] = async (ticketIdArg, content, _isInternal, isResolution, closesTicket, suppression, schedule, emailRecipients, writeOptions) => {
      const audience = writeOptions?.audienceId as CommentAudience | undefined;
      // Fail closed: a co-managed comment is written only to the audience the composer showed, never a default.
      if (!audience || !allowed.includes(audience)) return actionError(tRef.current('coManaged.conversation.audienceUnresolved')) as never;
      // Scheduling, resolution and per-recipient email are native-only features of a requester-visible comment.
      if (staging.getSnapshot().length && (schedule || isResolution || emailRecipients)) {
        return actionError(tRef.current('coManaged.editor.errors.invalid')) as never;
      }
      if (audience === 'requester' && (schedule || isResolution || emailRecipients)) {
        return nativeTicketDataSource.comments.addTicketCommentWithCacheForCurrentUser(
          ticketIdArg, content, false, isResolution, closesTicket, suppression, schedule, emailRecipients, { audienceId: 'requester' });
      }
      try {
        const commentId = await writeComment({ content, audience });
        const created = await nativeTicketDataSource.comments.findCommentById(commentId);
        return (created ?? actionError(tRef.current('coManaged.editor.errors.unknownOutcome'))) as Awaited<ReturnType<typeof nativeTicketDataSource.comments.addTicketCommentWithCacheForCurrentUser>>;
      } catch (error) {
        return actionError(error instanceof Error ? error.message : tRef.current('coManaged.editor.errors.unknownOutcome')) as never;
      }
    };
    const createComment: TicketDataSource['comments']['createComment'] = async (comment, emailRecipients) => {
      const audience = (comment as { audienceId?: string }).audienceId as CommentAudience | undefined;
      // A reply names its parent's audience; without one the write fails closed (the server re-checks the thread).
      if (!audience || !ALL_AUDIENCES.includes(audience)) return actionError(tRef.current('coManaged.conversation.audienceUnresolved')) as never;
      try {
        return await writeComment({ content: comment.note ?? '', audience, parentCommentId: comment.parent_comment_id ?? undefined });
      } catch (error) {
        return actionError(error instanceof Error ? error.message : tRef.current('coManaged.editor.errors.unknownOutcome')) as never;
      }
    };

    return composeTicketDataSource(nativeTicketDataSource, {
      // A co_managed tenant has no native time-entry authority (scheduling_time_actions is denied), so the native
      // time panel and stopwatch are hidden in both layouts; time is shown as the operational effort split instead.
      capabilities: { ...NATIVE_TICKET_CAPABILITIES, timeEntry: false },
      ...(readOnly ? { screen: { readOnly: true } } : {}),
      comments: { addTicketCommentWithCacheForCurrentUser: addComment, createComment },
      conversation: {
        ...(audiences ? { audiences } : {}),
        composerFooter: ({ audienceId, disabled }) => draftLimits && <SharedCommentAttachmentPicker staging={staging} limits={draftLimits}
          attachable={Boolean(audienceId && draftLimits.audiences.includes(audienceId as CommentAudience))} disabled={disabled} />,
        // The co-managed document model has no images, files or local mentions.
        ...(audiences ? { editor: { disallowImages: true, disallowFiles: true, disallowMentions: true } } : {}),
        formatAuthorLabel: ({ comment, authorName }) => comment.actor_organization_name ? `${authorName} · ${comment.actor_organization_name}` : authorName,
      },
      slots: {
        coManagedSection: ({ layout, refresh }) => <CoManagedTicketSection target={{ kind: 'local', ticketId }} onChanged={refresh} layout={layout} />,
        timeSummary: ({ timeEntriesRefreshKey }) => <CoManagedEffortSummary target={{ kind: 'shared', resource: screenState.resource }} refreshKey={timeEntriesRefreshKey} />,
      },
    });
  }, [enabled, screenState, writeAudiences, ticketId, writeComment, draftLimits, staging]);

  return <TicketDataSourceProvider dataSource={dataSource}>
    <CoManagedTicketAttachmentsProvider resource={enabled && screenState && screenState !== 'failed' ? screenState.resource : null}>
      {children}
    </CoManagedTicketAttachmentsProvider>
    {disclosure && resource.current && <CoManagedThreadDisclosure resource={resource.current} thread={disclosure.thread} actor={disclosure.actor} audiences={disclosure.audiences}
      onClosed={() => setDisclosure(null)} onSaved={() => { const { done } = disclosure; setDisclosure(null); done(); }} />}
  </TicketDataSourceProvider>;
}
