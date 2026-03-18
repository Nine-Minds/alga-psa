import { Editor, type AnyExtension, type Content } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { convertBlockContentToHTML } from '../../../formatting/src/blocknoteUtils';
import type {
  TicketMobileEditorCommand,
  TicketMobileEditorInitPayload,
  TicketMobileEditorNativeToWebMessage,
  TicketMobileEditorRequest,
  TicketMobileEditorWebToNativeMessage,
  TicketMobileRichTextDocument,
  TicketMobileRichTextFormat,
  TicketRichTextProseMirrorDoc,
} from './ticketRichText';
import {
  convertProseMirrorToTicketRichTextBlocks,
  parseTicketMobileRichTextDocument,
} from './ticketRichText';
import { parseTicketMobileEditorNativeToWebMessage } from './ticketMobileEditorBridge';

const blockStateTypes = new Set([
  'doc',
  'paragraph',
  'heading',
  'bullet_list',
  'ordered_list',
  'list_item',
  'blockquote',
  'code_block',
]);

type TimerId = ReturnType<typeof setTimeout>;

export type TicketMobileEditorRuntimeOptions = {
  element: HTMLElement;
  emitMessage: (message: TicketMobileEditorWebToNativeMessage) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

export class TicketMobileEditorRuntime {
  private editor: Editor | null = null;

  private readonly element: HTMLElement;

  private readonly emitMessage: (message: TicketMobileEditorWebToNativeMessage) => void;

  private readonly setTimeoutFn: typeof setTimeout;

  private readonly clearTimeoutFn: typeof clearTimeout;

  private contentChangeTimer: TimerId | null = null;

  private debounceMs = 300;

  private ready = false;

  private currentFormat: TicketMobileRichTextFormat = 'blocknote';

  constructor(options: TicketMobileEditorRuntimeOptions) {
    const timerHost = globalThis as typeof globalThis & {
      setTimeout: typeof setTimeout;
      clearTimeout: typeof clearTimeout;
    };

    this.element = options.element;
    this.emitMessage = options.emitMessage;
    this.setTimeoutFn = options.setTimeoutFn ?? timerHost.setTimeout.bind(timerHost);
    this.clearTimeoutFn = options.clearTimeoutFn ?? timerHost.clearTimeout.bind(timerHost);
  }

  getEditor(): Editor | null {
    return this.editor;
  }

  handleMessage(raw: unknown): TicketMobileEditorNativeToWebMessage {
    const message = parseTicketMobileEditorNativeToWebMessage(raw);

    switch (message.type) {
      case 'init':
        this.initialize(message.payload);
        break;
      case 'command':
        this.executeCommand(message.payload.command, message.payload.value);
        break;
      case 'request':
        this.handleRequest(message.payload.requestId, message.payload.request);
        break;
    }

    return message;
  }

  destroy(): void {
    this.clearContentChangeTimer();
    this.ready = false;
    this.editor?.destroy();
    this.editor = null;
  }

  private initialize(payload: TicketMobileEditorInitPayload): void {
    this.clearContentChangeTimer();
    this.debounceMs = payload.debounceMs ?? 300;
    this.ready = false;

    const initialDocument = parseTicketMobileRichTextDocument(payload.content);
    this.currentFormat = initialDocument.format;
    const initialContent = this.toEditorContent(initialDocument);

    if (!this.editor) {
      this.editor = new Editor({
        element: this.element,
        editable: payload.editable,
        extensions: [
          StarterKit.configure({
            link: {
              openOnClick: false,
              autolink: true,
              linkOnPaste: true,
              HTMLAttributes: {
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            },
            underline: {},
          }),
          Image.configure({
            inline: false,
            allowBase64: false,
          }) as AnyExtension,
        ],
        content: initialContent,
        editorProps: {
          attributes: {
            class: 'ticket-mobile-editor',
          },
        },
        onUpdate: () => {
          if (!this.ready) {
            return;
          }

          this.emitStateChange();
          this.scheduleContentChange();
        },
        onSelectionUpdate: () => {
          if (!this.ready) {
            return;
          }

          this.emitStateChange();
        },
        onFocus: () => {
          if (!this.ready) {
            return;
          }

          this.emitStateChange();
        },
        onBlur: () => {
          if (!this.ready) {
            return;
          }

          this.emitStateChange();
          this.flushContentChange();
        },
      });
    } else {
      this.editor.setEditable(payload.editable, false);
      this.editor.commands.setContent(initialContent, { emitUpdate: false });
    }

    this.editor.setEditable(payload.editable, false);
    if (payload.autofocus) {
      this.editor.commands.focus('end');
    }

    this.ready = true;
    this.emitMessage({
      type: 'editor-ready',
      payload: {
        format: this.currentFormat,
        editable: this.editor.isEditable,
      },
    });
    this.emitStateChange();
    this.emitContentHeight();
  }

  private executeCommand(command: TicketMobileEditorCommand, value?: unknown): boolean {
    const editor = this.editor;
    if (!editor) {
      this.emitError('editor-not-ready', `Cannot execute ${command} before initialization`);
      return false;
    }

    switch (command) {
      case 'focus':
        return editor.commands.focus('end');
      case 'blur':
        return editor.commands.blur();
      case 'set-content':
        return this.setContentValue(value);
      case 'set-editable':
        if (typeof value !== 'boolean') {
          this.emitError('invalid-command', 'set-editable requires a boolean value');
          return false;
        }
        editor.setEditable(value);
        this.emitStateChange();
        return true;
      case 'toggle-bold':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().toggleBold().run()
        );
      case 'toggle-italic':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().toggleItalic().run()
        );
      case 'toggle-underline':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().toggleUnderline().run()
        );
      case 'toggle-bullet-list':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().toggleBulletList().run()
        );
      case 'toggle-ordered-list':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().toggleOrderedList().run()
        );
      case 'undo':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().undo().run()
        );
      case 'redo':
        return this.runEditableCommand(editor, (currentEditor) =>
          currentEditor.chain().focus().redo().run()
        );
      default:
        this.emitError('unknown-command', `Unsupported editor command: ${String(command)}`);
        return false;
    }
  }

  private handleRequest(requestId: string, request: TicketMobileEditorRequest): void {
    if (!this.editor) {
      this.emitMessage({
        type: 'error',
        payload: {
          code: 'editor-not-ready',
          message: `Cannot resolve ${request} before initialization`,
          requestId,
        },
      });
      return;
    }

    const value = request === 'get-html'
      ? this.editor.getHTML()
      : this.getNormalizedJsonValue();

    this.emitMessage({
      type: 'response',
      payload: {
        requestId,
        request,
        value,
      },
    });
  }

  private setContentValue(value: unknown): boolean {
    const editor = this.editor;
    if (!editor) {
      this.emitError('editor-not-ready', 'Cannot set content before initialization');
      return false;
    }

    if (typeof value !== 'string' && !this.isRichTextDocument(value)) {
      this.emitError('invalid-command', 'set-content requires a serialized string or parsed document');
      return false;
    }

    const nextDocument = typeof value === 'string'
      ? parseTicketMobileRichTextDocument(value)
      : value;

    this.currentFormat = nextDocument.format;
    const nextContent = this.toEditorContent(nextDocument);
    editor.commands.setContent(nextContent, { emitUpdate: true });
    this.emitStateChange();
    return true;
  }

  private runEditableCommand(editor: Editor, execute: (editor: Editor) => boolean): boolean {
    if (!editor.isEditable) {
      return false;
    }

    const result = execute(editor);
    this.emitStateChange();
    return result;
  }

  private emitStateChange(): void {
    if (!this.editor) {
      return;
    }

    const canRunHistoryCommand = this.editor.isEditable;

    this.emitMessage({
      type: 'state-change',
      payload: {
        ready: this.ready,
        focused: this.editor.isFocused,
        editable: this.editor.isEditable,
        toolbar: {
          bold: this.editor.isActive('bold'),
          italic: this.editor.isActive('italic'),
          underline: this.editor.isActive('underline'),
          bulletList: this.editor.isActive('bulletList'),
          orderedList: this.editor.isActive('orderedList'),
        },
        canUndo: canRunHistoryCommand
          ? this.editor.can().chain().focus().undo().run()
          : false,
        canRedo: canRunHistoryCommand
          ? this.editor.can().chain().focus().redo().run()
          : false,
      },
    });
  }

  private scheduleContentChange(): void {
    this.clearContentChangeTimer();
    this.contentChangeTimer = this.setTimeoutFn(() => {
      this.contentChangeTimer = null;
      this.emitContentChange();
    }, this.debounceMs);
  }

  private flushContentChange(): void {
    if (!this.contentChangeTimer) {
      return;
    }

    this.clearTimeoutFn(this.contentChangeTimer);
    this.contentChangeTimer = null;
    this.emitContentChange();
  }

  private emitContentChange(): void {
    if (!this.editor) {
      return;
    }

    this.emitMessage({
      type: 'content-change',
      payload: {
        html: this.editor.getHTML(),
        json: this.getNormalizedJsonValue(),
      },
    });
    this.emitContentHeight();
  }

  private clearContentChangeTimer(): void {
    if (!this.contentChangeTimer) {
      return;
    }

    this.clearTimeoutFn(this.contentChangeTimer);
    this.contentChangeTimer = null;
  }

  private emitContentHeight(): void {
    const height = this.element.scrollHeight;
    this.emitMessage({
      type: 'content-height',
      payload: { height },
    });
  }

  private emitError(code: string, message: string): void {
    this.emitMessage({
      type: 'error',
      payload: {
        code,
        message,
      },
    });
  }

  private toEditorContent(document: TicketMobileRichTextDocument): Content {
    if (document.sourceFormat === 'empty') {
      return null;
    }

    if (document.format === 'prosemirror') {
      return document.content as Content;
    }

    return convertBlockContentToHTML(document.content);
  }

  private getNormalizedJsonValue() {
    if (!this.editor) {
      return [];
    }

    const json = this.editor.getJSON();
    return this.hasProseMirrorDoc(json)
      ? convertProseMirrorToTicketRichTextBlocks(json)
      : [];
  }

  private isRichTextDocument(value: unknown): value is TicketMobileRichTextDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as {
      format?: unknown;
      sourceFormat?: unknown;
      content?: unknown;
    };

    if ((candidate.format !== 'blocknote' && candidate.format !== 'prosemirror') || !('content' in candidate)) {
      return false;
    }

    if (candidate.format === 'prosemirror') {
      return candidate.sourceFormat === 'prosemirror' && this.hasProseMirrorDoc(candidate.content);
    }

    return (
      (candidate.sourceFormat === 'empty'
        || candidate.sourceFormat === 'plain-text'
        || candidate.sourceFormat === 'blocknote')
      && this.hasBlockContent(candidate.content)
    );
  }

  private hasBlockContent(value: unknown): boolean {
    if (Array.isArray(value)) {
      return true;
    }

    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as { type?: unknown; content?: unknown };
    return candidate.type === 'doc' || (typeof candidate.type === 'string' && blockStateTypes.has(candidate.type));
  }

  private hasProseMirrorDoc(value: unknown): value is TicketRichTextProseMirrorDoc {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as { type?: unknown; content?: unknown };
    return candidate.type === 'doc' && Array.isArray(candidate.content);
  }
}
