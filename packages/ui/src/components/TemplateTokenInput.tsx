'use client';

import React, { useCallback, useRef } from 'react';
import { Button } from './Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Input } from './Input';
import { TextArea } from './TextArea';

export interface TemplateTokenOption {
  /** Inserted as `{{token}}`. */
  token: string;
  /** Primary text in the Insert menu. */
  label: string;
  /** Muted text beside the label, e.g. the field key. */
  secondary?: string;
}

type CaretElement = Pick<HTMLInputElement | HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'>;

// Keys that move focus or only modify other keys; they don't place the caret.
const NON_PLACING_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape', 'CapsLock']);

const OPEN_PLACEHOLDER_BEFORE_CARET = /\{\{\s*([A-Za-z0-9_.-]*)$/;

/**
 * Inserts `{{token}}` at the caret, replacing any selection. A placeholder the author already started
 * (`{{emp`) is completed instead of duplicated.
 */
export function insertTemplateToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  token: string
): { text: string; caret: number } {
  const before = text.slice(0, selectionStart);
  const open = selectionStart === selectionEnd ? OPEN_PLACEHOLDER_BEFORE_CARET.exec(before) : null;
  const start = open && (!open[1] || token.startsWith(open[1])) ? selectionStart - open[0].length : selectionStart;
  const placeholder = `{{${token}}}`;
  return { text: text.slice(0, start) + placeholder + text.slice(selectionEnd), caret: start + placeholder.length };
}

/**
 * Tracks whether the caret sits where the author put it. Choosing a menu item blurs the box, and a native
 * input reports a caret even when the author never placed one, so "never placed a caret" is tracked
 * separately. A click places the caret (including the click that focuses the box), and so does typing or
 * moving with the keyboard. Keyboard focus (Tab) does not: the browser selects the whole text, and an
 * insert must not replace it.
 */
function createCaretIntent() {
  let deliberate = false;
  return {
    onFocus() {
      deliberate = false;
    },
    onMouseUp() {
      deliberate = true;
    },
    onKeyDown(key: string) {
      if (NON_PLACING_KEYS.has(key)) return;
      deliberate = true;
    },
    onInserted() {
      deliberate = true;
    },
    insertionRange(element: CaretElement | null, textLength: number) {
      if (!deliberate || !element || element.selectionStart === null || element.selectionEnd === null) {
        return { start: textLength, end: textLength };
      }
      return { start: element.selectionStart, end: element.selectionEnd };
    },
  };
}

export interface TemplateTokenInputProps {
  /** Id of the text box. The Insert button is `${id}-insert` and each item `${id}-insert-${token}`. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Tokens offered in the Insert menu, in display order. */
  tokens: TemplateTokenOption[];
  /** Renders the standard `TextArea` instead of a single-line `Input`. */
  multiline?: boolean;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** Inline error shown under the box. */
  error?: string;
  helperText?: string;
  insertLabel?: string;
  /** Shown instead of the menu's items hint when `tokens` is empty; the menu is disabled. */
  noTokensHint?: string;
  /** Overrides the Insert button id (defaults to `${id}-insert`). */
  insertButtonId?: string;
  className?: string;
}

export function TemplateTokenInput({
  id,
  value,
  onChange,
  tokens,
  multiline = false,
  label,
  placeholder,
  rows = 3,
  disabled,
  error,
  helperText,
  insertLabel = 'Insert field',
  noTokensHint,
  insertButtonId,
  className,
}: TemplateTokenInputProps) {
  const elementRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const intentRef = useRef<ReturnType<typeof createCaretIntent> | null>(null);
  if (!intentRef.current) intentRef.current = createCaretIntent();
  const intent = intentRef.current;

  const setElement = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
    elementRef.current = element;
  }, []);

  const handlers = {
    onFocus: () => intent.onFocus(),
    onMouseUp: () => intent.onMouseUp(),
    onKeyDown: (event: React.KeyboardEvent) => intent.onKeyDown(event.key),
  };

  // Caret to restore once the menu has closed. The menu hands focus back to its trigger on close, so the
  // text box is refocused from onCloseAutoFocus rather than straight after the insert.
  const pendingCaretRef = useRef<number | null>(null);

  const restoreCaret = (caret: number) => {
    const element = elementRef.current;
    element?.focus();
    element?.setSelectionRange(caret, caret);
    // Refocusing isn't the author placing the caret, but the caret after the token is theirs.
    intent.onInserted();
  };

  const insert = (token: string) => {
    // At the caret the author placed, otherwise at the end of the text.
    const { start, end } = intent.insertionRange(elementRef.current, value.length);
    const next = insertTemplateToken(value, start, end, token);
    pendingCaretRef.current = next.caret;
    onChange(next.text);
  };

  const handleMenuCloseAutoFocus = (event: Event) => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    event.preventDefault();
    restoreCaret(caret);
  };

  const errorId = error ? `${id}-error` : undefined;
  const hasTokens = tokens.length > 0;

  return (
    <div className={className}>
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          {multiline ? (
            <TextArea
              id={id}
              ref={setElement as React.Ref<HTMLTextAreaElement>}
              label={label}
              value={value}
              rows={rows}
              wrapperClassName="mb-0"
              placeholder={placeholder}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              onChange={(event) => onChange(event.target.value)}
              {...handlers}
            />
          ) : (
            <Input
              id={id}
              ref={setElement as React.Ref<HTMLInputElement>}
              label={label}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              hasError={Boolean(error)}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              // The Insert action restores the caret itself; the input's own restore would undo it.
              preserveCursor={false}
              onChange={(event) => onChange(event.target.value)}
              {...handlers}
            />
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={insertButtonId ?? `${id}-insert`}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !hasTokens}
            >
              {insertLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-72 overflow-y-auto"
            onCloseAutoFocus={handleMenuCloseAutoFocus}
          >
            {tokens.map((option) => (
              <DropdownMenuItem
                key={option.token}
                id={`${id}-insert-${option.token}`}
                onSelect={() => insert(option.token)}
              >
                <span>{option.label}</span>
                {option.secondary ? (
                  <span className="ml-2 text-xs text-muted-foreground">{option.secondary}</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!hasTokens && noTokensHint ? <p className="mt-1 text-xs text-muted-foreground">{noTokensHint}</p> : null}
      {helperText ? <p className="mt-1 text-xs text-muted-foreground">{helperText}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default TemplateTokenInput;
