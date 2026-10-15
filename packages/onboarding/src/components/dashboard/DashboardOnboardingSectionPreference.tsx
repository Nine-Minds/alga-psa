'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePostHog } from 'posthog-js/react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Button } from '@alga-psa/ui/components/Button';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import type { ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import {
  getDashboardOnboardingSectionDismissedAction,
  restoreDashboardOnboardingSectionAction,
} from '@alga-psa/onboarding/actions';

export default function DashboardOnboardingSectionPreference() {
  const { t } = useTranslation(['msp/dashboard', 'msp/profile']);
  const router = useRouter();
  const posthog = usePostHog();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const label = t('msp/dashboard:onboarding.preferences.restoreSection', { defaultValue: 'Restore onboarding section' });
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'restore-dashboard-onboarding-section',
    type: 'button',
    label,
    variant: 'outline',
  });

  useEffect(() => {
    let active = true;
    void getDashboardOnboardingSectionDismissedAction().then((result) => {
      if (active) {
        setIsDismissed(result.success && result.data?.dismissed === true);
        setIsLoaded(true);
      }
    }).catch((error) => {
      console.error('Failed to load dashboard onboarding section preference:', error);
      if (active) {
        setIsDismissed(false);
        setIsLoaded(true);
      }
    });
    return () => { active = false; };
  }, []);

  const handleRestore = () => {
    if (isPending) return;
    startTransition(async () => {
      try {
        const result = await restoreDashboardOnboardingSectionAction();
        if (!result.success) {
          throw new Error(result.error || t('msp/dashboard:onboarding.errors.restoreSectionFailed', {
            defaultValue: 'Failed to restore the onboarding section.',
          }));
        }
        setIsDismissed(false);
        posthog?.capture('onboarding_section_restored', { surface: 'settings_profile' });
        router.refresh();
      } catch (error) {
        handleError(
          error,
          t('msp/dashboard:onboarding.errors.restoreSectionFailed', {
            defaultValue: 'Failed to restore the onboarding section.',
          })
        );
      }
    });
  };

  if (!isLoaded || !isDismissed) return null;

  return (
    <section className="mt-6 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
      <h2 className="text-base font-semibold text-[rgb(var(--color-text-800))]">
        {t('msp/dashboard:onboarding.preferences.title', { defaultValue: 'Dashboard preferences' })}
      </h2>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
        {t('msp/dashboard:onboarding.preferences.description', {
          defaultValue: 'The completed onboarding section is hidden from your dashboard.',
        })}
      </p>
      <Button
        {...automationIdProps}
        id="restore-dashboard-onboarding-section"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={handleRestore}
        disabled={isPending}
      >
        {isPending
          ? t('msp/dashboard:onboarding.cta.restoring', { defaultValue: 'Restoring...' })
          : label}
      </Button>
    </section>
  );
}
