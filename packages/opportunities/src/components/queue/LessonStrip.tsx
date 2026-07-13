'use client';

import React from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import type { IQueueLesson } from '@alga-psa/types';
import { WhySentenceText } from '../WhySentenceText';

/**
 * The teaching moment: one computed insight from the tenant's own history,
 * with a single follow-up action. Never generic methodology content — the
 * insight library only speaks when the numbers support it.
 */
export function LessonStrip({ lesson }: { lesson: IQueueLesson }) {
  return (
    <div
      id="opportunities-queue-lesson"
      className="mb-6 flex items-center gap-3 rounded-xl border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-4 py-3.5 dark:bg-[rgb(var(--color-primary-400)/0.12)]"
    >
      <Sparkles className="h-4 w-4 flex-none text-[rgb(var(--color-primary-500))]" aria-hidden />
      <p className="flex-1 text-[13px] leading-relaxed text-[rgb(var(--color-text-700))]">
        <WhySentenceText why={lesson.why} />
      </p>
      <Button id="opportunities-queue-lesson-action" size="xs" variant="outline" asChild>
        <Link href={lesson.action_href}>{lesson.action_label}</Link>
      </Button>
    </div>
  );
}
