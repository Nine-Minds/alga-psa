'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

export type WelcomeBannerVariant = 'gradient' | 'plain';

interface WelcomeBannerProps {
  title: string;
  description: string;
  variant?: WelcomeBannerVariant;
}

function getGreetingKey(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export default function WelcomeBanner({ title, description, variant = 'plain' }: WelcomeBannerProps) {
  const { t } = useTranslation('msp/dashboard');
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (mounted) setFirstName(user?.first_name || '');
      } catch {
        /* ignore — banner falls back to non-personalized greeting */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const greetingKey = getGreetingKey();
  const greetingPart = t(`greeting.${greetingKey}`, {
    defaultValue:
      greetingKey === 'morning'
        ? 'Good morning'
        : greetingKey === 'afternoon'
          ? 'Good afternoon'
          : 'Good evening',
  });
  const greetingLine = firstName ? `${greetingPart}, ${firstName}` : greetingPart;

  if (variant === 'gradient') {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-violet-600 to-cyan-500 px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.12)]">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-white/80">
              {greetingLine}
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-white/80">{description}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[rgb(var(--color-border-200))] bg-white px-6 py-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))]">
          <Sparkles className="h-5 w-5" style={{ color: 'rgb(var(--color-primary-500))' }} />
        </div>
        <div className="min-w-0">
          <div
            className="text-xs font-medium uppercase tracking-wider"
            style={{ color: 'rgb(var(--color-text-500))' }}
          >
            {greetingLine}
          </div>
          <h1
            className="text-xl font-semibold tracking-tight"
            style={{ color: 'rgb(var(--color-text-900))' }}
          >
            {title}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
