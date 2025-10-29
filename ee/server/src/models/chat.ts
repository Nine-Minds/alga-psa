import { createTenantKnex } from '../lib/db';
import { IChat } from '../interfaces/chat.interface';

const Chat = {
  getAll: async (): Promise<IChat[]> => {
    try {
      const {knex: db} = await createTenantKnex();
      const Chats = await db<IChat>('chats').select('*');
      return Chats;
    } catch (error) {
      console.error('Error getting all chats:', error);
      throw error;
    }
  },

  get: async (id: string): Promise<IChat | undefined> => {
    try {
      const {knex: db} = await createTenantKnex();
      const Chat = await db<IChat>('chats').select('*').where({ id }).first();
      return Chat;
    } catch (error) {
      console.error(`Error getting chat with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (Chat: IChat): Promise<Pick<Omit<IChat, 'tenant'>, "id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const [id] = await db<IChat>('chats').insert({...Chat, tenant: tenant!}).returning('id');
      return id;
    } catch (error) {
      console.error('Error inserting chat:', error);
      throw error;
    }
  },

  update: async (id: string, Chat: Partial<IChat>): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db<IChat>('chats').where({ id }).update(Chat);
    } catch (error) {
      console.error(`Error updating chat with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db} = await createTenantKnex();
      await db<IChat>('chat').where({ id }).del();
    } catch (error) {
      console.error(`Error deleting chat with id ${id}:`, error);
      throw error;
    }
  },
};

export default Chat;
