import { notFound } from 'next/navigation';
import { getCurrentUser } from "@alga-psa/users/actions";
import { fetchTimeSheet } from '@alga-psa/scheduling/actions/timeSheetActions';
import TimeSheetClient from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeSheetClient';
import { createTenantKnex } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import { assertCanActOnBehalf, isManagerOfSubject } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';

export default async function TimeSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return notFound();
  }

  try {
    const timeSheet = await fetchTimeSheet(id);

    const { knex: db } = await createTenantKnex(currentUser.tenant);

    const isManager = await isManagerOfSubject(db, timeSheet.tenant, currentUser.user_id, timeSheet.user_id);

    const canReverse = await hasPermission(currentUser, 'timesheet', 'reverse', db);
    const hasInvoicedEntries = !!(await db('time_entries')
      .where({ tenant: timeSheet.tenant, time_sheet_id: timeSheet.id, invoiced: true })
      .first('entry_id'));

    let canReopenForEdits = false;
    if (timeSheet.approval_status === 'APPROVED' && canReverse && !hasInvoicedEntries) {
      try {
        await assertCanActOnBehalf(currentUser, timeSheet.tenant, timeSheet.user_id, db);
        canReopenForEdits = true;
      } catch {
        canReopenForEdits = false;
      }
    }

    return (
      <TimeSheetClient 
        timeSheet={timeSheet}
        currentUser={currentUser}
        isManager={isManager}
        canReopenForEdits={canReopenForEdits}
      />
    );
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    return notFound();
  }
}

export const dynamic = "force-dynamic";
