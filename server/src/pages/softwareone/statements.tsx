import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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