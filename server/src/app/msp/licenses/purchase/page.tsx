'use client';

import React from 'react';
import LicensePurchaseForm from 'server/src/components/licensing/LicensePurchaseForm';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from 'server/src/components/ui/Button';

export default function LicensePurchasePage() {
  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Back Button */}
      <div className="mb-6">
        <Link href="/msp/settings/general">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
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
