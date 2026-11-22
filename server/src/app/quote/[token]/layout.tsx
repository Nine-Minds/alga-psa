import type { Metadata } from 'next';
import { getServerTranslation, resolveRequestLocale } from '@alga-psa/ui/lib/i18n/serverOnly';
import { resolvePublicQuoteRequest } from '../../../lib/quote/publicQuoteRequest';

// Public, token-in-URL surface. The URL is a bearer credential: keep it out of
// search indexes and out of Referer headers. (Middleware sets the matching
// Referrer-Policy / X-Robots-Tag response headers.)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  // Recipient's language when the link resolves (cached with the page's resolve);
  // otherwise the request's, matching the outcome page.
  const locale = (await resolvePublicQuoteRequest(token)).reader?.locale ?? (await resolveRequestLocale());
  const { t } = await getServerTranslation(locale, 'features/billing');
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
