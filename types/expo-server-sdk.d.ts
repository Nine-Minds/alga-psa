declare module 'expo-server-sdk' {
  export interface ExpoPushMessage {
    to?: string | string[];
    sound?: 'default' | null;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    priority?: 'default' | 'normal' | 'high';
    [key: string]: unknown;
  }

  export interface ExpoPushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: {
      error?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export default class Expo {
    static isExpoPushToken(token: string): boolean;
    chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
    sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  }
}
