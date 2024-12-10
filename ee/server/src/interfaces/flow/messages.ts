// src/shared/types/messages.ts

import { v4 as uuidv4 } from 'uuid';

export enum MessageType {
  WORKFLOW_EXECUTION = 'WORKFLOW_EXECUTION',
  OFFICE365_NOTIFICATION = 'OFFICE365_NOTIFICATION',
}

export interface WorkflowExecutionMessage extends BaseMessage {
  type: MessageType.WORKFLOW_EXECUTION;
  payload: {
    workflowId: string;
    action: 'ENABLE' | 'DISABLE';
  };
}

export interface Office365NotificationMessage extends BaseMessage {
  type: MessageType.OFFICE365_NOTIFICATION;
  payload: {
    subscriptionId: string;
    notification: any;
  };
}

export interface BaseMessage {
  id: string;           // Unique identifier for the message
  type: MessageType;    // Type of the message
  timestamp: number;    // Unix timestamp of when the message was created
  source: 'UI' | 'WORKER'; // Where the message originated
}

export type Message = WorkflowExecutionMessage | Office365NotificationMessage;

export function createMessage<T extends Message>(
  type: T['type'],
  source: 'UI' | 'WORKER',
  payload: T['payload']
): T {
  return {
    id: uuidv4(),
    type,
    timestamp: Date.now(),
    source,
    payload,
  } as T;
}