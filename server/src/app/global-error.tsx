'use client';

// Same crash-safety contract as app/error.tsx, and stricter: global-error
// replaces the root layout entirely, so nothing above it can catch a throw or
// resolve a suspension. react-i18next is imported directly (not the
// @alga-psa/ui wrapper, which cannot pass `useSuspense: false`) and every t()
// carries a defaultValue, so the worst case — i18next never initialised, or
// i18next itself being what crashed — degrades to the English text below
// rather than to a blank document.
import { useTranslation } from 'react-i18next';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, i18n } = useTranslation('common', { useSuspense: false });

  return (
    <html lang={i18n?.language || 'en'} suppressHydrationWarning>
      <body>
        <div style={{ padding: '50px', textAlign: 'center' }}>
          <h1>{t('pages.errors.somethingWentWrong', { defaultValue: 'Something went wrong' })}</h1>
          <p>{error.message}</p>
          <button onClick={() => reset()}>
            {t('pages.actions.tryAgain', { defaultValue: 'Try again' })}
          </button>
        </div>
      </body>
    </html>
  );
}
