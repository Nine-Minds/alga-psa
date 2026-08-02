import React from 'react';
import AccountManagement from '@/empty/components/settings/account/AccountManagement';
import { ADD_ONS, type AddOnKey } from '@alga-psa/types';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

type AddOnsPageProps = {
  searchParams: Promise<{ addon?: string | string[] }>;
};

const ADD_ON_KEYS = new Set<string>(Object.values(ADD_ONS));

function parseSelectedAddOn(addon: string | string[] | undefined): AddOnKey | undefined {
  return typeof addon === 'string' && ADD_ON_KEYS.has(addon) ? (addon as AddOnKey) : undefined;
}

export default async function AddOnsPage({ searchParams }: AddOnsPageProps) {
  const [{ addon }, { t }] = await Promise.all([searchParams, getServerTranslation(undefined, 'msp/account')]);
  const selectedAddOn = parseSelectedAddOn(addon);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('addOns.title')}</h1>
      <AccountManagement selectedAddOn={selectedAddOn} />
    </div>
  );
}
