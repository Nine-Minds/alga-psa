'use server'

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import type {
  CannedResponseListItem,
  CannedResponseMergeContext,
  CannedResponsePickerItem,
  CannedResponseScope,
  CannedResponseSurface,
  ICannedResponse,
} from '@alga-psa/types';
import {
  cannedResponseInputSchema,
  type CannedResponseInput,
  type ParsedCannedResponseInput,
} from '../lib/cannedResponses/cannedResponseSchema';
import { authorizeTicketRecordAccess } from '../lib/ticketRecordAuthorization';
import { loadCannedMergeContext } from '../lib/cannedResponses/mergeContext';
import {
  applyVisibilityToQuery,
  libraryVisibility,
  pickerVisibility,
  type CannedResponseVisibility,
} from '../lib/cannedResponses/visibility';
import {
  cannedResponseActionErrorFrom,
  CannedResponseError,
  isDuplicateCannedResponseNameViolation,
  type CannedResponseActionError,
} from './cannedResponseActionErrors';

const RESPONSES = 'canned_responses';
const FAVORITES = 'canned_response_favorites';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW_LENGTH = 160;
const PICKER_LIMIT = 500;

type Action = 'read' | 'create' | 'update' | 'delete';
type AuthUser = Parameters<typeof hasPermission>[0];
type Row = Record<string, any>;

function requireInternal(user: { user_type?: string }): void {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: operation not available in client portal');
  }
}

async function requirePermission(user: AuthUser, resource: 'canned_response' | 'ticket', action: Action, trx: Knex.Transaction) {
  if (!(await hasPermission(user, resource, action, trx))) {
    throw new Error(
      resource === 'canned_response'
        ? `Permission denied: Cannot ${action} canned responses`
        : `Permission denied: Cannot ${action} tickets`
    );
  }
}

/**
 * Coarse `ticket:read` plus the same row-level policy getTicketById applies (board/relationship/bundle
 * narrowing). Without it the picker and merge context would leak a ticket's board, title, client and contact.
 */
async function requireTicketRowRead(user: AuthUser, trx: Knex.Transaction, tenant: string, ticketId: string) {
  await requirePermission(user, 'ticket', 'read', trx);
  if (!UUID_PATTERN.test(ticketId)) throw new Error('Ticket not found');
  await authorizeTicketRecordAccess({ trx, tenant, user: user as any, ticketId, action: 'read' });
}

const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const toIsoOrNull = (value: Date | string | null | undefined): string | null => (value ? toIso(value) : null);

function previewOf(markdown: string | null | undefined): string {
  const flat = (markdown ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

/** Escapes LIKE wildcards so a search for "100%" or "a_b" matches literally. */
function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function markdownOf(body: string): Promise<string> {
  try {
    return (await convertBlockNoteToMarkdown(body)).trim();
  } catch (error) {
    // Search/preview text is derived data; a conversion failure must not block saving the response.
    console.error('[cannedResponses] markdown conversion failed:', error);
    return '';
  }
}

async function teamIdsOf(trx: Knex.Transaction, tenant: string, userId: string): Promise<string[]> {
  const rows = await tenantDb(trx, tenant).table('team_members').where({ user_id: userId }).select('team_id');
  return rows.map((row: Row) => row.team_id as string);
}

async function boardIdOfTicket(trx: Knex.Transaction, tenant: string, ticketId: string | null | undefined): Promise<string | null> {
  if (!ticketId || !UUID_PATTERN.test(ticketId)) return null;
  const ticket = await tenantDb(trx, tenant).table('tickets').where({ ticket_id: ticketId }).first('board_id');
  return (ticket?.board_id as string | undefined) ?? null;
}

function toCannedResponse(row: Row): ICannedResponse {
  return {
    tenant: row.tenant,
    canned_response_id: row.canned_response_id,
    name: row.name,
    body: row.body,
    body_markdown: row.body_markdown ?? '',
    category: row.category ?? null,
    scope: row.scope,
    owner_user_id: row.owner_user_id ?? null,
    team_id: row.team_id ?? null,
    board_id: row.board_id ?? null,
    is_active: row.is_active,
    actions: row.actions ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/** The base query over canned_responses joined to the viewer's favourites row, visibility-filtered. */
function visibleQuery(trx: Knex.Transaction, tenant: string, userId: string, viewer: CannedResponseVisibility) {
  const db = tenantDb(trx, tenant);
  const query = db.table(`${RESPONSES} as r`);
  db.tenantJoin(query, `${FAVORITES} as f`, 'r.canned_response_id', 'f.canned_response_id', {
    type: 'left',
    on: (join) => { join.andOn('f.user_id', '=', trx.raw('?', [userId])); },
  });
  applyVisibilityToQuery(query, viewer, (name) => `r.${name}`);
  return query;
}

async function loadVisibleRow(
  trx: Knex.Transaction,
  tenant: string,
  user: { user_id: string },
  canned_response_id: string
): Promise<Row> {
  const row = UUID_PATTERN.test(canned_response_id)
    ? await visibleQuery(trx, tenant, user.user_id, libraryVisibility(user.user_id))
        .where('r.canned_response_id', canned_response_id)
        .first('r.*')
    : undefined;
  if (!row) throw new CannedResponseError('Canned response not found', 'NOT_FOUND');
  return row;
}

/** Scope targets are validated on save (no FKs); team responses can only be authored by a member. */
async function assertValidTargets(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  input: ParsedCannedResponseInput
): Promise<void> {
  const db = tenantDb(trx, tenant);
  if (input.scope === 'team') {
    const team = await db.table('teams').where({ team_id: input.team_id! }).first('team_id');
    if (!team) throw new CannedResponseError('The selected team no longer exists', 'INVALID_REFERENCES');
    if (!(await teamIdsOf(trx, tenant, userId)).includes(input.team_id!)) {
      throw new CannedResponseError('You can only create team responses for teams you belong to', 'NOT_A_TEAM_MEMBER');
    }
  }
  if (input.scope === 'board') {
    const board = await db.table('boards').where({ board_id: input.board_id! }).first('board_id');
    if (!board) throw new CannedResponseError('The selected board no longer exists', 'INVALID_REFERENCES');
  }
}

/** The library shows every shared response, but only members may change a team's responses. */
async function assertCanMutate(trx: Knex.Transaction, tenant: string, userId: string, row: Row): Promise<void> {
  if (row.scope === 'team' && !(await teamIdsOf(trx, tenant, userId)).includes(row.team_id)) {
    throw new CannedResponseError('You can only change team responses for teams you belong to', 'NOT_A_TEAM_MEMBER');
  }
}

function writableColumns(input: ParsedCannedResponseInput, userId: string, markdown: string) {
  return {
    name: input.name,
    body: input.body,
    body_markdown: markdown,
    category: input.category,
    scope: input.scope,
    owner_user_id: input.scope === 'personal' ? userId : null,
    team_id: input.team_id,
    board_id: input.board_id,
  };
}

async function failed(error: unknown, label: string): Promise<CannedResponseActionError> {
  const expected = cannedResponseActionErrorFrom(error);
  if (expected) return expected;
  console.error(`Error in ${label}:`, error);
  throw error;
}

// ---------------------------------------------------------------------------------------------------------
// Library (admin) actions
// ---------------------------------------------------------------------------------------------------------

export interface ListCannedResponsesOptions {
  includeInactive?: boolean;
  /** Substring over name, category and body. */
  query?: string;
  /** Exact category (case-insensitive); empty string means uncategorised. */
  category?: string | null;
  scope?: CannedResponseScope;
}

/** The admin library: every shared response plus the caller's own personal ones. */
export const listCannedResponses = withAuth(async (
  user,
  { tenant },
  options: ListCannedResponsesOptions = {}
): Promise<CannedResponseListItem[] | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      const db = tenantDb(trx, tenant);
      const query = visibleQuery(trx, tenant, user.user_id, libraryVisibility(user.user_id));
      db.tenantJoin(query, 'teams as t', 'r.team_id', 't.team_id', { type: 'left' });
      db.tenantJoin(query, 'boards as b', 'r.board_id', 'b.board_id', { type: 'left' });
      if (!options.includeInactive) query.where('r.is_active', true);
      if (options.scope) query.where('r.scope', options.scope);
      if (options.category !== undefined && options.category !== null) {
        if (options.category === '') query.whereNull('r.category');
        else query.whereRaw('lower(r.category) = lower(?)', [options.category]);
      }
      if (options.query?.trim()) {
        const pattern = likePattern(options.query);
        query.where((group) => {
          group.whereRaw("r.name ILIKE ? ESCAPE '\\'", [pattern])
            .orWhereRaw("r.category ILIKE ? ESCAPE '\\'", [pattern])
            .orWhereRaw("r.body_markdown ILIKE ? ESCAPE '\\'", [pattern]);
        });
      }
      const rows = await query
        .orderByRaw('lower(r.category) asc nulls last')
        .orderByRaw('lower(r.name) asc')
        .select('r.*', 'f.is_favorite', 'f.last_used_at', 't.team_name', 'b.board_name');
      return rows.map((row: Row): CannedResponseListItem => ({
        canned_response_id: row.canned_response_id,
        name: row.name,
        category: row.category ?? null,
        scope: row.scope,
        owner_user_id: row.owner_user_id ?? null,
        team_id: row.team_id ?? null,
        team_name: row.team_name ?? null,
        board_id: row.board_id ?? null,
        board_name: row.board_name ?? null,
        preview: previewOf(row.body_markdown),
        is_active: row.is_active,
        is_favorite: Boolean(row.is_favorite),
        last_used_at: toIsoOrNull(row.last_used_at),
        updated_at: toIso(row.updated_at),
      }));
    });
  } catch (error) {
    return failed(error, 'listCannedResponses');
  }
});

/** Distinct categories in the library, for the category filter and the editor's suggestions. */
export const listCannedResponseCategories = withAuth(async (
  user,
  { tenant }
): Promise<string[] | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      const query = visibleQuery(trx, tenant, user.user_id, libraryVisibility(user.user_id));
      const rows = await query.whereNotNull('r.category').where('r.is_active', true).distinct('r.category').orderBy('r.category');
      const seen = new Map<string, string>();
      for (const row of rows) seen.set((row.category as string).toLowerCase(), row.category as string);
      return Array.from(seen.values());
    });
  } catch (error) {
    return failed(error, 'listCannedResponseCategories');
  }
});

export const getCannedResponse = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string
): Promise<ICannedResponse | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      return toCannedResponse(await loadVisibleRow(trx, tenant, user, cannedResponseId));
    });
  } catch (error) {
    return failed(error, 'getCannedResponse');
  }
});

export const createCannedResponse = withAuth(async (
  user,
  { tenant },
  input: CannedResponseInput
): Promise<{ canned_response_id: string } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const parsed = cannedResponseInputSchema.parse(input);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'create', trx);
      await assertValidTargets(trx, tenant, user.user_id, parsed);
      const markdown = await markdownOf(parsed.body);
      try {
        const [row] = await tenantDb(trx, tenant)
          .table(RESPONSES)
          .insert({
            tenant,
            ...writableColumns(parsed, user.user_id, markdown),
            is_active: true,
            created_by: user.user_id,
            updated_by: user.user_id,
          })
          .returning('canned_response_id');
        return { canned_response_id: row.canned_response_id as string };
      } catch (error) {
        if (isDuplicateCannedResponseNameViolation(error)) throw duplicateNameError(parsed.name);
        throw error;
      }
    });
  } catch (error) {
    return failed(error, 'createCannedResponse');
  }
});

export const updateCannedResponse = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string,
  input: CannedResponseInput
): Promise<{ canned_response_id: string } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const parsed = cannedResponseInputSchema.parse(input);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'update', trx);
      const existing = await loadVisibleRow(trx, tenant, user, cannedResponseId);
      await assertCanMutate(trx, tenant, user.user_id, existing);
      await assertValidTargets(trx, tenant, user.user_id, parsed);
      const markdown = await markdownOf(parsed.body);
      try {
        await tenantDb(trx, tenant)
          .table(RESPONSES)
          .where({ canned_response_id: existing.canned_response_id })
          .update({
            ...writableColumns(parsed, existing.scope === 'personal' ? existing.owner_user_id : user.user_id, markdown),
            updated_by: user.user_id,
            updated_at: trx.fn.now(),
          });
      } catch (error) {
        if (isDuplicateCannedResponseNameViolation(error)) throw duplicateNameError(parsed.name);
        throw error;
      }
      return { canned_response_id: existing.canned_response_id as string };
    });
  } catch (error) {
    return failed(error, 'updateCannedResponse');
  }
});

export const setCannedResponseActive = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string,
  isActive: boolean
): Promise<{ canned_response_id: string } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'update', trx);
      const existing = await loadVisibleRow(trx, tenant, user, cannedResponseId);
      await assertCanMutate(trx, tenant, user.user_id, existing);
      try {
        await tenantDb(trx, tenant)
          .table(RESPONSES)
          .where({ canned_response_id: existing.canned_response_id })
          .update({ is_active: isActive, updated_by: user.user_id, updated_at: trx.fn.now() });
      } catch (error) {
        if (isDuplicateCannedResponseNameViolation(error)) throw duplicateNameError(existing.name);
        throw error;
      }
      return { canned_response_id: existing.canned_response_id as string };
    });
  } catch (error) {
    return failed(error, 'setCannedResponseActive');
  }
});

export const deleteCannedResponse = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string
): Promise<{ canned_response_id: string } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'delete', trx);
      const existing = await loadVisibleRow(trx, tenant, user, cannedResponseId);
      await assertCanMutate(trx, tenant, user.user_id, existing);
      // Hard delete; favourites rows go with it (ON DELETE CASCADE). Comments already written keep their text.
      await tenantDb(trx, tenant).table(RESPONSES).where({ canned_response_id: existing.canned_response_id }).delete();
      return { canned_response_id: existing.canned_response_id as string };
    });
  } catch (error) {
    return failed(error, 'deleteCannedResponse');
  }
});

function duplicateNameError(name: string): CannedResponseError {
  return new CannedResponseError(`A canned response named ${name} already exists here`, 'DUPLICATE_NAME', { name });
}

// ---------------------------------------------------------------------------------------------------------
// Picker actions (read-only, visibility-filtered)
// ---------------------------------------------------------------------------------------------------------

export interface PickerQueryOptions {
  /** The ticket being replied to; its board scopes board responses. */
  ticketId?: string | null;
  surface?: CannedResponseSurface;
  /** Substring over name, category and body. */
  query?: string;
  category?: string | null;
}

async function pickerItems(
  trx: Knex.Transaction,
  tenant: string,
  user: { user_id: string },
  options: PickerQueryOptions
): Promise<CannedResponsePickerItem[]> {
  const viewer = pickerVisibility({
    userId: user.user_id,
    teamIds: await teamIdsOf(trx, tenant, user.user_id),
    boardId: await boardIdOfTicket(trx, tenant, options.ticketId),
    surface: options.surface ?? 'msp',
  });
  const query = visibleQuery(trx, tenant, user.user_id, viewer).where('r.is_active', true);
  if (options.category) query.whereRaw('lower(r.category) = lower(?)', [options.category]);
  if (options.query?.trim()) {
    const pattern = likePattern(options.query);
    query.where((group) => {
      group.whereRaw("r.name ILIKE ? ESCAPE '\\'", [pattern])
        .orWhereRaw("r.category ILIKE ? ESCAPE '\\'", [pattern])
        .orWhereRaw("r.body_markdown ILIKE ? ESCAPE '\\'", [pattern]);
    });
  }
  const rows = await query
    .orderByRaw('lower(r.name) asc')
    .limit(PICKER_LIMIT)
    .select('r.canned_response_id', 'r.name', 'r.category', 'r.scope', 'r.body', 'r.body_markdown', 'f.is_favorite', 'f.last_used_at');
  return rows.map((row: Row): CannedResponsePickerItem => ({
    canned_response_id: row.canned_response_id,
    name: row.name,
    category: row.category ?? null,
    scope: row.scope,
    body: row.body,
    preview: previewOf(row.body_markdown),
    is_favorite: Boolean(row.is_favorite),
    last_used_at: toIsoOrNull(row.last_used_at),
  }));
}

/** Responses the caller may insert on this surface/ticket, with their favourite and recency state. */
export const listVisibleCannedResponses = withAuth(async (
  user,
  { tenant },
  options: PickerQueryOptions = {}
): Promise<CannedResponsePickerItem[] | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      if (options.ticketId) await requireTicketRowRead(user, trx, tenant, options.ticketId);
      return pickerItems(trx, tenant, user, { ...options, query: undefined });
    });
  } catch (error) {
    return failed(error, 'listVisibleCannedResponses');
  }
});

/** Server-side search for libraries too large to filter in the browser. */
export const searchCannedResponses = withAuth(async (
  user,
  { tenant },
  query: string,
  options: Omit<PickerQueryOptions, 'query'> = {}
): Promise<CannedResponsePickerItem[] | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      if (options.ticketId) await requireTicketRowRead(user, trx, tenant, options.ticketId);
      return pickerItems(trx, tenant, user, { ...options, query });
    });
  } catch (error) {
    return failed(error, 'searchCannedResponses');
  }
});

/**
 * Values for client-side merge-field resolution on insert. createComment resolves anything left over with
 * the same loader, so what the agent sees in the editor and what is stored agree.
 */
export const getCannedResponseMergeContext = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<CannedResponseMergeContext | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      await requireTicketRowRead(user, trx, tenant, ticketId);
      return loadCannedMergeContext(trx, tenant, ticketId, user.user_id);
    });
  } catch (error) {
    return failed(error, 'getCannedResponseMergeContext');
  }
});

// ---------------------------------------------------------------------------------------------------------
// Favourites and recents (per user)
// ---------------------------------------------------------------------------------------------------------

export const setCannedResponseFavorite = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string,
  isFavorite: boolean
): Promise<{ canned_response_id: string; is_favorite: boolean } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      // Favouriting is personal bookkeeping, not an edit of the response: read permission is the right gate.
      await requirePermission(user, 'canned_response', 'read', trx);
      const existing = await loadVisibleRow(trx, tenant, user, cannedResponseId);
      // Bound as a JS value: Citus rejects non-IMMUTABLE functions (now()) in DO UPDATE SET.
      const now = new Date().toISOString();
      await tenantDb(trx, tenant)
        .table(FAVORITES)
        .insert({
          tenant,
          user_id: user.user_id,
          canned_response_id: existing.canned_response_id,
          is_favorite: isFavorite,
          updated_at: now,
        })
        .onConflict(['tenant', 'user_id', 'canned_response_id'])
        .merge({ is_favorite: isFavorite, updated_at: now });
      return { canned_response_id: existing.canned_response_id as string, is_favorite: isFavorite };
    });
  } catch (error) {
    return failed(error, 'setCannedResponseFavorite');
  }
});

/** Stamps last_used_at (drives "recents") and bumps use_count. Called by the picker after an insert. */
export const recordCannedResponseUse = withAuth(async (
  user,
  { tenant },
  cannedResponseId: string
): Promise<{ canned_response_id: string } | CannedResponseActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'canned_response', 'read', trx);
      const existing = await loadVisibleRow(trx, tenant, user, cannedResponseId);
      // Bound as a JS value: Citus rejects non-IMMUTABLE functions (now()) in DO UPDATE SET.
      const now = new Date().toISOString();
      await tenantDb(trx, tenant)
        .table(FAVORITES)
        .insert({
          tenant,
          user_id: user.user_id,
          canned_response_id: existing.canned_response_id,
          last_used_at: now,
          use_count: 1,
          updated_at: now,
        })
        .onConflict(['tenant', 'user_id', 'canned_response_id'])
        .merge({
          last_used_at: now,
          use_count: trx.raw(`${FAVORITES}.use_count + 1`),
          updated_at: now,
        });
      return { canned_response_id: existing.canned_response_id as string };
    });
  } catch (error) {
    return failed(error, 'recordCannedResponseUse');
  }
});
