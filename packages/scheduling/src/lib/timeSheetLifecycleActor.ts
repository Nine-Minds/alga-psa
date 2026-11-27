import type { IUser } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { assertCanActOnBehalf, assertCanApproveSubject } from '../actions/timeEntryDelegationAuth';
import type { TimeSheetLifecycleActor } from './timeSheetApprovalTransition';

/** Lifecycle actor for a signed-in user calling a scheduling server action. */
export function sessionLifecycleActor(user: IUser, tenant: string): TimeSheetLifecycleActor {
  return {
    userId: user.user_id,
    hasPermission: (permission, trx) => hasPermission(user as any, 'time_sheet', permission, trx),
    assertSubject: async (rule, subjectUserId, trx) => {
      if (rule === 'approveSubject') {
        await assertCanApproveSubject(user, tenant, subjectUserId, trx);
      } else {
        await assertCanActOnBehalf(user, tenant, subjectUserId, trx);
      }
    },
  };
}
