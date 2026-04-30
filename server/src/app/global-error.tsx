'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <html lang="en">
      <body>
        <div style={{ padding: '50px', textAlign: 'center' }}>
          <h1>{t('pages.errors.somethingWentWrong')}</h1>
          <p>{error.message}</p>
          <button onClick={() => reset()}>{t('pages.actions.tryAgain')}</button>
        </div>
      </body>
    </html>
  );
}
