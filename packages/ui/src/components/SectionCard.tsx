'use client';

import React from 'react';
import { Card, CardContent, CardHeader } from './Card';

interface SectionCardProps {
  id?: string;
  /** Section heading, rendered as the card title. */
  title: string;
  /** One compact control for the section header (e.g. "Add clients"). */
  actions?: React.ReactNode;
  /** Layout for the card body; defaults to the stacked form rhythm. */
  bodyClassName?: string;
  children: React.ReactNode;
}

/** One page section on the app's card surface: its heading (plus optional action) over its body. */
export function SectionCard({ id, title, actions, bodyClassName = 'space-y-4', children }: SectionCardProps) {
  return (
    <Card id={id}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{title}</h2>
          {actions}
        </div>
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

export default SectionCard;
