import React from 'react';

/** Section band from the queue design: small-caps label, hairline, optional provenance subtitle. */
export function QueueSection({
  id,
  label,
  subtitle,
  children,
}: {
  id: string;
  label: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-8">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
          {label}
        </span>
        <span className="h-px flex-1 bg-[rgb(var(--color-border-200))]" />
        {subtitle ? (
          <span className="text-xs text-[rgb(var(--color-text-400))]">{subtitle}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
