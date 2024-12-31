import { useEffect, useState } from 'react';
import { PageState } from '../../../../../../server/src/types/ui-reflection/types';

interface UseUIReflectionOptions {
  onStateUpdate?: (state: PageState) => void;
}

/**
 * Hook to connect to and consume UI reflection WebSocket updates
 */
export function useUIReflection(options: UseUIReflectionOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ui-reflection/ws`);

    ws.onopen = () => {
      console.log('Connected to UI reflection WebSocket');
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'UI_STATE_UPDATE') {
          const newState = message.payload as PageState;
          setPageState(newState);
          options.onStateUpdate?.(newState);
        }
      } catch (err) {
        console.error('Error processing UI reflection message:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    ws.onerror = (event) => {
      console.error('UI reflection WebSocket error:', event);
      setError(new Error('WebSocket connection error'));
      setConnected(false);
    };

    ws.onclose = () => {
      console.log('Disconnected from UI reflection WebSocket');
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [options.onStateUpdate]);

  return {
    connected,
    pageState,
    error
  };
}

/**
 * Helper function to find a component by ID in the page state
 */
export function findComponentById(pageState: PageState, id: string) {
  return pageState.components.find(component => component.id === id);
}

/**
 * Helper function to find components by type in the page state
 */
export function findComponentsByType(pageState: PageState, type: string) {
  return pageState.components.filter(component => component.type === type);
}

/**
 * Helper function to find a component by label text in the page state
 */
export function findComponentByLabel(pageState: PageState, label: string) {
  return pageState.components.find(component => component.label === label);
}
