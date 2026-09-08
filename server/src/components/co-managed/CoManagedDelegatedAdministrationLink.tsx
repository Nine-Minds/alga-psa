'use client';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
export function CoManagedDelegatedAdministrationLink({ operationId }: { operationId?: string }) {
  const { t } = useTranslation('features/co-management-delegation');
  return <Link id="co-delegation-entry" className="text-primary underline" href={`/msp/co-management/administration${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`}>{t('title')}</Link>;
}
