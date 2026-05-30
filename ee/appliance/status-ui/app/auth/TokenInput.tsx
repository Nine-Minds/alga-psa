'use client';

import { ClipboardEvent, KeyboardEvent, useRef, useState } from 'react';
import styles from './auth.module.css';
import { TOKEN_GROUPS, TOKEN_DIGIT_COUNT, assembleToken, isComplete, fillFrom, nextEmptyIndex, emptyBoxes, onlyDigits } from './pin';

// Pre-compute the absolute box index where each group starts so the grouped
// render and the flat box array stay in sync.
const GROUP_OFFSETS = TOKEN_GROUPS.reduce<number[]>((offsets, _size, index) => {
  const prev = index === 0 ? 0 : offsets[index - 1] + TOKEN_GROUPS[index - 1];
  offsets.push(prev);
  return offsets;
}, []);

export function TokenInput({
  disabled,
  onChange,
  onSubmit,
}: {
  disabled?: boolean;
  onChange: (token: string, complete: boolean) => void;
  onSubmit: () => void;
}) {
  const [boxes, setBoxes] = useState<string[]>(emptyBoxes);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function commit(next: string[], focusIndex?: number) {
    setBoxes(next);
    onChange(assembleToken(next), isComplete(next));
    if (focusIndex !== undefined) {
      const target = Math.max(0, Math.min(TOKEN_DIGIT_COUNT - 1, focusIndex));
      requestAnimationFrame(() => refs.current[target]?.focus());
    }
  }

  function handleChange(index: number, raw: string) {
    const digits = onlyDigits(raw);
    if (digits.length === 0) {
      // Field cleared.
      const next = boxes.slice();
      next[index] = '';
      commit(next);
      return;
    }
    // A single keystroke yields one digit; a paste into a box yields several.
    const next = fillFrom(boxes, index, digits);
    commit(next, index + digits.length);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = boxes.slice();
      if (next[index]) {
        next[index] = '';
        commit(next, index);
      } else if (index > 0) {
        next[index - 1] = '';
        commit(next, index - 1);
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < TOKEN_DIGIT_COUNT - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
    if (event.key === 'Enter' && isComplete(boxes)) {
      event.preventDefault();
      onSubmit();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    const next = fillFrom(boxes, index, text);
    commit(next, nextEmptyIndex(next, index));
  }

  return (
    <div className={styles.pinGroups} role="group" aria-label="Setup token">
      {TOKEN_GROUPS.map((size, groupIndex) => (
        <span className={styles.pinGroup} key={groupIndex}>
          {groupIndex > 0 ? <span className={styles.pinSep} aria-hidden="true">—</span> : null}
          {Array.from({ length: size }).map((_, withinGroup) => {
            const index = GROUP_OFFSETS[groupIndex] + withinGroup;
            return (
              <input
                key={index}
                ref={(el) => { refs.current[index] = el; }}
                className={styles.pinBox}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                disabled={disabled}
                aria-label={`Digit ${index + 1}`}
                value={boxes[index]}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
              />
            );
          })}
        </span>
      ))}
    </div>
  );
}
