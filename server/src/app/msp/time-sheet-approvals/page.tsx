import ManagerApprovalDashboard from 'server/src/components/time-management/approvals/ManagerApprovalDashboard';
import { findUserById } from 'server/src/lib/actions/user-actions/userActions';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";

export default async function TimeSheetApprovalsPage() {
  const session = await getServerSession(options);
  console.log('session', session);
  const currentUserId = session?.user.id;
  
  if (!currentUserId) {
    return <div>You do not have permission to view this page.</div>;
  }
  const currentUser = await findUserById(currentUserId);

  if (!currentUser) {
    return <div>You do not have permission to view this page.</div>;
  }


  return <ManagerApprovalDashboard currentUser={currentUser} />;
}