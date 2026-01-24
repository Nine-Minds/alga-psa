/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import Chat from '@ee/components/chat/Chat';
import { addMessageToChatAction } from '@ee/lib/chat-actions/chatActions';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  __esModule: true,
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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
    send: (payload: { content: string; done: boolean }) => {
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

const getIncomingAssistantContent = () => {
  const nodes = Array.from(
    document.querySelectorAll(
      '.message-wrapper--assistant .message-bubble--assistant .message-content',
    ),
  );
  const last = nodes.at(-1);
  if (!last) {
    throw new Error('Expected an assistant message to be rendered');
  }
  return last;
};

describe('EE Chat (streaming state)', () => {
  it('updates the in-progress assistant message as tokens arrive', async () => {
    expect(Chat).toBeDefined();
    vi
      .mocked(addMessageToChatAction)
      .mockResolvedValueOnce({ _id: 'user-message-id' })
      .mockResolvedValueOnce({ _id: 'assistant-message-id' });

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

    const sse = createControlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(sse.response);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Chat
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userRole="admin"
        userId="user-1"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
        onUserInput={vi.fn()}
        hf={null}
        initialChatId="chat-1"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Send a message'), {
      target: { value: 'Ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getIncomingAssistantContent()).toHaveTextContent('Thinking...'));

    sse.send({ content: 'Hel', done: false });
    await waitFor(() =>
      expect(getIncomingAssistantContent()).toHaveTextContent('Hel'),
    );
    expect(getIncomingAssistantContent()).not.toHaveTextContent('Hello');

    sse.send({ content: 'lo', done: false });
    await waitFor(() =>
      expect(getIncomingAssistantContent()).toHaveTextContent('Hello'),
    );

    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
  });

  it('aborts the streaming request when Stop is clicked', async () => {
    expect(Chat).toBeDefined();

    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    vi
      .mocked(addMessageToChatAction)
      .mockResolvedValueOnce({ _id: 'user-message-id' });

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

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      },
    );

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('Aborted', 'AbortError'));
      });
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: 'Hi', done: false })}\n\n`));
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Chat
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userRole="admin"
        userId="user-1"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
        onUserInput={vi.fn()}
        hf={null}
        initialChatId="chat-1"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Send a message'), {
      target: { value: 'Ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'STOP' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'STOP' }));

    await waitFor(() => expect(abortSpy).toHaveBeenCalledTimes(1));
  });

  it('stops updating token display and ends generation state after Stop', async () => {
    expect(Chat).toBeDefined();

    vi
      .mocked(addMessageToChatAction)
      .mockResolvedValueOnce({ _id: 'user-message-id' });

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

    const sse = createControlledSseResponse();
    const fetchMock = vi.fn().mockResolvedValue(sse.response);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Chat
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userRole="admin"
        userId="user-1"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
        onUserInput={vi.fn()}
        hf={null}
        initialChatId="chat-1"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Send a message'), {
      target: { value: 'Ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    sse.send({ content: 'Hello', done: false });
    await waitFor(() => expect(getIncomingAssistantContent()).toHaveTextContent('Hello'));

    fireEvent.click(screen.getByRole('button', { name: 'STOP' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
    expect(screen.getByPlaceholderText('Send a message')).toBeEnabled();

    sse.send({ content: ' world', done: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getIncomingAssistantContent()).toHaveTextContent('Hello');
    expect(getIncomingAssistantContent()).not.toHaveTextContent('Hello world');

    sse.close();
  });
});
