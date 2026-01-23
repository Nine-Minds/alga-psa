'use client';

import React from 'react';
import LicensePurchaseForm from '@ee/components/licensing/LicensePurchaseForm';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useRouter } from 'next/navigation';

export default function LicensePurchasePage() {
  const router = useRouter();

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Back Button */}
      <div className="mb-6">
        <Button
          id="back-button"
          variant="outline"
          className="gap-2"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Purchase Licenses</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Add more user licenses to your AlgaPSA account
        </p>
      </div>

      {/* Purchase Form */}
      <LicensePurchaseForm />
    </div>
  );
}
