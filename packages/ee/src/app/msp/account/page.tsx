/**
 * CE Stub for Account Management Page
 * In CE builds, this page shows a placeholder
 */

import React from 'react';
import AccountManagement from '../../../components/settings/account/AccountManagement';

export default function AccountPage() {
  return (
    <div className="container max-w-4xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Account Management</h1>
      <AccountManagement />
    </div>
  );
}
