'use client';

import type { CoManagedSharedResource, CoManagedCommentReference } from '@alga-psa/co-managed';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { createCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentActions';
import { saveCoManagedPrivateTicketCommentAction } from '@/lib/actions/coManagedPrivateTicketCommentActions';
import { conversationDocument } from './conversationText';
import { newCoManagedOperationId } from './coManagedOperationId';

export type CommentWriteReceipt = { commentId: string; storeTenant: string; threadId: string };
type Result = { ok: false; code: string } | { ok: true; receipt: CommentWriteReceipt };
export type TicketCommentWriteContext = {
  canWrite: boolean;
  actorTenant: string;
  writeAudiences: readonly CommentAudience[];
};
export class TicketCommentWriteError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type CommentMessage = { content: string; audience: CommentAudience; parentCommentId?: string };
export type CommentWriterInput = {
  resource: CoManagedSharedResource;
  context: () => TicketCommentWriteContext;
  parent: (commentId: string) => CoManagedCommentReference | null | Promise<CoManagedCommentReference | null>;
  /** Opaque, writer-kind specific files (a registered file stager owns their meaning). */
  files?: () => readonly unknown[];
};
export type CommentWriter = (message: CommentMessage) => Promise<CommentWriteReceipt>;
/** Builds one stateful writer; state (the pending operation id) lives in the returned closure. */
export type CommentWriterFactory = (input: CommentWriterInput) => CommentWriter;

/** Turns staged files into a draft submission for one writer kind. Native staging registers none yet. */
/** `attachmentIds` is retained by the writer with the pending operation (keyed by staged-entry key): the stager fills it on
 * first use and reads it on a retry, so a replay sends the identical manifest. */
export type FileStager = (input: CommentWriterInput, message: CommentMessage, operationId: string, attachmentIds: Map<string, string>) => Promise<Result>;

const writers = new Map<string, CommentWriterFactory>();
const stagers = new Map<string, FileStager>();

/** Re-registering a kind replaces it, so a feature layer can specialize a kind without a flag. */
export function registerCommentWriter(kind: string, writer: CommentWriterFactory): void { writers.set(kind, writer); }
export function resolveCommentWriter(kind: string): CommentWriterFactory | undefined { return writers.get(kind); }
export function registerFileStager(kind: string, stager: FileStager): void { stagers.set(kind, stager); }
export function resolveFileStager(kind: string): FileStager | undefined { return stagers.get(kind); }
/** Test-only. Restores the shipped state: plain-text writer, no file stagers. */
export function resetCommentWriterRegistry(): void {
  writers.clear(); stagers.clear();
  registerCommentWriter(PLAIN_TEXT_WRITER, createPlainTextWriter);
}

export const PLAIN_TEXT_WRITER = 'plain-text';

/** One captured message intent, shared by native customer and qualified MSP composers. The
 * server admits every command; this retains the same operation across uncertain acknowledgments. */
function createPlainTextWriter(input: CommentWriterInput): CommentWriter {
  const resource = { ...input.resource };
  let pending: { key: string; id: string; attachmentIds: Map<string, string> } | null = null;
  return async message => {
    const fail = (code: string): never => { throw new TicketCommentWriteError(code); };
    const context = input.context();
    if (!context.canWrite || !context.writeAudiences.includes(message.audience)) fail('forbidden');
    const document = conversationDocument(message.content) ?? fail('invalid');
    const parent = message.parentCommentId ? await input.parent(message.parentCommentId) ?? fail('invalid') : undefined;
    // Files need a registered stager for this kind; with none they are refused rather than dropped.
    const staged = input.files?.() ?? [];
    if (staged.length > 0) {
      const stage = resolveFileStager(PLAIN_TEXT_WRITER);
      if (!stage) fail('invalid');
      // The operation id is retained across an uncertain acknowledgement, so the same message + files replays one draft.
      const stagedKey = JSON.stringify([message.content, message.audience, parent ?? null, staged.map(item => (item as { key?: string }).key ?? null)]);
      if (pending?.key !== stagedKey) pending = { key: stagedKey, id: newCoManagedOperationId(), attachmentIds: new Map() };
      const operation = pending, outcome = await stage!(input, message, operation.id, operation.attachmentIds).catch(() => fail('unknownOutcome'));
      if (!outcome.ok) { if (outcome.code !== 'unknownOutcome' && outcome.code !== 'notReady' && pending === operation) pending = null; return fail(outcome.code); }
      if (pending === operation) pending = null;
      return outcome.receipt;
    }
    const key = JSON.stringify([message.content, message.audience, parent ?? null]);
    if (pending?.key !== key) pending = { key, id: newCoManagedOperationId(), attachmentIds: new Map() };
    const operation = pending;
    let result: Result;
    try {
      if (context.actorTenant !== resource.tenant && message.audience === 'organization_private') {
        result = await saveCoManagedPrivateTicketCommentAction(resource, { kind: 'create', operationId: operation.id, document, ...(parent ? { parent } : {}) }) as Result;
      } else {
        result = await createCoManagedTicketCommentAction(resource, parent
          ? { operationId: operation.id, document, parent, expectedAudience: message.audience }
          : { operationId: operation.id, document, audience: message.audience }) as Result;
      }
    } catch { return fail('unknownOutcome'); }
    if (!result.ok) {
      if (result.code !== 'unknownOutcome' && result.code !== 'notReady' && pending === operation) pending = null;
      return fail(result.code);
    }
    if (pending === operation) pending = null;
    return result.receipt;
  };
}

registerCommentWriter(PLAIN_TEXT_WRITER, createPlainTextWriter);

/** Resolve the writer for `kind` (default plain text) and build it. */
export function createTicketCommentWriter(input: CommentWriterInput & { kind?: string }): CommentWriter {
  const factory = resolveCommentWriter(input.kind ?? PLAIN_TEXT_WRITER);
  if (!factory) throw new TicketCommentWriteError('invalid');
  return factory(input);
}
