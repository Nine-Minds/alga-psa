import ClientAccount from 'server/src/components/client-portal/account/ClientAccount';
import { getServerTranslation } from 'server/src/lib/i18n/server';

export default async function AccountPage() {
  const { t } = await getServerTranslation(undefined, 'clientPortal');

  return (
    <div id="account-page" className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">{t('account.title', 'Account')}</h1>
      <ClientAccount />
    </div>
  );
}
