'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { ArrowLeft } from 'lucide-react';

export default function BackButton() {
  const router = useRouter();

  return (
    <Button
      id="back-to-credits-button"
      variant="soft"
      onClick={() => router.push('/msp/billing?tab=credits')}
    >
      <ArrowLeft className="mr-2 h-4 w-4" /> ← Back to Credits
    </Button>
  );
}

