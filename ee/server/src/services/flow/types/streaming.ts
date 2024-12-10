export interface StreamingMessage {
  topic: string;
  value: string;
}

export interface StreamingProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(topic: string, messages: { value: string }[]): Promise<void>;
}

export interface StreamingConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(options: {
    eachMessage(payload: {
      topic: string;
      partition: number;
      message: { value: Buffer | null };
    }): Promise<void>;
  }): Promise<void>;
}

// Mock implementation that stores messages in memory
export class MockStreamingService {
  private messages: StreamingMessage[] = [];
  private listeners: ((message: StreamingMessage) => void)[] = [];

  async send(topic: string, message: string): Promise<void> {
    const streamingMessage = { topic, value: message };
    this.messages.push(streamingMessage);
    this.listeners.forEach(listener => listener(streamingMessage));
  }

  onMessage(callback: (message: StreamingMessage) => void): void {
    this.listeners.push(callback);
  }

  removeListener(callback: (message: StreamingMessage) => void): void {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }
}

// Global instance for easy access
export const mockStreamingService = new MockStreamingService();
