import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.addOns.layout.title', { defaultValue: 'Add-ons' }),
  };
}

export default function AddOnsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
