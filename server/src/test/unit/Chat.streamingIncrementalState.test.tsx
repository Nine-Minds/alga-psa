/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    send: (payload: Record<string, unknown>) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // stream already closed/canceled
      }
    },
    error: (error: unknown) => {
      try {
        controller.error(error);
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
  beforeEach(() => {
    vi.mocked(addMessageToChatAction).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

    const latestInput = screen.getAllByPlaceholderText('Send a message').at(-1);
    if (!latestInput) {
      throw new Error('Expected chat input to be rendered');
    }

    fireEvent.change(latestInput, {
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

  it('shows a streaming cursor while receiving tokens', async () => {
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
    expect(document.querySelector('.message-streaming-cursor')).toBeNull();

    sse.send({ content: 'Hello', done: false });
    await waitFor(() => expect(getIncomingAssistantContent()).toHaveTextContent('Hello'));
    await waitFor(() =>
      expect(document.querySelector('.message-streaming-cursor')).toBeInTheDocument(),
    );

    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
  });

  it('removes the streaming cursor when done is received', async () => {
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

    sse.send({ content: 'Hello', done: false });
    await waitFor(() =>
      expect(document.querySelector('.message-streaming-cursor')).toBeInTheDocument(),
    );

    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
    await waitFor(() =>
      expect(document.querySelector('.message-streaming-cursor')).toBeNull(),
    );
  });

  it('sends on Enter in single-line mode', async () => {
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

    const input = screen.getByPlaceholderText('Send a message');
    fireEvent.change(input, {
      target: { value: 'Ping from Enter' },
    });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    sse.send({ content: 'Done', done: false });
    sse.send({ content: '', done: true });
    sse.close();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
  });

  it('uses multiline mode after Shift+Enter and sends with Ctrl+Enter', async () => {
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

    const input = screen.getByPlaceholderText('Send a message');
    fireEvent.change(input, {
      target: { value: 'Line 1' },
    });

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(
      screen.getByText('Multiline mode: Enter adds a new line. Ctrl+Enter or ⌘+Enter sends.'),
    ).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    fireEvent.change(input, {
      target: { value: 'Line 1\nLine 2' },
    });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    sse.send({ content: 'Multiline complete', done: false });
    sse.send({ content: '', done: true });
    sse.close();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
  });

  it('shows the partial response when a network error occurs mid-stream', async () => {
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

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sse.error(new Error('Network down'));

    await waitFor(() => expect(screen.getByText('Interrupted')).toBeInTheDocument());
    expect(getIncomingAssistantContent()).toHaveTextContent('Hello');
    await waitFor(() =>
      expect(screen.getByText(/Connection interrupted/i)).toBeInTheDocument(),
    );
    consoleErrorSpy.mockRestore();
  });

  it('shows an interruption indicator when the stream ends without done=true', async () => {
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

    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
    await waitFor(() => expect(screen.getByText('Interrupted')).toBeInTheDocument());
    expect(getIncomingAssistantContent()).toHaveTextContent('Hello');
    await waitFor(() =>
      expect(screen.getByText(/Connection interrupted/i)).toBeInTheDocument(),
    );
  });

  it('persists the assistant message after streaming completes', async () => {
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

    sse.send({ content: 'Hello', done: false });
    sse.send({ content: ' world', done: false });
    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());

    await waitFor(() =>
      expect(addMessageToChatAction).toHaveBeenCalledWith(
        expect.objectContaining({ chat_role: 'bot' }),
      ),
    );
  });

  it('persists assistant content matching the final streamed tokens', async () => {
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

    sse.send({ content: 'Hello', done: false });
    sse.send({ content: ' world', done: false });
    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());

    await waitFor(() =>
      expect(addMessageToChatAction).toHaveBeenCalledWith(
        expect.objectContaining({ chat_role: 'bot', content: 'Hello world' }),
      ),
    );
  });

  it('updates in-progress reasoning state when reasoning stream events arrive', async () => {
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

    sse.send({ type: 'reasoning_delta', delta: 'Check current ticket state first.' });
    sse.send({ type: 'content_delta', delta: 'Vertex answer' });

    await waitFor(() =>
      expect(getIncomingAssistantContent()).toHaveTextContent('Vertex answer'),
    );
    expect(screen.getByText('Show assistant reasoning')).toBeInTheDocument();
    expect(screen.getByText('Check current ticket state first.')).toBeInTheDocument();

    sse.send({ type: 'done', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
    await waitFor(() =>
      expect(getIncomingAssistantContent()).toHaveTextContent('Vertex answer'),
    );
  });

  it('includes prior assistant reasoning_content in the next streamed request payload', async () => {
    expect(Chat).toBeDefined();

    vi.mocked(addMessageToChatAction).mockResolvedValue({ _id: 'message-id' });

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

    const firstSse = createControlledSseResponse();
    const secondSse = createControlledSseResponse();
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (url !== '/api/chat/v1/completions/stream') {
        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      }

      requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return requestBodies.length === 1 ? firstSse.response : secondSse.response;
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
      target: { value: 'First prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    firstSse.send({ type: 'reasoning_delta', delta: 'Check current ticket state first.' });
    firstSse.send({ type: 'content_delta', delta: 'First answer' });
    firstSse.send({ type: 'done', done: true });
    firstSse.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
    await waitFor(() => expect(screen.getByText('First answer')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Send a message'), {
      target: { value: 'Second prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondRequestMessages = (requestBodies[1]?.messages ?? []) as Array<Record<string, unknown>>;
    const priorAssistantMessage = secondRequestMessages.find(
      (message) => message.role === 'assistant' && message.content === 'First answer',
    );
    expect(priorAssistantMessage).toMatchObject({
      reasoning_content: 'Check current ticket state first.',
    });

    secondSse.send({ type: 'content_delta', delta: 'Second answer' });
    secondSse.send({ type: 'done', done: true });
    secondSse.close();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SEND' })).toBeEnabled());
  });

  it('sets pending function state when a function proposal stream event arrives', async () => {
    expect(Chat).toBeDefined();

    vi.mocked(addMessageToChatAction).mockResolvedValueOnce({ _id: 'user-message-id' });

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

    sse.send({
      type: 'function_proposed',
      function: {
        id: 'tickets.list',
        displayName: 'List tickets',
        description: 'Lists tickets',
        approvalRequired: true,
        arguments: { entryId: 'tickets.list' },
      },
      assistantPreview: 'I need to list tickets before continuing.',
      assistantReasoning: 'Collect context first',
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-pending',
        entryId: 'tickets.list',
      },
      nextMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
      modelMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
    });
    sse.send({ type: 'done', done: true });
    sse.close();

    await waitFor(() =>
      expect(screen.getByText('List tickets')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('posts /api/chat/v1/execute with streamed functionCall metadata when Approve is clicked', async () => {
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/v1/completions/stream',
      expect.objectContaining({ method: 'POST' }),
    ));

    sse.send({
      type: 'function_proposed',
      function: {
        id: 'tickets.list',
        displayName: 'List tickets',
        description: 'Lists tickets',
        approvalRequired: true,
        arguments: { entryId: 'tickets.list' },
      },
      assistantPreview: 'I need to list tickets before continuing.',
      assistantReasoning: 'Collect context first',
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list', query: { status: 'open' } },
        toolCallId: 'tool-call-approve',
        entryId: 'tickets.list',
      },
      nextMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
      modelMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
    });
    sse.send({ type: 'done', done: true });
    sse.close();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/v1/execute',
      expect.objectContaining({ method: 'POST' }),
    ));

    expect(executeBodies).toHaveLength(1);
    expect(executeBodies[0]).toMatchObject({
      action: 'approve',
      functionCall: {
        name: 'call_api_endpoint',
        toolCallId: 'tool-call-approve',
        entryId: 'tickets.list',
      },
    });

    await waitFor(() =>
      expect(addMessageToChatAction).toHaveBeenCalledWith(
        expect.objectContaining({ chat_role: 'bot', content: 'Execution complete.' }),
      ),
    );
  });

  it('posts decline action to /api/chat/v1/execute and keeps conversation usable', async () => {
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
            message: { role: 'assistant', content: 'Declined and continued.' },
            nextMessages: [{ role: 'assistant', content: 'Declined and continued.' }],
            modelMessages: [{ role: 'assistant', content: 'Declined and continued.' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/v1/completions/stream',
      expect.objectContaining({ method: 'POST' }),
    ));

    sse.send({
      type: 'function_proposed',
      function: {
        id: 'tickets.list',
        displayName: 'List tickets',
        description: 'Lists tickets',
        approvalRequired: true,
        arguments: { entryId: 'tickets.list' },
      },
      assistantPreview: 'I need to list tickets before continuing.',
      assistantReasoning: 'Collect context first',
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-decline',
        entryId: 'tickets.list',
      },
      nextMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
      modelMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
    });
    sse.send({ type: 'done', done: true });
    sse.close();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/v1/execute',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(executeBodies[0]).toMatchObject({ action: 'decline' });
    await waitFor(() => expect(screen.getByPlaceholderText('Send a message')).toBeEnabled());
  });

  it('does not persist a false completed assistant message when execute fails', async () => {
    expect(Chat).toBeDefined();

    vi.mocked(addMessageToChatAction).mockResolvedValue({ _id: 'message-id' });

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
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
      if (url === '/api/chat/v1/completions/stream') {
        return sse.response;
      }

      if (url === '/api/chat/v1/execute') {
        return new Response(JSON.stringify({ error: 'Execution failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/v1/completions/stream',
      expect.objectContaining({ method: 'POST' }),
    ));

    sse.send({
      type: 'function_proposed',
      function: {
        id: 'tickets.list',
        displayName: 'List tickets',
        description: 'Lists tickets',
        approvalRequired: true,
        arguments: { entryId: 'tickets.list' },
      },
      assistantPreview: 'I need to list tickets before continuing.',
      assistantReasoning: 'Collect context first',
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-fail',
        entryId: 'tickets.list',
      },
      nextMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
      modelMessages: [{ role: 'assistant', content: 'I need to list tickets before continuing.' }],
    });
    sse.send({ type: 'done', done: true });
    sse.close();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(screen.getByText('Execution failed')).toBeInTheDocument(),
    );
    expect(addMessageToChatAction).toHaveBeenCalledTimes(1);
  });

  it('regenerates from a user message after stream failure and trims later messages', async () => {
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

    const firstSse = createControlledSseResponse();
    const secondSse = createControlledSseResponse();
    let requestCount = 0;
    const fetchMock = vi.fn((_url: unknown) => {
      requestCount += 1;
      return Promise.resolve(requestCount === 1 ? firstSse.response : secondSse.response);
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
    firstSse.send({ content: 'Hello', done: false });
    await waitFor(() => expect(getIncomingAssistantContent()).toHaveTextContent('Hello'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    firstSse.error(new Error('Network down'));

    await waitFor(() => expect(screen.getByText('Interrupted')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Regenerate from this message' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate from this message' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    secondSse.send({ content: 'Recovered', done: false });
    secondSse.send({ content: '', done: true });
    secondSse.close();

    await waitFor(() => expect(screen.getByText('Recovered')).toBeInTheDocument());
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    expect(screen.getAllByText('Ping')).toHaveLength(1);
    expect(addMessageToChatAction).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it('shows regenerate and edit actions on user messages after a successful response', async () => {
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
    sse.send({ content: 'Hello world', done: false });
    sse.send({ content: '', done: true });
    sse.close();

    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Regenerate from this message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit this message' })).toBeInTheDocument();
  });

  it('edits a user message and regenerates from that point', async () => {
    expect(Chat).toBeDefined();

    vi.mocked(addMessageToChatAction).mockResolvedValue({ _id: 'message-id' });

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

    const firstSse = createControlledSseResponse();
    const secondSse = createControlledSseResponse();
    let requestCount = 0;
    const fetchMock = vi.fn((_url: unknown) => {
      requestCount += 1;
      return Promise.resolve(requestCount === 1 ? firstSse.response : secondSse.response);
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
    firstSse.send({ content: 'Original answer', done: false });
    firstSse.send({ content: '', done: true });
    firstSse.close();

    await waitFor(() => expect(screen.getByText('Original answer')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit this message' }));

    const input = screen.getByPlaceholderText('Send a message') as HTMLTextAreaElement;
    expect(input.value).toBe('Ping');

    fireEvent.change(input, {
      target: { value: 'Updated ping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    secondSse.send({ content: 'Updated answer', done: false });
    secondSse.send({ content: '', done: true });
    secondSse.close();

    await waitFor(() => expect(screen.getByText('Updated answer')).toBeInTheDocument());
    expect(screen.queryByText('Original answer')).not.toBeInTheDocument();
    expect(screen.getAllByText('Updated ping')).toHaveLength(1);
    expect(screen.queryByText(/^Ping$/)).not.toBeInTheDocument();
  });
});
