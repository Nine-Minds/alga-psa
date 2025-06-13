import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import components to handle any client-side dependencies
const SimpleLayout = dynamic(
  () => import('@/components/extensions/softwareone/SimpleLayout'),
  { ssr: false }
);

const StatementsList = dynamic(
  () => import('@/components/extensions/softwareone/StatementsList'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading statements...</div>
  }
);

export default function SoftwareOneStatementsPage() {
  return (
    <SimpleLayout>
      <StatementsList />
    </SimpleLayout>
  );
}