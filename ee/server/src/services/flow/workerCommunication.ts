import axios, { AxiosInstance } from 'axios';
import { Message, MessageType, WorkflowExecutionMessage, createMessage } from './types/messages';
import { mockStreamingService, StreamingMessage } from './types/streaming';

class WorkerCommunication {
  private httpClient: AxiosInstance;
  private messageHandler?: (message: Message) => void;

  constructor() {
    this.httpClient = axios.create({
      baseURL: 'http://worker-address:port',
      timeout: 5000,
    });

    // Set up message listener
    mockStreamingService.onMessage(this.handleStreamingMessage.bind(this));
  }

  private handleStreamingMessage(streamingMessage: StreamingMessage): void {
    if (streamingMessage.topic === 'worker-responses' && this.messageHandler) {
      try {
        const parsedMessage: Message = JSON.parse(streamingMessage.value);

        if (!Object.values(MessageType).includes(parsedMessage.type)) {
          console.warn(`Received message with unknown type: ${parsedMessage.type}`);
          return;
        }

        if (!parsedMessage.id || !parsedMessage.timestamp || !parsedMessage.source) {
          console.warn('Received message missing required fields');
          return;
        }

        this.messageHandler(parsedMessage);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    }
  }

  async init(): Promise<void> {
    // No initialization needed for mock service
    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    // Clean up message handler
    mockStreamingService.removeListener(this.handleStreamingMessage.bind(this));
    return Promise.resolve();
  }

  async sendMessageToWorker(message: Message): Promise<void> {
    await mockStreamingService.send('workflow-execution', JSON.stringify(message));
  }

  async makeHttpRequest(endpoint: string, method: string, data?: any) {
    const response = await this.httpClient({
      method,
      url: endpoint,
      data,
    });
    return response.data;
  }

  async startListening(messageHandler: (message: Message) => void): Promise<void> {
    this.messageHandler = messageHandler;
  }
}

// Helper functions to create messages
export function createWorkflowExecutionMessage(
  workflowId: string,
  action: 'ENABLE' | 'DISABLE'
): WorkflowExecutionMessage {
  return createMessage<WorkflowExecutionMessage>(MessageType.WORKFLOW_EXECUTION, 'UI', {
    workflowId,
    action,
  });
}

export function createOffice365NotificationMessage(subscriptionId: string, notification: any) {
  return createMessage(MessageType.OFFICE365_NOTIFICATION, 'UI', {
    subscriptionId,
    notification,
  });
}

// Singleton instance
const workerComm = new WorkerCommunication();
export default workerComm;
