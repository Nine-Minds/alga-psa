import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the page content as a single component
const StatementsPageContent = dynamic(
  () => import('@/components/extensions/softwareone/StatementsPageContent'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading statements...</div>
  }
);

export default function SoftwareOneStatementsPage() {
  return <StatementsPageContent />;
}

// Disable static optimization to prevent pre-render errors
export const getServerSideProps = async () => {
  return {
    props: {}
  };
};