import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// This template overrides the root layout's template for all /client-portal/* pages.
// The default includes the suffix because defaults bypass their own template.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: {
      // '%s' is Next's own slot for the child route's title, not an i18next
      // placeholder — it passes through translation untouched.
      template: t('clientPortal.layout.titleTemplate', { defaultValue: '%s | Client Portal' }),
      default: t('clientPortal.layout.defaultTitle', { defaultValue: 'Dashboard | Client Portal' }),
    },
  };
}

export default function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
