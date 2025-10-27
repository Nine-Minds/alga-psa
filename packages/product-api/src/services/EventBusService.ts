/**
 * Event Bus Service
 * Provides publish/subscribe functionality for application events
 */

export interface EventPayload {
  [key: string]: any;
}

export interface EventHandler {
  (payload: EventPayload): Promise<void> | void;
}

export class EventBusService {
  private listeners: Map<string, EventHandler[]> = new Map();

  /**
   * Publish an event to all registered listeners
   */
  async publish(eventType: string, payload: EventPayload): Promise<void> {
    const handlers = this.listeners.get(eventType) || [];
    
    // Execute all handlers in parallel
    await Promise.all(
      handlers.map(handler => {
        try {
          return Promise.resolve(handler(payload));
        } catch (error) {
          console.error(`Error in event handler for ${eventType}:`, error);
        }
      })
    );
  }

  /**
   * Subscribe to an event type
   */
  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    
    this.listeners.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from an event type
   */
  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Remove all listeners for an event type
   */
  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event type
   */
  listenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.length || 0;
  }
}