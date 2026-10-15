import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import BillingSettingsBody from './BillingSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('billing');
}

export default async function BillingSettingsRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Tax configuration now lives in the Billing dashboard's Tax hub. Keep the old
  // settings deep-link working by forwarding it there instead of landing on an
  // empty section.
  const resolvedSearchParams = await searchParams;
  const section = typeof resolvedSearchParams?.section === 'string' ? resolvedSearchParams.section : undefined;
  if (section?.toLowerCase() === 'tax') {
    redirect('/msp/billing?tab=tax-rates');
  }

  return (
    <SettingsTab tabId="billing">
      <BillingSettingsBody />
    </SettingsTab>
  );
}
