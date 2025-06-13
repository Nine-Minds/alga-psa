import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import DefaultLayout from '@/components/layout/DefaultLayout';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import the component to handle any client-side dependencies
const StatementDetail = dynamic(
  () => import('@/../../extensions/softwareone-ext/src/components/StatementDetail').then(mod => ({ default: mod.StatementDetail })),
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
      <DefaultLayout>
        <div className="p-6">
          <p>Invalid statement ID</p>
        </div>
      </DefaultLayout>
    );
  }

  return (
    <DefaultLayout>
      <StatementDetail statementId={id} />
    </DefaultLayout>
  );
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