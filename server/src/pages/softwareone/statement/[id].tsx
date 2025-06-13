import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import the page content as a single component
const StatementDetailPageContent = dynamic(
  () => import('@/components/extensions/softwareone/StatementDetailPageContent'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading statement details...</div>
  }
);

export default function SoftwareOneStatementDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  if (!id || typeof id !== 'string') {
    return (
      <div className="p-6">
        <p>Invalid statement ID</p>
      </div>
    );
  }

  return <StatementDetailPageContent statementId={id} />;
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