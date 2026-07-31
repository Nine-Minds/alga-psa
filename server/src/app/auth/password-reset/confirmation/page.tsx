import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@alga-psa/ui/components/Button';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { appendPortalDomain } from '@alga-psa/auth/client';
import { getPortalBranding, getPortalDomain, PortalBrandingStyles, type PortalSearchParams } from '@/lib/auth/portalBranding';

interface PasswordResetConfirmationProps {
  searchParams?: Promise<PortalSearchParams>;
}

export default async function PasswordResetConfirmation({
  searchParams,
}: PasswordResetConfirmationProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const portal = typeof resolvedSearchParams?.portal === 'string' ? resolvedSearchParams.portal : 'msp';
  const isClientPortal = portal === 'client';
  const branding = isClientPortal && resolvedSearchParams
    ? await getPortalBranding(resolvedSearchParams)
    : null;
  const portalDomain = isClientPortal && resolvedSearchParams
    ? getPortalDomain(resolvedSearchParams)
    : undefined;
  const signinHref =
    isClientPortal
      ? appendPortalDomain('/auth/client-portal/signin', portalDomain)
      : '/auth/msp/signin';
  const { t } = await getServerTranslation(undefined, 'msp/auth');

  return (
    <div className={`flex flex-col items-center p-20 min-h-screen ${
      branding
        ? 'bg-gradient-to-br from-[rgb(var(--color-primary-50))] to-[rgb(var(--color-secondary-100))] dark:from-[rgb(var(--color-primary-950))] dark:to-[rgb(var(--color-secondary-950))]'
        : 'bg-[rgb(var(--color-background-50))] dark:bg-[rgb(var(--color-background))]'
    }`}>
      <PortalBrandingStyles branding={branding} />
      <div className="w-full max-w-md p-8 space-y-8 text-center">
        <div>
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.clientName || t('passwordReset.confirmation.logoAlt', 'Logo')}
              width={60}
              height={60}
              className="mx-auto h-[60px] w-[60px] rounded-full object-contain"
            />
          ) : (
            <Image
              src="/images/avatar-purple-background.png"
              alt={t('passwordReset.confirmation.logoAlt', 'Logo')}
              width={60}
              height={60}
              className="mx-auto rounded-full"
            />
          )}
        </div>
        <h2 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{t('passwordReset.confirmation.title', 'Password reset')}</h2>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('passwordReset.confirmation.subtitle', 'Your password has been successfully reset.')}
          <br />
          {t('passwordReset.confirmation.subtitleContinue', 'Click below to sign in with your new password.')}
        </p>
        <Link href={signinHref} className="block">
          <Button
            id="proceed-to-sign-in-btn"
            variant="default"
            className="w-full px-4 py-2 text-sm font-medium text-white bg-[rgb(var(--color-primary-600))] rounded-md hover:bg-[rgb(var(--color-primary-700))] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[rgb(var(--color-primary-500))]"
          >
            {t('passwordReset.confirmation.continue', 'Continue')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
