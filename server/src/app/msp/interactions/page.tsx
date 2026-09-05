import React from 'react';
import { loadMspInteractionsPageData } from '@alga-psa/msp-composition/clients/loadMspInteractionsPageData';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import InteractionsPageWorkspace from './InteractionsPageWorkspace';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/core');

  return {
    title: t('nav.interactions', { defaultValue: 'Interactions' }),
  };
}

export default async function InteractionsPage() {
  const data = await loadMspInteractionsPageData();
  return <InteractionsPageWorkspace {...data} />;
}

export const dynamic = 'force-dynamic';
