import Link from 'next/link';
import { Card } from '@alga-psa/ui/components/Card';
import { getServerTranslation, resolveRequestLocale } from '@alga-psa/ui/lib/i18n/serverOnly';
import { outcomeCopyKey, type PublicQuoteOutcome } from '../../../lib/quote/publicQuoteOutcome';

const DEFAULTS = {
  unavailable: {
    title: "This link isn't available",
    body: 'The link may be mistyped or may no longer be active.',
  },
  expired: {
    title: 'This link has expired',
    body: 'For security, quote links stop working after a while.',
  },
  superseded: {
    title: 'This quote has been replaced',
    body: 'A newer version has been sent. Please use the link in the latest email.',
  },
  decided: {
    title: 'This quote has already been decided',
    body: 'A response has already been recorded, so it can no longer be opened from this link.',
  },
} as const;

/**
 * Friendly terminal state for every non-ok resolve outcome.
 *
 * This component takes ONLY the outcome. It is never given tenant or quote data,
 * so it cannot render any: no tenant name or logo, quote number, amount or expiry.
 * The contact path is generic ("reply to the email you received") because a
 * tenant-specific mailto would itself reveal which tenant owns the token.
 */
export default async function PublicQuoteOutcomeView({ outcome }: { outcome: PublicQuoteOutcome }) {
  const key = outcomeCopyKey(outcome);
  const { t } = await getServerTranslation(await resolveRequestLocale(), 'features/billing');

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-12">
      <Card className="w-full space-y-4 p-8 text-center" id="public-quote-outcome">
        <h1 className="text-xl font-semibold" data-outcome-copy={key}>
          {t(`quotes.public.outcome.${key}.title`, { defaultValue: DEFAULTS[key].title })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(`quotes.public.outcome.${key}.body`, { defaultValue: DEFAULTS[key].body })}
        </p>
        <p className="text-sm">
          {t('quotes.public.outcome.help', {
            defaultValue: 'Need help? Reply to the email you received this link in.',
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('quotes.public.outcome.signInHint', { defaultValue: 'Already have a client portal account?' })}{' '}
          <Link
            id="public-quote-signin-link"
            href="/auth/client-portal/signin"
            className="font-medium text-primary-600 hover:underline"
          >
            {t('quotes.public.outcome.signIn', { defaultValue: 'Sign in to the client portal' })}
          </Link>
        </p>
      </Card>
    </div>
  );
}
