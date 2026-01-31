'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { CheckCircle, ArrowRight, Loader2, Calendar, Users } from 'lucide-react';
import Link from 'next/link';
import { getLicenseUsageAction } from '@alga-psa/licensing/actions';
import { getSubscriptionInfoAction } from '@enterprise/lib/actions/license-actions';

export default function LicensePurchaseSuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('session_id') ?? null;
  const isScheduled = searchParams?.get('scheduled') === 'true';
  const [loading, setLoading] = useState(true);
  const [licenseCount, setLicenseCount] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);

  useEffect(() => {
    // Fetch updated license count and subscription info
    const fetchData = async () => {
      try {
        const result = await getLicenseUsageAction();
        if (result.success && result.data) {
          // Use limit (total licenses) not total
          setLicenseCount(result.data.limit);
        }

        // If scheduled change, get subscription end date
        if (isScheduled) {
          const subResult = await getSubscriptionInfoAction();
          if (subResult?.success && subResult.data) {
            setScheduledDate(subResult.data.current_period_end);
          }
        }
      } catch (error) {
        console.error('Error fetching license data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Add a small delay to allow webhook processing
    const timer = setTimeout(fetchData, 2000);
    return () => clearTimeout(timer);
  }, [isScheduled]);

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card className="mt-8">
        <CardContent className="pt-12 pb-8 space-y-8">
          {/* Success Icon and Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary-100 dark:bg-primary-900/20 p-6">
                {isScheduled ? (
                  <Calendar className="h-12 w-12 text-primary-500" />
                ) : (
                  <CheckCircle className="h-12 w-12 text-primary-500" />
                )}
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">
                {isScheduled ? 'Change Scheduled Successfully!' : 'Update Successful!'}
              </h1>
              <p className="text-muted-foreground text-lg">
                {isScheduled
                  ? 'Your license change has been scheduled and will take effect at the end of your current billing period.'
                  : 'Your license update has been processed successfully!'
                }
              </p>
            </div>
          </div>

          {/* License Count Display */}
          {loading ? (
            <div className="flex items-center justify-center gap-3 text-muted-foreground py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{isScheduled ? 'Loading subscription details...' : 'Updating license count...'}</span>
            </div>
          ) : (
            <div className="rounded-lg border bg-gradient-to-br from-primary-100 via-primary-50 to-blue-50 dark:from-primary-900/30 dark:via-primary-950/20 dark:to-blue-950/10 p-6">
              <div className="flex items-center justify-center gap-3 mb-3">
                <Users className="h-6 w-6 text-primary-500" />
                <h2 className="text-lg font-semibold">License Information</h2>
              </div>
              <div className="text-center space-y-2">
                {licenseCount !== null && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">You now have</p>
                    <p className="text-5xl font-bold text-primary-500">{licenseCount}</p>
                    <p className="text-lg text-muted-foreground mt-1">total licenses</p>
                  </div>
                )}
                {isScheduled && scheduledDate && (
                  <div className="mt-4 pt-4 border-t border-primary-200 dark:border-primary-800">
                    <p className="text-sm text-muted-foreground mb-1">Change effective</p>
                    <p className="text-xl font-semibold text-orange-600 dark:text-orange-400">
                      {new Date(scheduledDate).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Next Steps */}
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold">What's next?</h3>
            {isScheduled ? (
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">Your current licenses remain active until the end of the billing period</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">The license count will automatically update on the scheduled date</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">You'll receive an email confirmation when the change takes effect</span>
                </li>
              </ul>
            ) : (
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">Your licenses are now active and ready to use</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">You can create new users immediately from User Management</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">Your next invoice will include the prorated charges</span>
                </li>
              </ul>
            )}
          </div>

          {/* Session ID (for debugging/support) */}
          {sessionId && (
            <details className="rounded-lg border p-4">
              <summary className="text-sm font-medium cursor-pointer hover:text-primary-500">
                Session Details (for support)
              </summary>
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-1">Session ID:</p>
                <p className="text-xs font-mono bg-muted p-2 rounded break-all">
                  {sessionId}
                </p>
              </div>
            </details>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/msp/account" className="flex-1">
              <Button id="go-to-account-btn" variant="default" className="w-full gap-2">
                Go to Account Management
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/msp/dashboard" className="flex-1 sm:flex-initial">
              <Button id="go-to-dashboard-btn" variant="outline" className="w-full sm:w-auto">
                Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
