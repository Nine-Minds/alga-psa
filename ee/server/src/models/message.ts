import { createTenantKnex } from '../lib/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { IMessage } from '../interfaces/message.interface';

type TenantDbConnection = Parameters<typeof tenantDb>[0];

const MESSAGE_MODEL_NO_TENANT_CONTEXT = '__message_model_no_tenant_context__';
const LEGACY_NO_TENANT_REASON = 'Preserve legacy message model behavior when no tenant context is available';

const messagesTable = <Row extends object>(
  db: TenantDbConnection,
  tenant: string | null | undefined
): Knex.QueryBuilder<Row, Row[]> =>
  tenant
    ? tenantDb(db, tenant).table<Row>('messages')
    : tenantDb(db, MESSAGE_MODEL_NO_TENANT_CONTEXT)
      .unscoped<Row>('messages', LEGACY_NO_TENANT_REASON);

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

  update: async (id: string, message: Partial<IMessage>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await messagesTable<IMessage>(db, tenant).where({ id }).update(message);
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
