import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export const dynamic = 'force-dynamic';

export default async function NotFound() {
  const { t } = await getServerTranslation(undefined, 'common');
  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>{t('pages.errors.notFoundTitle')}</h1>
      <p>{t('pages.errors.notFoundDescription')}</p>
    </div>
  );
}