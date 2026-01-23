import { useEffect, useState } from 'react';
import { callProxyJson, UiProxyHost } from '@alga-psa/extension-runtime';

export interface TicketListItem {
  id: string;
  title: string;
  status: string;
  assignee?: string | null;
}

export interface TicketProxyResponse {
  ok: boolean;
  tickets: TicketListItem[];
  error?: string | null;
  upstreamStatus?: number;
  fetchedAt?: string;
}

export async function fetchTicketsViaProxy(uiProxy: UiProxyHost, limit = 10): Promise<TicketProxyResponse> {
  return callProxyJson<TicketProxyResponse>(uiProxy, '/tickets/list', { limit });
}

export interface TicketsPanelProps {
  uiProxy: UiProxyHost;
  limit?: number;
}

export function TicketsPanel({ uiProxy, limit = 10 }: TicketsPanelProps) {
  const [state, setState] = useState<{ loading: boolean; error?: string | null; tickets: TicketListItem[] }>({
    loading: true,
    tickets: [],
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchTicketsViaProxy(uiProxy, limit)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setState({ loading: false, tickets: result.tickets ?? [], error: null });
        } else {
          setState({ loading: false, tickets: [], error: result.error ?? 'Ticket service unavailable' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ loading: false, tickets: [], error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [uiProxy, limit]);

  if (state.loading) {
    return <p data-testid="tickets-loading">Loading tickets…</p>;
  }

  if (state.error) {
    return (
      <div data-testid="tickets-error" role="alert">
        <p>We couldn&apos;t load your tickets.</p>
        <pre>{state.error}</pre>
      </div>
    );
  }

  if (!state.tickets.length) {
    return <p data-testid="tickets-empty">No open tickets 🎉</p>;
  }

  return (
    <table data-testid="tickets-table">
      <thead>
        <tr>
          <th scope="col">Ticket</th>
          <th scope="col">Status</th>
          <th scope="col">Assignee</th>
        </tr>
      </thead>
      <tbody>
        {state.tickets.map((ticket) => (
          <tr key={ticket.id}>
            <th scope="row">{ticket.id}</th>
            <td>{ticket.status}</td>
            <td>{ticket.assignee ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function renderTicketsPanel(root: HTMLElement, uiProxy: UiProxyHost, limit = 10) {
  // Lazy import ReactDOM only when rendering inside the iframe.
  import('react-dom/client').then(({ createRoot }) => {
    const app = createRoot(root);
    app.render(<TicketsPanel uiProxy={uiProxy} limit={limit} />);
  });
}

export type { UiProxyHost } from '@alga-psa/extension-runtime';
