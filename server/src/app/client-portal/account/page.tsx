'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { CreditCard, Info } from 'lucide-react';
import Link from 'next/link';
import { SwitchToMSPButton } from '@alga-psa/client-portal/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ClientPortalAccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t } = useTranslation('clientPortal');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;

    if (!session?.user?.tenant) {
      router.push('/auth/client-portal/signin');
      return;
    }

    // For now, assume all users with a session can access this page
    // The actual permission check is done in the layout via checkClientPortalPermissions
    setIsLoading(false);
  }, [session, status, router]);

  if (isLoading || status === 'loading') {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card className="p-8">
          <div className="text-center">Loading...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto py-8 px-4">
      <Card className="p-8">
        <div className="text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <CreditCard className="h-12 w-12 text-primary" />
            </div>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('account.licenseManagement.title')}</h1>
            <p className="text-muted-foreground">
              {t('account.licenseManagement.subtitle')}
            </p>
          </div>

          {/* Instructions */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold mb-3 text-gray-900">
                {t('account.licenseManagement.howToPurchaseTitle')}
              </p>
              <ol className="text-left space-y-2 text-sm">
                <li className="flex gap-2">
                  <span className="font-semibold min-w-[20px]">1.</span>
                  <span>{t('account.licenseManagement.step1')}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold min-w-[20px]">2.</span>
                  <span>{t('account.licenseManagement.step2')}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold min-w-[20px]">3.</span>
                  <span>{t('account.licenseManagement.step3')}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold min-w-[20px]">4.</span>
                  <span>{t('account.licenseManagement.step4')}</span>
                </li>
              </ol>
            </AlertDescription>
          </Alert>

          {/* Additional Info */}
          <div className="text-sm text-muted-foreground text-left bg-muted/50 p-4 rounded-lg">
            <p className="font-semibold mb-2">{t('account.licenseManagement.needHelpTitle')}</p>
            <p>{t('account.licenseManagement.needHelpDescription')}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-center pt-4">
            <Link href="/client-portal/dashboard">
              <Button variant="outline" id="back-to-dashboard-btn">
                {t('account.licenseManagement.backToDashboard')}
              </Button>
            </Link>
            <SwitchToMSPButton />
          </div>
        </div>
      </Card>
    </div>
  );
}
