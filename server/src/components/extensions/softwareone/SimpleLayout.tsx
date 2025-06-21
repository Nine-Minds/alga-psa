'use client';

import React from 'react';

interface SimpleLayoutProps {
  children: React.ReactNode;
}

export default function SimpleLayout({ children }: SimpleLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Alga PSA - SoftwareOne Extension</h1>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}