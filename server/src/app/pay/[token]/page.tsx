import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Card } from '@alga-psa/ui/components/Card';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { resolvePayLink, type PayLinkFallbackReason } from '@alga-psa/billing/actions/payLinkResolver';

// Every visit must evaluate the invoice and (maybe) mint a Checkout Session.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return {
    title: t('pay.title', { defaultValue: 'Pay Invoice' }),
    // The URL path is a bearer credential: keep it out of indexes and Referer headers.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function PublicInvoicePayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // No user session: tenant comes only from the verified token. The balance is
  // recomputed server-side; the redirect target is always the provider's URL.
  const resolution = await resolvePayLink(token);

  if (resolution.kind === 'redirect') {
    // Called outside any try/catch: redirect() works by throwing.
    redirect(resolution.url);
  }

  const { t } = await getServerTranslation(undefined, 'client-portal');
  const messages: Record<PayLinkFallbackReason, string> = {
    expired: t('account.billing.payLink.expired', { defaultValue: 'This payment link has expired.' }),
    invalid: t('account.billing.payLink.invalid', { defaultValue: "This payment link isn't valid." }),
    not_payable: t('account.billing.payLink.notPayable', {
      defaultValue: 'This invoice can no longer be paid with this link. It may already be paid or no longer be open for online payment.',
    }),
    unavailable: t('account.billing.payLink.unavailable', {
      defaultValue: "We couldn't open the payment page right now. Please try again in a few minutes.",
    }),
  };

  return (
    <main className="mx-auto max-w-lg p-6">
      <Card className="p-6" id="pay-link-fallback">
        <h1 className="text-xl font-semibold">
          {t('account.billing.payLink.heading', { defaultValue: "This payment link can't be used" })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {messages[resolution.reason]}
        </p>
        {resolution.portalUrl ? (
          <p className="mt-4">
            <a
              id="pay-link-view-in-portal"
              href={resolution.portalUrl}
              className="text-sm font-medium text-primary-600 underline"
            >
              {t('account.billing.payLink.viewInPortal', { defaultValue: 'View invoice in the client portal' })}
            </a>
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {t('account.billing.payLink.contactProvider', { defaultValue: 'Please contact your billing provider for a new link.' })}
          </p>
        )}
      </Card>
    </main>
  );
}
