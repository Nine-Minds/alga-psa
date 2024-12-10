"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import dynamic from 'next/dynamic';

// Dynamically import DnDFlow with SSR disabled since it uses browser APIs
const DnDFlow = dynamic(
  () => import('@ee/components/flow/DnDFlow'),
  { ssr: false }
);

export default function WorkflowsPage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/signin');
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        router.push('/auth/signin');
      }
    };

    checkAuth();
  }, [router]);

  return (
    <div className="h-full">
      <DnDFlow />
    </div>
  );
}
