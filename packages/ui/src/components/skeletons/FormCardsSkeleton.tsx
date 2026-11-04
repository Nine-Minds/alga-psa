'use client';

import React from 'react';
import { Card, CardContent, CardHeader } from '../Card';
import { Skeleton } from '../Skeleton';

interface FormCardsSkeletonProps {
  /** Stable id, so a screen keeps its automation id while the form loads. */
  id?: string;
  /** Accessible name announced while the form loads. */
  label: string;
  /** How many section cards to stand in for. */
  sections?: number;
  /** Label + control pairs inside each card. */
  fields?: number;
}

/** Pulse placeholder shaped like a page of form sections on cards, back link and title band included. */
export default function FormCardsSkeleton({ id, label, sections = 2, fields = 3 }: FormCardsSkeletonProps) {
  return (
    <div id={id} role="status" aria-label={label} className="space-y-6 p-6">
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-8 w-72" />
      </div>
      {Array.from({ length: sections }).map((_, section) => (
        <Card key={`section-${section}`}>
          <CardHeader className="pb-3"><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: fields }).map((_, field) => (
              <div key={`field-${field}`} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
