import { createTenantKnex } from '../lib/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { IMessage, pickMessageUpdates } from '../interfaces/message.interface';
import { ChatAccessDeniedError } from '../lib/chat-actions/errors';

type TenantDbConnection = Parameters<typeof tenantDb>[0];

const requireTenant = (tenant: string | null | undefined): string => {
  if (!tenant) {
    throw new Error('Missing tenant for message model');
  }
  return tenant;
};

const messagesTable = <Row extends object>(
  db: TenantDbConnection,
  tenant: string | null | undefined
): Knex.QueryBuilder<Row, Row[]> =>
  tenantDb(db, requireTenant(tenant)).table<Row>('messages');

const requireTenantForInsert = (tenant: string | null | undefined): string => {
  if (!tenant) {
    throw new Error('Missing tenant for message insert');
  }
  return tenant;
};

const Message = {
  getAll: async (): Promise<IMessage[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const messages = await messagesTable<IMessage>(db, tenant).select('*');
      return messages;
    } catch (error) {
      console.error('Error getting all messages:', error);
      throw error;
    }
  },

  getByChatId: async (chatId: string): Promise<IMessage[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const messages = await messagesTable<IMessage>(db, tenant)
        .select('*')
        .where({ chat_id: chatId })
        .orderBy([{ column: 'message_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
      return messages;
    } catch (error) {
      console.error(`Error getting messages for chat_id ${chatId}:`, error);
      throw error;
    }
  },

  getByChatIdForUser: async (chatId: string, userId: string): Promise<IMessage[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const scopedTenant = requireTenant(tenant);
      const facade = tenantDb(db, scopedTenant);

      // A supplied chat_id is not authorization: the chat must belong to the
      // caller inside the authenticated tenant before any message is read.
      const ownedChat = await facade.table<{ id?: string }>('chats')
        .select('id')
        .where({ id: chatId, user_id: userId })
        .first();
      if (!ownedChat) {
        throw new ChatAccessDeniedError();
      }

      const query = facade.table<IMessage>('messages as m');
      facade.tenantJoin(query, 'chats as c', 'c.id', 'm.chat_id', { rootTenantColumn: 'm.tenant' });

      const messages = await query
        .select('m.*')
        .where('m.chat_id', chatId)
        .where('c.user_id', userId)
        .orderBy([{ column: 'm.message_order', order: 'asc' }, { column: 'm.id', order: 'asc' }]);
      return messages;
    } catch (error) {
      console.error(`Error getting messages for chat_id ${chatId}:`, error);
      throw error;
    }
  },

  get: async (id: string): Promise<IMessage | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const message = await messagesTable<IMessage>(db, tenant).select('*').where({ id }).first();
      return message;
    } catch (error) {
      console.error(`Error getting message with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (message: Omit<IMessage, 'id' | 'tenant'>): Promise<Pick<Omit<IMessage, 'tenant'>, "id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const scopedTenant = requireTenantForInsert(tenant);
      const [id] = await messagesTable<IMessage>(db, scopedTenant)
        .insert({...message, tenant: scopedTenant})
        .returning('id');
      return id;
    } catch (error) {
      console.error('Error inserting message:', error);
      throw error;
    }
  },

  update: async (id: string, message: Partial<IMessage>, userId: string): Promise<number> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const scopedTenant = requireTenant(tenant);

      // Never forward an arbitrary payload: only the allowlisted mutable
      // columns may reach the database.
      const updates = pickMessageUpdates(message);
      if (Object.keys(updates).length === 0) {
        return 0;
      }

      const facade = tenantDb(db, scopedTenant);
      const ownedChat = facade.table<{ id?: string }>('chats as c')
        .select(db.raw('1'))
        .where('c.user_id', userId)
        .whereRaw('?? = ??', ['c.id', 'messages.chat_id']);

      const updated = await facade.table<IMessage>('messages')
        .where({ id })
        .whereExists(ownedChat)
        .update(updates);
      return updated;
    } catch (error) {
      console.error(`Error updating message with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await messagesTable<IMessage>(db, tenant).where({ id }).del();
    } catch (error) {
      console.error(`Error deleting message with id ${id}:`, error);
      throw error;
    }
  },
};

export default Message;
