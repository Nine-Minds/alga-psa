import React from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import the page content as a single component
const AgreementDetailPageContent = dynamic(
  () => import('@/components/extensions/softwareone/AgreementDetailPageContent'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading agreement details...</div>
  }
);

export default function SoftwareOneAgreementDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  if (!id || typeof id !== 'string') {
    return (
      <div className="p-6">
        <p>Invalid agreement ID</p>
      </div>
    );
  }

  return <AgreementDetailPageContent agreementId={id} />;
}

// Disable static optimization to prevent pre-render errors
export const getServerSideProps = async () => {
  return {
    props: {}
  };
};