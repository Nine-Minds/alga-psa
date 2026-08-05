'use client';

// Imports react-i18next directly rather than the @alga-psa/ui wrapper on
// purpose. This boundary sits directly under the root layout — outside every
// I18nProvider — and must never throw or suspend, or the crash it is reporting
// becomes a blank page. `useSuspense: false` stops react-i18next from throwing
// a promise when `common` has not loaded (there is no Suspense boundary above
// us to catch it), and each defaultValue keeps the page readable in English
// when i18next was never initialised at all.
import { useTranslation } from 'react-i18next';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const { t } = useTranslation('common', { useSuspense: false });

  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>{t('pages.errors.somethingWentWrong', { defaultValue: 'Something went wrong' })}</h1>
      <p>{error.message}</p>
      <button onClick={() => reset()}>
        {t('pages.actions.tryAgain', { defaultValue: 'Try again' })}
      </button>
    </div>
  );
}
