import type { ReactNode } from 'react';

/**
 * The label/value molecule used across credit dialogs and the
 * reconciliation drawer. One implementation, one typography scale.
 */
export default function DetailField({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-[rgb(var(--color-text-500))]">{label}</div>
      <div className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
