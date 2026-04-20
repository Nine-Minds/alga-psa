'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ArrowLeft } from 'lucide-react';

export default function BackButton() {
  const router = useRouter();
  const { t } = useTranslation('msp/credits');

  return (
    <Button
      id="back-to-credits-button"
      variant="soft"
      onClick={() => router.push('/msp/billing?tab=credits')}
    >
      <ArrowLeft className="mr-2 h-4 w-4" /> ← {t('actions.backToCredits', { defaultValue: 'Back to Credits' })}
    </Button>
  );
}
