// server/src/app/msp/account-manager/page.tsx

import { AccountManagerDashboard } from '@alga-psa/clients/components';

export default async function AccountManagerPage() {
  // const clients = await Client.getAll();

  return <AccountManagerDashboard clients={[]} />;
}
