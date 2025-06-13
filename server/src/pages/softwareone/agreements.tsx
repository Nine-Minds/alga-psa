import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import DefaultLayout from '@/components/layout/DefaultLayout';
import dynamic from 'next/dynamic';

// Dynamically import the component to handle any client-side dependencies
const AgreementsList = dynamic(
  () => import('@/components/extensions/softwareone/AgreementsList'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading agreements...</div>
  }
);

export default function SoftwareOneAgreementsPage() {
  return (
    <DefaultLayout>
      <AgreementsList />
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