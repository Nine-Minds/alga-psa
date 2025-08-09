import type { HostEvent } from './types';

type Listener = (evt: HostEvent) => void;

export class IframeBridge {
  private listeners: Set<Listener> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (ev: MessageEvent) => {
        const data = ev.data as HostEvent | undefined;
        if (!data || typeof data !== 'object' || !('type' in data)) return;
        this.listeners.forEach((l) => l(data));
      });
      // Handshake
      window.parent?.postMessage({ type: 'init' }, '*');
    }
  }

  on(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emitToHost(type: string, payload: any) {
    if (typeof window !== 'undefined') {
      window.parent?.postMessage({ type, payload }, '*');
    }
  }
}

