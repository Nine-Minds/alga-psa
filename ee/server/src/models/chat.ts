import { createTenantKnex } from '../lib/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { IChat } from '../interfaces/chat.interface';

export interface IChatHistoryItem extends IChat {
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  preview_text?: string | null;
}

type TenantDbConnection = Parameters<typeof tenantDb>[0];

const CHAT_MODEL_NO_TENANT_CONTEXT = '__chat_model_no_tenant_context__';
const LEGACY_NO_TENANT_REASON = 'Preserve legacy chat model behavior when no tenant context is available';

const chatsTable = <Row extends object>(
  db: TenantDbConnection,
  tenant: string | null | undefined
): Knex.QueryBuilder<Row, Row[]> =>
  tenant
    ? tenantDb(db, tenant).table<Row>('chats')
    : tenantDb(db, CHAT_MODEL_NO_TENANT_CONTEXT).unscoped<Row>('chats', LEGACY_NO_TENANT_REASON);

const messagesTable = <Row extends object>(
  db: TenantDbConnection,
  tenant: string | null | undefined
): Knex.QueryBuilder<Row, Row[]> =>
  tenant
    ? tenantDb(db, tenant).table<Row>('messages')
    : tenantDb(db, CHAT_MODEL_NO_TENANT_CONTEXT).unscoped<Row>('messages', LEGACY_NO_TENANT_REASON);

const requireTenantForInsert = (tenant: string | null | undefined): string => {
  if (!tenant) {
    throw new Error('Missing tenant for chat insert');
  }
  return tenant;
};

const Chat = {
  getAll: async (): Promise<IChat[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const Chats = await chatsTable<IChat>(db, tenant).select('*');
      return Chats;
    } catch (error) {
      console.error('Error getting all chats:', error);
      throw error;
    }
  },

  get: async (id: string): Promise<IChat | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const Chat = await chatsTable<IChat>(db, tenant).select('*').where({ id }).first();
      return Chat;
    } catch (error) {
      console.error(`Error getting chat with id ${id}:`, error);
      throw error;
    }
  },

  getRecentByUser: async (userId: string, limit = 20, tenant?: string): Promise<IChatHistoryItem[]> => {
    try {
      const { knex: db } = await createTenantKnex();
      const chatsRoot = tenant
        ? tenantDb(db, tenant).table<IChatHistoryItem>('chats')
        : chatsTable<IChatHistoryItem>(db, undefined);
      const chats = await chatsRoot
        .select(
          'chats.*',
          db.raw(
            `(
              select m.content
              from messages m
              where m.chat_id = chats.id
              and m.tenant = chats.tenant
              order by m.message_order desc nulls last, m.id desc
              limit 1
            ) as preview_text`
          )
        )
        .where({ user_id: userId })
        .orderByRaw('coalesce(chats.updated_at, chats.created_at) desc nulls last')
        .orderBy('chats.id', 'desc')
        .limit(limit);

      return chats;
    } catch (error) {
      console.error(`Error getting recent chats for user ${userId}:`, error);
      throw error;
    }
  },

  searchByUser: async (userId: string, query: string, limit = 20, tenant?: string): Promise<IChatHistoryItem[]> => {
    try {
      const { knex: db } = await createTenantKnex();
      const chatsRoot = tenant
        ? tenantDb(db, tenant).table<IChat>('chats')
        : chatsTable<IChat>(db, undefined);
      const chatsRootSql = chatsRoot
        .select('chats.*')
        .where({ user_id: userId })
        .toSQL();

      // Search at the chat scope so multi-term queries can match across the title
      // and multiple persisted messages, not just within a single indexed field.
      const rawResult = await db.raw(
        `
          with search_query as (
            select websearch_to_tsquery('english', ?) as query
          ),
          chat_documents as (
            select
              chats.*,
              (
                select m_latest.content
                from messages m_latest
                where m_latest.chat_id = chats.id
                  and m_latest.tenant = chats.tenant
                order by m_latest.message_order desc nulls last, m_latest.id desc
                limit 1
              ) as preview_text,
              (
                setweight(chats.title_index, 'A')
                ||
                coalesce(
                  (
                    select process_large_lexemes(
                      string_agg(
                        coalesce(m_aggregate.content, ''),
                        ' '
                        order by m_aggregate.message_order asc nulls last, m_aggregate.id asc
                      )
                    )
                    from messages m_aggregate
                    where m_aggregate.chat_id = chats.id
                      and m_aggregate.tenant = chats.tenant
                  ),
                  ''::tsvector
                )
              ) as conversation_index
            from (${chatsRootSql.sql}) as chats
          )
          select
            chat_documents.*,
            ts_rank_cd(chat_documents.conversation_index, search_query.query) as relevance_rank
          from chat_documents
          cross join search_query
          where chat_documents.conversation_index @@ search_query.query
          order by
            relevance_rank desc,
            coalesce(chat_documents.updated_at, chat_documents.created_at) desc nulls last,
            chat_documents.id desc
          limit ?
        `,
        [query, ...(chatsRootSql.bindings ?? []), limit]
      );

      return Array.isArray(rawResult)
        ? (rawResult as IChatHistoryItem[])
        : ((rawResult as { rows?: IChatHistoryItem[] })?.rows ?? []);
    } catch (error) {
      console.error(`Error searching chats for user ${userId}:`, error);
      throw error;
    }
  },

  insert: async (Chat: IChat): Promise<Pick<Omit<IChat, 'tenant'>, "id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const scopedTenant = requireTenantForInsert(tenant);
      const [id] = await chatsTable<IChat>(db, scopedTenant).insert({...Chat, tenant: scopedTenant}).returning('id');
      return id;
    } catch (error) {
      console.error('Error inserting chat:', error);
      throw error;
    }
  },

  update: async (id: string, Chat: Partial<IChat>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await chatsTable<IChat>(db, tenant).where({ id }).update(Chat);
    } catch (error) {
      console.error(`Error updating chat with id ${id}:`, error);
      throw error;
    }
  },

  updateTitleForUser: async (id: string, userId: string, title: string): Promise<boolean> => {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      const updatedRows = await chatsTable<IChat>(db, tenant)
        .where({ id, user_id: userId })
        .update({
          title_text: title,
        });

      return updatedRows > 0;
    } catch (error) {
      console.error(`Error updating chat title for chat ${id}:`, error);
      throw error;
    }
  },

  deleteForUser: async (id: string, userId: string): Promise<boolean> => {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      const deleted = await db.transaction(async (trx) => {
        const chat = await chatsTable<IChat>(trx, tenant)
          .select('id', 'tenant')
          .where({ id, user_id: userId })
          .first();

        if (!chat) {
          return false;
        }

        const scopedTenant = chat.tenant ?? tenant ?? undefined;
        await messagesTable(trx, scopedTenant).where({ chat_id: id }).del();
        await chatsTable<IChat>(trx, scopedTenant).where({ id }).del();
        return true;
      });

      return deleted;
    } catch (error) {
      console.error(`Error deleting chat with id ${id}:`, error);
      throw error;
    }
  },
};

export default Chat;
