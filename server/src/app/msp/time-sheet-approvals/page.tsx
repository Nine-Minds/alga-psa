import ManagerApprovalDashboard from '@alga-psa/scheduling/components/time-management/approvals/ManagerApprovalDashboard';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Users } from 'lucide-react';
import { getCurrentUser } from '@alga-psa/auth';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Timesheet Approvals',
};

export default async function TimeSheetApprovalsPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    const { t } = await getServerTranslation(undefined, 'common');
    return (
      <div className="p-6 flex items-center justify-center">
        <Card className="max-w-xl w-full p-6">
          <CardHeader className="flex flex-row items-center gap-3 p-0 mb-4">
            <Users className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            <CardTitle className="text-xl">{t('pages.errors.teamLeadAccessRequired')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-[rgb(var(--color-text-700))] mb-4">
              {t('pages.errors.teamLeadAccessDetail', { defaultValue: 'To approve time sheets for your team members, you need to be a team lead.' })}
            </p>
            <Button id="go-to-team-settings" asChild>
              <Link href="/msp/settings?tab=teams">{t('pages.actions.goToTeamSettings', { defaultValue: 'Go to Team Settings' })}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ManagerApprovalDashboard currentUser={currentUser} />;
}

export const dynamic = "force-dynamic";
