'use client';

import Link from 'next/link';
import { AlertTriangle, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ProductRouteBehavior } from '@/lib/productSurfaceRegistry';

interface ProductRouteBoundaryProps {
  behavior: Extract<ProductRouteBehavior, 'upgrade_boundary' | 'not_found'>;
  scope: 'msp' | 'client-portal';
}

const SCOPE_HOME: Record<ProductRouteBoundaryProps['scope'], string> = {
  msp: '/msp/dashboard',
  'client-portal': '/client-portal/dashboard',
};

export function ProductRouteBoundary({ behavior, scope }: ProductRouteBoundaryProps) {
  const { t } = useTranslation('common');
  const isUpgradeBoundary = behavior === 'upgrade_boundary';
  const title = isUpgradeBoundary
    ? t('productBoundary.upgrade.title', { defaultValue: 'Available in AlgaPSA' })
    : t('productBoundary.notFound.title', { defaultValue: 'Page not available' });
  const description = isUpgradeBoundary
    ? t('productBoundary.upgrade.description', {
        defaultValue:
          'This area is part of the full AlgaPSA product. AlgaDesk includes focused help desk functionality only.',
      })
    : t('productBoundary.notFound.description', {
        defaultValue: 'This page is not available in your current product experience.',
      });
  const cta = isUpgradeBoundary
    ? t('productBoundary.upgrade.cta', { defaultValue: 'Return to AlgaDesk dashboard' })
    : t('productBoundary.notFound.cta', { defaultValue: 'Go to dashboard' });
  const homeHref = SCOPE_HOME[scope];

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {isUpgradeBoundary ? <Lock className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm text-[rgb(var(--color-primary-600))] hover:underline" href={homeHref}>
            {cta}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
