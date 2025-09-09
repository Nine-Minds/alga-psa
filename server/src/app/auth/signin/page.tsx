"use client";
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Get the callback URL to determine which portal to redirect to
    const callbackUrl = searchParams?.get('callbackUrl') || '';
    const queryString = searchParams?.toString();
    
    // Redirect to the appropriate login page based on the callback URL
    if (callbackUrl.includes('/client-portal')) {
      // Redirect to client portal login
      router.replace(`/auth/client-portal/signin${queryString ? `?${queryString}` : ''}`);
    } else {
      // Default to MSP login for all other cases
      router.replace(`/auth/msp/signin${queryString ? `?${queryString}` : ''}`);
    }
  }, [searchParams, router]);
  
  // Show a loading state while redirecting
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">Redirecting to login...</p>
      </div>
    </div>
  );
}