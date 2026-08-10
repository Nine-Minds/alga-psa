import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.knowledgeBase.layout.title', { defaultValue: 'Knowledge Base' }),
  };
}

export default function ClientPortalKnowledgeBaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
