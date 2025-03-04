'use client';

import React from 'react';
import { ClientProfile } from 'server/src/components/client-portal/profile/ClientProfile';

export default function ProfilePage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Your Profile</h1>
      <ClientProfile />
    </div>
  );
}
