'use client';

import React from 'react';
import Link from 'next/link';
import { Lock, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Rendered by the marketing pages when the module guard fails — instead of a
 * fake-working module whose every action errors, the user sees why there is
 * nothing here (module off for the tenant, or missing marketing permission).
 */
export function MarketingAccessBoundary({
  reason,
}: {
  reason: 'disabled' | 'permission';
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const disabled = reason === 'disabled';
  const title = disabled
    ? t('marketing.boundary.disabledTitle', 'Marketing is not enabled')
    : t('marketing.boundary.permissionTitle', 'No access to Marketing');
  const description = disabled
    ? t(
        'marketing.boundary.disabledDescription',
        'The marketing module is not enabled for this account.',
      )
    : t(
        'marketing.boundary.permissionDescription',
        'You do not have permission to view marketing. Ask an administrator for the marketing read permission.',
      );

  return (
    <div className="container mx-auto p-6" data-testid="marketing-access-boundary">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {disabled ? <Lock className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
            href="/msp/dashboard"
          >
            {t('marketing.boundary.backToDashboard', 'Go to dashboard')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
