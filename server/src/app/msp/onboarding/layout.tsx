import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.onboarding.layout.title', { defaultValue: 'Onboarding' }),
  };
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Onboarding has its own layout without navigation
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
