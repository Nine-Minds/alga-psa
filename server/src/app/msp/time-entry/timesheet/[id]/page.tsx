import { notFound } from 'next/navigation';
import { getCurrentUser } from "@alga-psa/user-composition/actions";
import {
  fetchTimeSheet,
  fetchTimeSheetComments,
} from '@alga-psa/scheduling/actions/timeSheetActions';
import { fetchTimeEntriesForTimeSheet } from '@alga-psa/scheduling/actions/timeEntryActions';
import { fetchWorkItemsForTimeSheet } from '@alga-psa/scheduling/actions/timeEntryWorkItemActions';
import TimeSheetClient from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeSheetClient';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import { assertCanActOnBehalf, isManagerOfSubject } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';
import type { Metadata } from 'next';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export const metadata: Metadata = {
  title: 'Timesheet',
};

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export default async function TimeSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return notFound();
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return notFound();
  }

  try {
    const timeSheet = await fetchTimeSheet(id);
    if (isReturnedActionError(timeSheet)) {
      return <div className="p-6 text-sm text-red-600">{getErrorMessage(timeSheet)}</div>;
    }

    if (!timeSheet.tenant || !timeSheet.user_id) {
      return notFound();
    }

    const { knex: db } = await createTenantKnex(currentUser.tenant);

    const tenant = timeSheet.tenant;
    const subjectUserId = timeSheet.user_id;

    const isManager = await isManagerOfSubject(db, tenant, currentUser.user_id, subjectUserId);

    const canReverse = await hasPermission(currentUser, 'timesheet', 'reverse', db);
    const hasInvoicedEntries = !!(await tenantDb(db, tenant).table('time_entries')
      .where({ time_sheet_id: timeSheet.id, invoiced: true })
      .first('entry_id'));

    let canReopenForEdits = false;
    if (timeSheet.approval_status === 'APPROVED' && canReverse && !hasInvoicedEntries) {
      try {
        await assertCanActOnBehalf(currentUser, tenant, subjectUserId, db);
        canReopenForEdits = true;
      } catch {
        canReopenForEdits = false;
      }
    }

    const [initialEntries, initialWorkItems, initialComments] = await Promise.all([
      fetchTimeEntriesForTimeSheet(timeSheet.id),
      fetchWorkItemsForTimeSheet(timeSheet.id),
      timeSheet.approval_status !== 'DRAFT' ? fetchTimeSheetComments(timeSheet.id) : Promise.resolve([]),
    ]);
    const initialLoadError =
      isReturnedActionError(initialEntries) ? getErrorMessage(initialEntries) :
      isReturnedActionError(initialWorkItems) ? getErrorMessage(initialWorkItems) :
      isReturnedActionError(initialComments) ? getErrorMessage(initialComments) :
      null;
    if (initialLoadError) {
      return <div className="p-6 text-sm text-red-600">{initialLoadError}</div>;
    }

    return (
      <TimeSheetClient
        timeSheet={timeSheet}
        currentUser={currentUser}
        isManager={isManager}
        canReopenForEdits={canReopenForEdits}
        initialEntries={initialEntries}
        initialWorkItems={initialWorkItems}
        initialComments={initialComments}
      />
    );
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    return notFound();
  }
}

export const dynamic = "force-dynamic";
