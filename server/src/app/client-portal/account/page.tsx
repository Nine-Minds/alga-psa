import React from 'react';
import ClientAccount from 'server/src/components/client-portal/account/ClientAccount';

export default function AccountPage() {
  return (
    <div id="account-page" className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Account</h1>
      <ClientAccount />
    </div>
  );
}
