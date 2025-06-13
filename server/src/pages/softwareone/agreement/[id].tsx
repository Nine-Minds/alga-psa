import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import DefaultLayout from '@/components/layout/DefaultLayout';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

// Dynamically import the component to handle any client-side dependencies
const AgreementDetail = dynamic(
  () => import('@/components/extensions/softwareone/AgreementDetail'),
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
      <DefaultLayout>
        <div className="p-6">
          <p>Invalid agreement ID</p>
        </div>
      </DefaultLayout>
    );
  }

  return (
    <DefaultLayout>
      <AgreementDetail agreementId={id} />
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