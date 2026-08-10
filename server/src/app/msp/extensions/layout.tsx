import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.extensions.layout.title', { defaultValue: 'Extensions' }),
  };
}

interface LayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: Readonly<LayoutProps>) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/extensions', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  return children;
}
