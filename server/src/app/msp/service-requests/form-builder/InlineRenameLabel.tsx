'use client';

/**
 * A label on the canvas you can rename in place. Clicking the selected element's label puts a
 * caret in it; Enter or leaving the field commits; Escape cancels. The inspector's label field
 * shows the same value and stays editable, and a rename is one undo step because the draft is
 * only touched on commit.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface InlineRenameLabelProps {
  id: string;
  value: string;
  /** Only the selected element can be renamed in place. */
  editable: boolean;
  onCommit: (next: string) => void;
  /** Set by the parent when a keyboard shortcut asked for a rename. */
  startEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  renameHint: string;
  className?: string;
}

export function InlineRenameLabel({
  id,
  value,
  editable,
  onCommit,
  startEditing = false,
  onEditingChange,
  renameHint,
  className,
}: InlineRenameLabelProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const setEditing = (next: boolean) => {
    setIsEditing(next);
    onEditingChange?.(next);
  };

  useEffect(() => {
    if (startEditing && editable && !isEditing) {
      setDraft(value);
      setEditing(true);
    }
    // `startEditing` is a request from the parent; it resets itself through onEditingChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing, editable]);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!editable && isEditing) {
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) {
      onCommit(next);
    } else {
      setDraft(value);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        id={`${id}-rename`}
        value={draft}
        aria-label={renameHint}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`w-full max-w-full rounded border border-[rgb(var(--color-primary-400))] bg-[rgb(var(--color-background))] px-1 py-0 text-inherit font-inherit focus:outline-none focus:ring-1 focus:ring-[rgb(var(--color-primary-400))] ${className ?? ''}`.trim()}
      />
    );
  }

  return (
    <span
      id={id}
      title={editable ? renameHint : undefined}
      className={`${editable ? 'cursor-text rounded px-0.5 hover:bg-[rgb(var(--color-border-100))]' : ''} ${className ?? ''}`.trim()}
      onClick={(event) => {
        if (!editable) return;
        event.stopPropagation();
        event.preventDefault();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
