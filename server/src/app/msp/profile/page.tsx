'use client';

import React from 'react';
import UserProfile from '@/components/settings/profile/UserProfile';

export default function ProfilePage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Your Profile</h1>
      <UserProfile />
    </div>
  );
}
