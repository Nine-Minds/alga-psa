import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// This template overrides the root layout's template for all /auth/* pages.
// The default includes the suffix because defaults bypass their own template.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: {
      // '%s' is Next's own slot for the child route's title, not an i18next
      // placeholder — it passes through translation untouched.
      template: '%s | AlgaPSA',
      default: t('auth.layout.defaultTitle', { defaultValue: 'Sign In | AlgaPSA' }),
    },
  };
}

export default function AuthLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <>{children}</>;
}
