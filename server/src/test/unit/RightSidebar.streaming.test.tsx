/**
 * @vitest-environment jsdom
 */
import React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The sidebar Chat references i18n keys (chat.inputPlaceholder, chat.send,
// chat.function.approve, ...) without a defaultValue. The shared setup mock would
// surface raw keys, so resolve them against the real English chat catalog via a
// stable singleton `t` (built once at module load to stay referentially stable).
const chatCatalog = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../public/locales/en/msp/chat.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const resolveCatalogKey = (key: string): string | undefined => {
  const value = key.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, chatCatalog);
  return typeof value === 'string' ? value : undefined;
};

const stableT = (
  key: string,
  options?: string | { defaultValue?: string; [k: string]: unknown },
) => {
  if (typeof options === 'string') {
    return options;
  }
  const template = resolveCatalogKey(key) ?? options?.defaultValue ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => {
    const v = options?.[name];
    return v === undefined ? match : String(v);
  });
};

const stableI18n = { language: 'en' };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));

vi.mock('@product/chat/context', () => ({
  useAIChatContext: () => ({
    pathname: '/msp',
    screen: { key: 'msp', label: 'MSP Portal' },
  }),
  AIChatContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RightSidebar from '@ee/components/layout/RightSidebar';
import {
  addMessageToChatAction,
  createNewChatAction,
} from '@ee/lib/chat-actions/chatActions';

(globalThis as unknown as { React?: typeof React }).React = React;

// RightSidebar gates rendering on the AI Assistant add-on, resolved from the
// session-backed TierContext. Stub the hook so the chat surface renders without
// wiring up a full NextAuth session.
vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasAddOn: () => true }),
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    __esModule: true,
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogTrigger: passthrough,
  };
});

vi.mock('@alga-psa/ui/components/Button', () => ({
  __esModule: true,
  Button: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  __esModule: true,
  Switch: () => null,
}));

vi.mock('@ee/lib/chat-actions/chatActions', () => ({
  createNewChatAction: vi.fn(),
  addMessageToChatAction: vi.fn(),
  getChatMessagesAction: vi.fn(),
}));

const createControlledSseResponse = () => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });

  return {
    response,
    send: (payload: Record<string, unknown>) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // stream already closed/canceled
      }
    },
    close: () => {
      try {
        controller.close();
      } catch {
        // stream already closed/canceled
      }
    },
  };
};

// jsdom does not implement Element.scrollTo; the Chat auto-scrolls on new
// messages, so provide a no-op.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

describe('RightSidebar (streaming)', () => {
  beforeEach(() => {
    vi.mocked(createNewChatAction).mockReset();
    vi.mocked(addMessageToChatAction).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders streaming Chat and posts to the streaming completions endpoint', async () => {
    expect(RightSidebar).toBeDefined();

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        removeItem: vi.fn(),
        getItem: vi.fn(),
        setItem: vi.fn(),
      },
    });

    vi.mocked(createNewChatAction).mockResolvedValueOnce({ _id: 'chat-1' });
    vi
      .mocked(addMessageToChatAction)
      .mockResolvedValueOnce({ _id: 'user-message-id' })
      .mockResolvedValueOnce({ _id: 'assistant-message-id' });

    const sse = createControlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(sse.response);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RightSidebar
        isOpen
        setIsOpen={vi.fn()}
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userId="user-1"
        userRole="admin"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText('Send a message', {}, { timeout: 5000 }), {
      target: { value: 'Ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/v1/completions/stream',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    await act(async () => {
      sse.send({ content: 'Hello', done: false });
      sse.send({ content: '', done: true });
      sse.close();
    });
  });

  it('handles function proposal approval via /api/chat/v1/execute in sidebar chat', async () => {
    expect(RightSidebar).toBeDefined();

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        removeItem: vi.fn(),
        getItem: vi.fn(),
        setItem: vi.fn(),
      },
    });

    vi.mocked(createNewChatAction).mockResolvedValueOnce({ _id: 'chat-1' });
    vi
      .mocked(addMessageToChatAction)
      .mockResolvedValueOnce({ _id: 'user-message-id' })
      .mockResolvedValueOnce({ _id: 'assistant-message-id' });

    const sse = createControlledSseResponse();
    const executeBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (url === '/api/chat/v1/completions/stream') {
        return sse.response;
      }

      if (url === '/api/chat/v1/execute') {
        executeBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            type: 'assistant_message',
            message: { role: 'assistant', content: 'Execution complete.' },
            nextMessages: [{ role: 'assistant', content: 'Execution complete.' }],
            modelMessages: [{ role: 'assistant', content: 'Execution complete.' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RightSidebar
        isOpen
        setIsOpen={vi.fn()}
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userId="user-1"
        userRole="admin"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
      />,
    );

    fireEvent.change(await screen.findByPlaceholderText('Send a message', {}, { timeout: 5000 }), {
      target: { value: 'Ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/v1/completions/stream',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    await act(async () => {
      sse.send({
        type: 'function_proposed',
        function: {
          id: 'tickets.list',
          displayName: 'List tickets',
          description: 'Lists tickets',
          approvalRequired: true,
          arguments: { entryId: 'tickets.list' },
        },
        assistantPreview: 'I need to run this endpoint first.',
        assistantReasoning: 'Collect context first',
        functionCall: {
          name: 'call_api_endpoint',
          arguments: { entryId: 'tickets.list' },
          toolCallId: 'sidebar-tool-1',
          entryId: 'tickets.list',
        },
        nextMessages: [{ role: 'assistant', content: 'I need to run this endpoint first.' }],
        modelMessages: [{ role: 'assistant', content: 'I need to run this endpoint first.' }],
      });
      sse.send({ type: 'done', done: true });
      sse.close();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/v1/execute',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(executeBodies[0]).toMatchObject({
      action: 'approve',
      functionCall: {
        name: 'call_api_endpoint',
        toolCallId: 'sidebar-tool-1',
      },
    });
  });
});
