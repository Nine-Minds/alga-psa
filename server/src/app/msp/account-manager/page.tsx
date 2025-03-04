// server/src/app/msp/account-manager/page.tsx

import AccountManagerDashboard from 'server/src/components/AccountManagerDashboard';
import Company from 'server/src/lib/models/company';
import { ICompany } from 'server/src/interfaces/company.interfaces';

export default async function AccountManagerPage() {
  // const companies = await Company.getAll();

  return <AccountManagerDashboard companies={[]} />;
}
