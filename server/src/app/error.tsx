'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>{t('pages.errors.somethingWentWrong')}</h1>
      <p>{error.message}</p>
      <button onClick={() => reset()}>{t('pages.actions.tryAgain')}</button>
    </div>
  );
}