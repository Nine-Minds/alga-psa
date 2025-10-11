// server/src/app/msp/account-manager/page.tsx

import AccountManagerDashboard from 'server/src/components/AccountManagerDashboard';
import Client from 'server/src/lib/models/client';
import { IClient } from 'server/src/interfaces/client.interfaces';

export default async function AccountManagerPage() {
  // const clients = await Client.getAll();

  return <AccountManagerDashboard clients={[]} />;
}
