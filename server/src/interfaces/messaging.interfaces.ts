// Direct messaging interfaces for the Hocuspocus-powered messaging system

export interface DirectMessage {
  direct_message_id: string;
  tenant: string;
  sender_id: string;
  recipient_id: string;
  thread_id?: string;
  message: string;
  attachments?: Record<string, any>;
  read_at?: Date;
  created_at: Date;
  edited_at?: Date;
  deleted_at?: Date;
}

export interface MessageThread {
  thread_id: string;
  participants: string[];
  last_message?: DirectMessage;
  unread_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDirectMessageData {
  recipient_id: string;
  message: string;
  thread_id?: string;
  attachments?: Record<string, any>;
}

export interface MessageUser {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  is_online?: boolean;
}

// Reserved for future Hocuspocus integration
export interface HocuspocusMessage {
  id: string;
  sender_id: string;
  message: string;
  timestamp: number;
  thread_id: string;
  type: 'message' | 'typing' | 'read_receipt';
}

export interface TypingIndicator {
  user_id: string;
  thread_id: string;
  is_typing: boolean;
  timestamp: number;
}

export interface MessageThreadListResult {
  threads: MessageThread[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
}