import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.tickets.recurring.title', { defaultValue: 'Recurring tickets' }),
  };
}

export default function RecurringTicketsLayout({ children }: { children: ReactNode }) {
  return children;
}
