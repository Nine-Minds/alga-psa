import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketMobileEditorWebToNativeMessage } from './ticketRichText';
import { TicketMobileEditorRuntime } from './ticketMobileEditorRuntime';
import type { Editor } from '@tiptap/core';

function getLastMessage<T extends TicketMobileEditorWebToNativeMessage['type']>(
  messages: TicketMobileEditorWebToNativeMessage[],
  type: T
): Extract<TicketMobileEditorWebToNativeMessage, { type: T }> {
  const message = [...messages].reverse().find((entry) => entry.type === type);
  if (!message) {
    throw new Error(`Expected ${type} message`);
  }

  return message as Extract<TicketMobileEditorWebToNativeMessage, { type: T }>;
}

function requireEditor(editor: Editor | null): Editor {
  if (!editor) {
    throw new Error('Expected runtime editor to be initialized');
  }

  return editor;
}

describe('TicketMobileEditorRuntime', () => {
  let container: HTMLDivElement;
  let messages: TicketMobileEditorWebToNativeMessage[];
  let runtime: TicketMobileEditorRuntime;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    messages = [];
    runtime = new TicketMobileEditorRuntime({
      element: container,
      emitMessage: (message) => {
        messages.push(message);
      },
    });
  });

  afterEach(() => {
    runtime.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it('emits editor-ready only after initialization content and configuration have been applied', () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Legacy mobile description',
        editable: false,
      },
    });

    expect(messages[0]).toEqual({
      type: 'editor-ready',
      payload: {
        format: 'blocknote',
        editable: false,
      },
    });
    expect(getLastMessage(messages, 'state-change').payload).toMatchObject({
      ready: true,
      editable: false,
    });

    runtime.handleMessage({
      type: 'request',
      payload: {
        requestId: 'ready-check',
        request: 'get-html',
      },
    });

    expect(getLastMessage(messages, 'response').payload).toMatchObject({
      requestId: 'ready-check',
      request: 'get-html',
      value: expect.stringContaining('Legacy mobile description'),
    });
  });

  it('does not mutate content or apply formatting commands in read-only mode', () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Read only note',
        editable: false,
      },
    });

    const before = runtime.getEditor()?.getJSON();

    runtime.handleMessage({
      type: 'command',
      payload: {
        command: 'toggle-bold',
      },
    });

    expect(runtime.getEditor()?.getJSON()).toEqual(before);

    const statePayload = getLastMessage(messages, 'state-change').payload;
    expect(statePayload.toolbar.bold).toBe(false);
    expect(statePayload.editable).toBe(false);
  });

  it('accepts typing and formatting commands after editable initialization', async () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Hello mobile',
        editable: true,
      },
    });

    const editor = requireEditor(runtime.getEditor());

    editor.commands.selectAll();
    runtime.handleMessage({
      type: 'command',
      payload: {
        command: 'toggle-bold',
      },
    });
    editor.commands.focus('end');
    editor.commands.insertContent(' updated');

    await Promise.resolve();

    const json = editor.getJSON();
    const paragraph = json.content?.[0];

    expect(paragraph?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello mobile updated',
      marks: expect.arrayContaining([{ type: 'bold' }]),
    });
    expect(editor.getHTML()).toContain('updated');
  });

  it('returns BlockNote-style JSON payloads for bridge requests and content-change events', async () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Hello mobile',
        editable: true,
      },
    });

    const editor = requireEditor(runtime.getEditor());
    editor.commands.selectAll();
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-bold' } });
    editor.commands.focus('end');
    editor.commands.insertContent(' updated');

    await Promise.resolve();

    runtime.handleMessage({
      type: 'request',
      payload: {
        requestId: 'json-check',
        request: 'get-json',
      },
    });

    expect(getLastMessage(messages, 'response').payload).toEqual({
      requestId: 'json-check',
      request: 'get-json',
      value: [
        {
          type: 'paragraph',
          props: {
            textAlignment: 'left',
            backgroundColor: 'default',
            textColor: 'default',
          },
          content: [
            {
              type: 'text',
              text: 'Hello mobile updated',
              styles: { bold: true },
            },
          ],
        },
      ],
    });

  });

  it('reports active bold, italic, underline, bullet-list, and ordered-list state changes', () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Toolbar state',
        editable: true,
      },
    });

    const editor = requireEditor(runtime.getEditor());
    editor.commands.selectAll();
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-bold' } });
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-italic' } });
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-underline' } });

    const inlineState = getLastMessage(messages, 'state-change').payload;
    expect(inlineState.toolbar).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
    });

    runtime.destroy();
    messages = [];
    runtime = new TicketMobileEditorRuntime({
      element: container,
      emitMessage: (message) => {
        messages.push(message);
      },
    });
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'List state',
        editable: true,
      },
    });

    const listEditor = requireEditor(runtime.getEditor());
    listEditor.commands.focus('start');
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-bullet-list' } });
    const bulletState = getLastMessage(messages, 'state-change').payload;
    expect(bulletState.toolbar.bulletList).toBe(true);

    listEditor.commands.focus('start');
    runtime.handleMessage({ type: 'command', payload: { command: 'toggle-ordered-list' } });
    const orderedState = getLastMessage(messages, 'state-change').payload;
    expect(orderedState.toolbar.orderedList).toBe(true);
  });

  it('reports undo and redo capability in state-change payloads', async () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Undoable',
        editable: true,
      },
    });

    const editor = requireEditor(runtime.getEditor());
    const initialState = getLastMessage(messages, 'state-change').payload;
    expect(initialState.canUndo).toBe(false);
    expect(initialState.canRedo).toBe(false);

    editor.commands.focus('end');
    editor.commands.insertContent(' change');
    await Promise.resolve();

    const changedState = getLastMessage(messages, 'state-change').payload;
    expect(changedState.canUndo).toBe(true);

    runtime.handleMessage({ type: 'command', payload: { command: 'undo' } });
    const undoneState = getLastMessage(messages, 'state-change').payload;
    expect(undoneState.canRedo).toBe(true);
  });

  it('debounces content-change emissions while still sending state changes promptly', async () => {
    vi.useFakeTimers();

    runtime.destroy();
    messages = [];
    runtime = new TicketMobileEditorRuntime({
      element: container,
      emitMessage: (message) => {
        messages.push(message);
      },
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    runtime.handleMessage({
      type: 'init',
      payload: {
        content: 'Debounce',
        editable: true,
        debounceMs: 250,
      },
    });

    const editor = requireEditor(runtime.getEditor());
    const baselineContentChanges = messages.filter((message) => message.type === 'content-change').length;

    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.commands.insertContent(' now');

    expect(getLastMessage(messages, 'state-change').payload.ready).toBe(true);
    expect(messages.filter((message) => message.type === 'content-change')).toHaveLength(
      baselineContentChanges
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(messages.filter((message) => message.type === 'content-change')).toHaveLength(
      baselineContentChanges
    );

    await vi.advanceTimersByTimeAsync(1);

    const contentMessages = messages.filter((message) => message.type === 'content-change');
    expect(contentMessages).toHaveLength(baselineContentChanges + 1);
    expect(getLastMessage(messages, 'content-change').payload.html).toContain('Debounce');
  });

  it('preserves attachment-backed image content in read-only initialization output', () => {
    runtime.handleMessage({
      type: 'init',
      payload: {
        content: JSON.stringify([
          {
            type: 'image',
            props: {
              url: '/api/documents/view/file-123',
              name: 'clipboard-image.png',
              caption: 'Screenshot',
            },
          },
        ]),
        editable: false,
      },
    });

    const editor = requireEditor(runtime.getEditor());
    expect(editor.getHTML()).toContain('<img');
    expect(editor.getHTML()).toContain('/api/documents/view/file-123');
  });
});
