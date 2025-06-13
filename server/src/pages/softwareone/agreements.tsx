import React from 'react';
import { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { useRouter } from 'next/router';
import DefaultLayout from '@/components/layout/DefaultLayout';

export default function SoftwareOneAgreementsPage() {
  const router = useRouter();

  return (
    <DefaultLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">SoftwareOne Agreements</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Your SoftwareOne agreements will appear here once the extension is fully implemented.
        </p>
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            This page is rendered by the SoftwareOne extension. The extension system is working correctly!
          </p>
        </div>
      </div>
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