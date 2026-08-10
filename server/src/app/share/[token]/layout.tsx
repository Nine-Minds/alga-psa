import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('share.detail.layout.title', { defaultValue: 'Shared Document' }),
  };
}

export default function ShareTokenLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
