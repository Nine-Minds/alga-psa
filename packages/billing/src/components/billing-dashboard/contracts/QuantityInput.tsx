import React, { useEffect, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';

interface QuantityInputProps {
  id: string;
  value: number;
  min: number;
  /** Receives every parseable edit; the caller clamps/normalizes it. */
  onCommit: (value: number) => void;
  className?: string;
}

/**
 * Number input that lets the user clear the field while typing. A plain
 * controlled `<input type="number">` whose onChange clamps immediately snaps
 * an emptied field back to its minimum, so "1" could never be replaced by "20"
 * without typing "120" and deleting the 1. The draft text is kept locally
 * while focused and re-synced to the committed value on blur.
 */
export function QuantityInput({ id, value, min, onCommit, className }: QuantityInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [value]);

  return (
    <Input
      id={id}
      type="number"
      min={String(min)}
      step="1"
      value={draft ?? String(value)}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = Number(text);
        if (text.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
      className={className}
    />
  );
}
