import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/licensing');

  return {
    title: t('purchasePage.title', { defaultValue: 'Purchase Licenses' }),
  };
}

export default function LicensePurchaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
