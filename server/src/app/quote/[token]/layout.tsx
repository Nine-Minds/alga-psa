import type { Metadata } from 'next';
import { getServerTranslation, resolveRequestLocale } from '@alga-psa/ui/lib/i18n/serverOnly';

// Public, token-in-URL surface. The URL is a bearer credential: keep it out of
// search indexes and out of Referer headers. (Middleware sets the matching
// Referrer-Policy / X-Robots-Tag response headers.)
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(await resolveRequestLocale(), 'features/billing');
  return {
    title: t('quotes.public.metaTitle', { defaultValue: 'Quote review' }),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

// Intentionally no portal chrome: no nav, no session-bound providers.
export default function PublicQuoteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="min-h-screen bg-background text-foreground">{children}</main>;
}
