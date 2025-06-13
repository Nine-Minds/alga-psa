import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return {
      redirect: {
        destination: '/auth/signin',
        permanent: false,
      },
    };
  }

  return {
    props: {},
  };
};