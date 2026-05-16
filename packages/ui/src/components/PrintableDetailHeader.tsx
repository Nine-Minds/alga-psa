'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export type PrintableDetailField = {
  label: React.ReactNode;
  value: React.ReactNode;
};

export interface PrintableDetailHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  fields?: PrintableDetailField[];
  className?: string;
}

export function PrintableDetailHeader({
  title,
  subtitle,
  fields,
  className,
}: PrintableDetailHeaderProps) {
  const visibleFields = (fields ?? []).filter((field) => {
    if (field.value === null || field.value === undefined) return false;
    if (typeof field.value === 'string' && field.value.trim() === '') return false;
    return true;
  });

  return (
    <section className={cn('app-print-detail-header', className)}>
      <header>
        <h1>{title}</h1>
        {subtitle ? <p className="app-print-detail-subtitle">{subtitle}</p> : null}
      </header>
      {visibleFields.length > 0 ? (
        <dl className="app-print-detail-fields">
          {visibleFields.map((field, idx) => (
            <div key={idx} className="app-print-detail-field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
