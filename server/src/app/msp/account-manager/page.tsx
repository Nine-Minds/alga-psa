// server/src/app/msp/account-manager/page.tsx

import { AccountManagerDashboard } from '@alga-psa/clients';

export default async function AccountManagerPage() {
  // const clients = await Client.getAll();

  return <AccountManagerDashboard clients={[]} />;
}
