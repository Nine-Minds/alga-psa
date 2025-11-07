import { createTenantKnex } from '../lib/db';
import { IMessage } from '../interfaces/message.interface';

const Message = {
  getAll: async (): Promise<IMessage[]> => {
    try {
      const {knex: db} = await createTenantKnex();
      const messages = await db<IMessage>('messages').select('*');
      return messages;
    } catch (error) {
      console.error('Error getting all messages:', error);
      throw error;
    }
  },

  get: async (id: string): Promise<IMessage | undefined> => {
    try {
      const {knex: db} = await createTenantKnex();
      const message = await db<IMessage>('messages').select('*').where({ id }).first();
      return message;
    } catch (error) {
      console.error(`Error getting message with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (message: Omit<IMessage, 'id' | 'tenant'>): Promise<Pick<Omit<IMessage, 'tenant'>, "id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const [id] = await db<IMessage>('messages').insert({...message, tenant: tenant!}).returning('id');
      return id;
    } catch (error) {
      console.error('Error inserting message:', error);
      throw error;
    }
  },

  update: async (id: string, message: Partial<IMessage>): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db<IMessage>('messages').where({ id }).update(message);
    } catch (error) {
      console.error(`Error updating message with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db<IMessage>('messages').where({ id }).del();
    } catch (error) {
      console.error(`Error deleting message with id ${id}:`, error);
      throw error;
    }
  },
};

export default Message;
