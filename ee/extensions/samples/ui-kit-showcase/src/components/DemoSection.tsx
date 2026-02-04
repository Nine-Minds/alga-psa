import React from 'react';

export function DemoSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 20 }}>{title}</h2>
        <p style={{ margin: 0, color: 'var(--alga-muted-fg)' }}>{description}</p>
      </div>
      <div
        style={{
          border: '1px solid var(--alga-border)',
          borderRadius: 'var(--alga-radius)',
          padding: 16,
          background: 'var(--alga-bg)',
        }}
      >
        {children}
      </div>
    </section>
  );
}
