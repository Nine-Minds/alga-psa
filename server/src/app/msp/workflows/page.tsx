"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { DynamicWorkflowComponent } from 'server/src/lib/workflow/visualization/WorkflowComponentLoader';

export default function WorkflowsPage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/msp/signin');
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        router.push('/auth/msp/signin');
      }
    };

    checkAuth();
  }, [router]);

  return (
    <div className="h-full">
      <DynamicWorkflowComponent />
    </div>
  );
}
