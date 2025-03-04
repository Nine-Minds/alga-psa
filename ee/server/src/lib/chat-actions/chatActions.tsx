'use server'

import { IChat } from '../../interfaces/chat.interface';
import { IMessage } from '../../interfaces/message.interface';
import Chat from '../../models/chat';
import Message from '../../models/message';
import { v4 as uuidv4 } from 'uuid';

export async function createNewChatAction(data: Omit<IChat, 'tenant'>) {
  try {
    data.id = uuidv4();
    const conversation = await Chat.insert(data);
    return { _id: conversation.id };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to create new chat');
  }
}

export async function addMessageToChatAction(data: Omit<IMessage, 'tenant'>) {
  try {
    const message = await Message.insert(data);
    return { _id: message.id };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to add message to chat');
  }
}

export async function updateMessageAction(id: string, data: Partial<IMessage>) {
  try {
    const message = await Message.update(id, data);
    return 'success';
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update message');
  }
}
