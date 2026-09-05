'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';

export type WelcomeBannerVariant = 'gradient' | 'plain';

export function timeOfDayGreetingKey(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export interface WelcomeBannerProps {
  title: string;
  description?: string;
  /** Omit and the greeting stays impersonal rather than reading "Good morning, ". */
  firstName?: string;
  variant?: WelcomeBannerVariant;
  id?: string;
}

/**
 * The "Good morning, {name}" header. One component for every workspace that
 * greets the user — home, and the opportunities queue — so the wording and the
 * time-of-day boundaries can never drift apart.
 */
const GREETING_DEFAULTS = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
} as const;

export function WelcomeBanner({ title, description, firstName, variant = 'plain', id }: WelcomeBannerProps) {
  const { t } = useTranslation('msp/dashboard');
  const greetingKey = timeOfDayGreetingKey();
  // The personalized line is a whole translated string with a {{name}}
  // placeholder, so locales decide where (and how) the name sits — never a
  // hardcoded "greeting, name" concatenation.
  const greetingLine = firstName
    ? t(`greeting.${greetingKey}WithName`, {
        defaultValue: `${GREETING_DEFAULTS[greetingKey]}, {{name}}`,
        name: firstName,
      })
    : t(`greeting.${greetingKey}`, { defaultValue: GREETING_DEFAULTS[greetingKey] });

  if (variant === 'gradient') {
    return (
      <div
        id={id}
        className="overflow-hidden rounded-2xl border border-[rgb(var(--color-border-200))] bg-gradient-to-r from-[rgb(var(--color-primary-500))] to-[rgb(var(--color-secondary-500))] px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.12)]"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-white/80">{greetingLine}</div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
            {description ? <p className="mt-1 text-sm text-white/80">{description}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id={id}
      className="overflow-hidden rounded-2xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-6 py-5 card-elevated"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--color-primary-50))] ring-1 ring-[rgb(var(--color-border-200))]">
          <Sparkles className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-[rgb(var(--color-text-500))]">
            {greetingLine}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-[rgb(var(--color-text-900))]">{title}</h1>
          {description ? <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default WelcomeBanner;
