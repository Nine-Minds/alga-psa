'use client';

import React from 'react';
import AccountManagement from '@ee/components/settings/account/AccountManagement';

export default function AccountPage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Account Management</h1>
      <AccountManagement />
    </div>
  );
}
