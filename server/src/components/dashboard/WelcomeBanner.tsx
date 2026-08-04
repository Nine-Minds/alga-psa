'use client';

import { useEffect, useState } from 'react';
import { WelcomeBanner as UiWelcomeBanner, type WelcomeBannerVariant } from '@alga-psa/ui/components/WelcomeBanner';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

export type { WelcomeBannerVariant };

interface WelcomeBannerProps {
  title: string;
  description: string;
  variant?: WelcomeBannerVariant;
}

/** The dashboard's banner: the shared greeting, personalized with the signed-in user. */
export default function WelcomeBanner({ title, description, variant = 'plain' }: WelcomeBannerProps) {
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (mounted) setFirstName(user?.first_name || '');
      } catch {
        /* ignore — banner falls back to non-personalized greeting */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return <UiWelcomeBanner title={title} description={description} firstName={firstName} variant={variant} />;
}
