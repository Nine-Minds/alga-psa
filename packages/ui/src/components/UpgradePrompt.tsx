'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';
import { useTranslation } from '../lib/i18n/client';
import { cn } from '../lib/utils';

export const ENTERPRISE_UPGRADE_URL =
  'https://www.nineminds.com/documentation/community-vs-enterprise-edition';

export interface UpgradePromptProps {
  /** User-facing name of the unavailable Enterprise feature. */
  featureName: string;
  /** Short explanation of the value the feature provides. */
  pitch: string;
  /** Unique reflection-system id for the upgrade link. */
  ctaId: string;
  /** Optional localized CTA label. */
  ctaLabel?: string;
  /** Destination where the user can review upgrade options. */
  ctaHref?: string;
  /** Optional context that is useful alongside the upgrade message. */
  children?: ReactNode;
  className?: string;
}

/**
 * Shared Community Edition boundary for features supplied by Enterprise builds.
 */
export function UpgradePrompt({
  featureName,
  pitch,
  ctaId,
  ctaLabel,
  ctaHref = ENTERPRISE_UPGRADE_URL,
  children,
  className,
}: UpgradePromptProps) {
  const { t } = useTranslation('common');
  const isExternalCta = /^https?:\/\//.test(ctaHref);

  return (
    <Card
      className={cn(
        'relative min-w-0 overflow-hidden border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-6',
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[rgb(var(--color-primary-500))]" />
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="mb-4 rounded-full bg-[rgb(var(--color-primary-50))] p-3 text-[rgb(var(--color-primary-600))] dark:bg-[rgb(var(--color-primary-400)/0.15)] dark:text-[rgb(var(--color-primary-300))]">
          <LockKeyhole aria-hidden="true" className="h-5 w-5" />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
          {t('upgradePrompt.editionLabel', { defaultValue: 'Enterprise edition' })}
        </p>
        <h2 className="mt-2 text-lg font-bold text-[rgb(var(--color-text-900))]">
          {featureName}
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-600))]">{pitch}</p>
        <Button id={ctaId} asChild className="mt-5 gap-2">
          <Link
            href={ctaHref}
            target={isExternalCta ? '_blank' : undefined}
            rel={isExternalCta ? 'noopener noreferrer' : undefined}
          >
            {ctaLabel ?? t('upgradePrompt.defaultCta', { defaultValue: 'Explore Enterprise' })}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Button>
        {children ? (
          <div className="mt-4 text-xs text-[rgb(var(--color-text-500))]">{children}</div>
        ) : null}
      </div>
    </Card>
  );
}
