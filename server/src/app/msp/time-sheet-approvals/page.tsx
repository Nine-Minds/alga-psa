import ManagerApprovalDashboard from 'server/src/components/time-management/approvals/ManagerApprovalDashboard';
import { findUserById } from '@product/actions/user-actions/userActions';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Users } from 'lucide-react';
import { getSession } from 'server/src/lib/auth/getSession';

export default async function TimeSheetApprovalsPage() {
  const session = await getSession();
  console.log('session', session);
  const currentUserId = session?.user.id;
  
  if (!currentUserId) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Card className="max-w-xl w-full p-6">
          <CardHeader className="flex flex-row items-center gap-3 p-0 mb-4">
            <Users className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            <CardTitle className="text-xl">Team lead access required</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-[rgb(var(--color-text-700))] mb-4">
              To approve time sheets for your team members, you need to be a team lead.
            </p>
            <Button id="go-to-team-settings" asChild>
              <Link href="/msp/settings?tab=teams">Go to Team Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  const currentUser = await findUserById(currentUserId);

  if (!currentUser) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Card className="max-w-xl w-full p-6">
          <CardHeader className="flex flex-row items-center gap-3 p-0 mb-4">
            <Users className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            <CardTitle className="text-xl">Team lead access required</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-[rgb(var(--color-text-700))] mb-4">
              To approve time sheets for your team members, you need to be a team lead.
            </p>
            <Button id="go-to-team-settings" asChild>
              <Link href="/msp/settings?tab=teams">Go to Team Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }


  return <ManagerApprovalDashboard currentUser={currentUser} />;
}

export const dynamic = "force-dynamic";
