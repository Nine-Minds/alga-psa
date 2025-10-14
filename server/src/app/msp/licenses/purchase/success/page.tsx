'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { CheckCircle, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';

export default function LicensePurchaseSuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [loading, setLoading] = useState(true);
  const [licenseCount, setLicenseCount] = useState<number | null>(null);

  useEffect(() => {
    // Fetch updated license count
    const fetchLicenseCount = async () => {
      try {
        const result = await getLicenseUsageAction();
        if (result.success && result.data) {
          setLicenseCount(result.data.total);
        }
      } catch (error) {
        console.error('Error fetching license count:', error);
      } finally {
        setLoading(false);
      }
    };

    // Add a small delay to allow webhook processing
    const timer = setTimeout(fetchLicenseCount, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-green-600">
            <CheckCircle className="h-8 w-8" />
            Purchase Successful!
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Success Message */}
          <div className="space-y-2">
            <p className="text-lg">
              Thank you for your purchase! Your new licenses have been added to your account.
            </p>
            {loading ? (
              <div className="flex items-center gap-2 text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Updating license count...</span>
              </div>
            ) : (
              licenseCount !== null && (
                <p className="text-gray-600">
                  You now have <strong className="text-blue-600">{licenseCount}</strong> total licenses.
                </p>
              )
            )}
          </div>

          {/* Session ID (for debugging/support) */}
          {sessionId && (
            <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Session ID (for support reference):</p>
              <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                {sessionId}
              </p>
            </div>
          )}

          {/* Next Steps */}
          <div className="space-y-3">
            <h3 className="font-semibold">What's next?</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>Your licenses are now active and ready to use</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>You can create new users immediately from User Management</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>Your next invoice will include the prorated charges</span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Link href="/msp/settings/general" className="flex-1">
              <Button variant="default" className="w-full gap-2">
                Go to User Management
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/msp/dashboard">
              <Button variant="outline">Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
