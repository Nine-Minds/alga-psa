'use server'

import { ITimeEntry, ITimeSheetApproval, ITimeSheetComment, TimeSheetStatus, ITimePeriod, ITimeSheet } from '@/interfaces';
import { createTenantKnex } from '@/lib/db';
import TimeSheetComment from '@/interfaces/timeSheetComment';
import { formatISO } from 'date-fns';
import { timeSheetApprovalSchema, timeSheetCommentSchema, timeEntrySchema, timeSheetSchema } from '../schemas/timeSheet.schemas';
import { WorkItemType } from '@/interfaces/workItem.interfaces';
import { validateArray, validateData } from '../utils/validation';

export async function fetchTimeSheetsForApproval(
  teamIds: string[],
  includeApproved: boolean = false
): Promise<ITimeSheetApproval[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const statuses = includeApproved
      ? ['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED']
      : ['SUBMITTED', 'CHANGES_REQUESTED'];

    const timeSheets = await db('time_sheets')
      .join('users', function() {
        this.on('time_sheets.user_id', '=', 'users.user_id')
            .andOn('time_sheets.tenant', '=', 'users.tenant');
      })
      .join('team_members', function() {
        this.on('users.user_id', '=', 'team_members.user_id')
            .andOn('users.tenant', '=', 'team_members.tenant');
      })
      .join('time_periods', function() {
        this.on('time_sheets.period_id', '=', 'time_periods.period_id')
            .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
      })
      .whereIn('team_members.team_id', teamIds)
      .whereIn('time_sheets.approval_status', statuses)
      .where('time_sheets.tenant', tenant)
      .select(
        'time_sheets.*',
        'users.user_id',
        'users.first_name',
        'users.last_name',
        'users.email',
        'time_periods.start_date as period_start_date',
        'time_periods.end_date as period_end_date'
      );

    const timeSheetApprovals: ITimeSheetApproval[] = timeSheets.map((sheet): ITimeSheetApproval => ({
      id: sheet.id,
      user_id: sheet.user_id,
      period_id: sheet.period_id,
      approval_status: sheet.approval_status,
      submitted_at: sheet.submitted_at ? formatISO(new Date(sheet.submitted_at)) : undefined,
      approved_at: sheet.approved_at ? formatISO(new Date(sheet.approved_at)) : undefined,
      approved_by: sheet.approved_by || undefined,
      employee_name: `${sheet.first_name} ${sheet.last_name}`,
      employee_email: sheet.email,
      comments: [],
      time_period: {
        start_date: formatISO(new Date(sheet.period_start_date)),
        end_date: formatISO(new Date(sheet.period_end_date)),
        period_id: sheet.period_id
      } as ITimePeriod,
      tenant: sheet.tenant
    }));

    return validateArray(timeSheetApprovalSchema, timeSheetApprovals);
  } catch (error) {
    console.error('Error fetching time sheets for approval:', error);
    throw new Error('Failed to fetch time sheets for approval');
  }
}

export async function addCommentToTimeSheet(
  timeSheetId: string,
  userId: string,
  comment: string,
  isApprover: boolean
): Promise<ITimeSheetComment> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const [newComment] = await db('time_sheet_comments')
      .insert({
        time_sheet_id: timeSheetId,
        user_id: userId,
        comment: comment,
        is_approver: isApprover,
        created_at: db.fn.now(),
        tenant: tenant
      })
      .returning('*');

    // Format the created_at date before validation
    const formattedComment = {
      ...newComment,
      created_at: formatISO(new Date(newComment.created_at))
    };

    return validateData(timeSheetCommentSchema, formattedComment);
  } catch (error) {
    console.error('Failed to add comment to time sheet:', error);
    throw new Error('Failed to add comment to time sheet');
  }
}

export async function bulkApproveTimeSheets(timeSheetIds: string[], managerId: string) {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    await db.transaction(async (trx) => {
      for (const id of timeSheetIds) {
        const timeSheet = await trx('time_sheets')
          .where({
            id: id,
            approval_status: 'SUBMITTED',
            tenant
          })
          .first();

        if (!timeSheet) {
          throw new Error(`Time sheet ${id} is not in a submitted state or does not exist`);
        }

        const isManager = await trx('teams')
          .join('team_members', function() {
            this.on('teams.team_id', '=', 'team_members.team_id')
                .andOn('teams.tenant', '=', 'team_members.tenant');
          })
          .where({
            'team_members.user_id': timeSheet.user_id,
            'teams.manager_id': managerId,
            'teams.tenant': tenant
          })
          .first();

        if (!isManager) {
          throw new Error(`Unauthorized: Not a manager for time sheet ${id}`);
        }

        // Update time sheet status
        await trx('time_sheets')
          .where({
            id: id,
            tenant
          })
          .update({
            approval_status: 'APPROVED',
            approved_by: managerId,
            approved_at: new Date()
          });

        // Update all time entries to approved status
        await trx('time_entries')
          .where({ 
            time_sheet_id: id,
            tenant
          })
          .update({ approval_status: 'APPROVED' });
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error bulk approving time sheets:', error);
    throw new Error('Failed to bulk approve time sheets');
  }
}

export async function fetchTimeSheet(timeSheetId: string): Promise<ITimeSheet> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const timeSheet = await db('time_sheets')
      .join('time_periods', function() {
        this.on('time_sheets.period_id', '=', 'time_periods.period_id')
            .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
      })
      .where({
        'time_sheets.id': timeSheetId,
        'time_sheets.tenant': tenant
      })
      .select(
        'time_sheets.*',
        'time_periods.start_date as period_start_date',
        'time_periods.end_date as period_end_date',
        'time_periods.period_id'
      )
      .first();

    if (!timeSheet) {
      throw new Error(`Time sheet with id ${timeSheetId} not found`);
    }

    const result = {
      ...timeSheet,
      submitted_at: timeSheet.submitted_at ? formatISO(new Date(timeSheet.submitted_at)) : undefined,
      approved_at: timeSheet.approved_at ? formatISO(new Date(timeSheet.approved_at)) : undefined,
      approved_by: timeSheet.approved_by || undefined,
      time_period: {
        start_date: formatISO(new Date(timeSheet.period_start_date)),
        end_date: formatISO(new Date(timeSheet.period_end_date)),
        period_id: timeSheet.period_id
      }
    };

    return validateData(timeSheetSchema, result);
  } catch (error) {
    console.error('Error fetching time sheet:', error);
    throw new Error('Failed to fetch time sheet');
  }
}

export async function fetchTimeEntriesForTimeSheet(timeSheetId: string): Promise<ITimeEntry[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const timeEntries = await db<ITimeEntry>('time_entries')
      .where('time_sheet_id', timeSheetId)
      .andWhere('tenant', tenant)
      .select(
        'entry_id',
        'work_item_id',
        'work_item_type',
        'start_time',
        'end_time',
        'created_at',
        'updated_at',
        'billable_duration',
        'notes',
        'user_id',
        'time_sheet_id',
        'approval_status',
        'tenant'
      )
      .orderBy('start_time', 'asc');

    const formattedEntries = timeEntries.map((entry):ITimeEntry => ({
      ...entry,
      work_item_id: entry.work_item_id || '', // Convert null to empty string
      work_item_type: entry.work_item_type as WorkItemType,
      start_time: formatISO(entry.start_time),
      end_time: formatISO(entry.end_time),
      created_at: formatISO(entry.created_at),
      updated_at: formatISO(entry.updated_at)
    }));

    return validateArray(timeEntrySchema, formattedEntries);
  } catch (error) {
    console.error('Error fetching time entries for time sheet:', error);
    throw new Error('Failed to fetch time entries for time sheet');
  }
}

export async function fetchTimeSheetComments(timeSheetId: string): Promise<ITimeSheetComment[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    
    // First get the time sheet details to get user info
    const timeSheet = await db('time_sheets')
      .join('users', function() {
        this.on('time_sheets.user_id', '=', 'users.user_id')
            .andOn('time_sheets.tenant', '=', 'users.tenant');
      })
      .where({
        'time_sheets.id': timeSheetId,
        'time_sheets.tenant': tenant
      })
      .select(
        'users.first_name',
        'users.last_name',
        'users.email'
      )
      .first();

    if (!timeSheet) {
      throw new Error('Time sheet not found');
    }

    // Then get all comments with user info
    const comments = await db('time_sheet_comments')
      .join('users', function() {
        this.on('time_sheet_comments.user_id', '=', 'users.user_id')
            .andOn('time_sheet_comments.tenant', '=', 'users.tenant');
      })
      .where({
        'time_sheet_comments.time_sheet_id': timeSheetId,
        'time_sheet_comments.tenant': tenant
      })
      .select(
        'time_sheet_comments.*',
        'users.first_name',
        'users.last_name'
      )
      .orderBy('time_sheet_comments.created_at', 'desc');

    const formattedComments = comments.map((comment): ITimeSheetComment => ({
      comment_id: comment.comment_id,
      time_sheet_id: timeSheetId,
      user_id: comment.user_id,
      comment: comment.comment,
      created_at: formatISO(new Date(comment.created_at)),
      is_approver: comment.is_approver,
      user_name: `${comment.first_name} ${comment.last_name}`,
      tenant: comment.tenant
    }));

    return validateArray(timeSheetCommentSchema, formattedComments);
  } catch (error) {
    console.error('Error fetching time sheet comments:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    throw error;
  }
}

export async function approveTimeSheet(timeSheetId: string, approverId: string): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    await db.transaction(async (trx) => {
      const timeSheet = await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .first();

      if (!timeSheet) {
        throw new Error('Time sheet not found');
      }

      // Update time sheet status
      await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .update({
          approval_status: 'APPROVED' as TimeSheetStatus,
          approved_at: trx.fn.now(),
          approved_by: approverId
        });

      // Update all time entries to approved status
      await trx('time_entries')
        .where({ 
          time_sheet_id: timeSheetId,
          tenant
        })
        .update({ approval_status: 'APPROVED' });

      await trx('time_sheet_comments').insert({
        time_sheet_id: timeSheetId,
        user_id: approverId,
        comment: 'Time sheet approved',
        created_at: trx.fn.now(),
        is_approver: true,
        tenant
      });
    });
  } catch (error) {
    console.error('Error approving time sheet:', error);
    throw new Error('Failed to approve time sheet');
  }
}

export async function requestChangesForTimeSheet(timeSheetId: string, approverId: string): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    await db.transaction(async (trx) => {
      const timeSheet = await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .first();

      if (!timeSheet) {
        throw new Error('Time sheet not found');
      }

      await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .update({
          approval_status: 'CHANGES_REQUESTED' as TimeSheetStatus,
          approved_at: null,
          approved_by: null
        });

      await trx('time_sheet_comments').insert({
        time_sheet_id: timeSheetId,
        user_id: approverId,
        comment: 'Changes requested for time sheet',
        created_at: trx.fn.now(),
        is_approver: true,
        tenant
      });
    });
  } catch (error) {
    console.error('Error requesting changes for time sheet:', error);
    throw new Error('Failed to request changes for time sheet');
  }
}

export async function reverseTimeSheetApproval(
  timeSheetId: string,
  approverId: string,
  reason: string
): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    await db.transaction(async (trx) => {
      // Check if time sheet exists and is approved
      const timeSheet = await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .first();

      if (!timeSheet) {
        throw new Error('Time sheet not found');
      }

      if (timeSheet.approval_status !== 'APPROVED') {
        throw new Error('Time sheet is not in an approved state');
      }

      // Check if any entries are invoiced
      const invoicedEntries = await trx('time_entries')
        .where({
          time_sheet_id: timeSheetId,
          invoiced: true,
          tenant
        })
        .first();
        
      if (invoicedEntries) {
        throw new Error('Cannot reverse approval: time entries have been invoiced');
      }

      // Update time sheet status
      await trx('time_sheets')
        .where({ 
          id: timeSheetId,
          tenant
        })
        .update({
          approval_status: 'SUBMITTED' as TimeSheetStatus,
          approved_at: null,
          approved_by: null
        });

      // Update time entries status
      await trx('time_entries')
        .where({ 
          time_sheet_id: timeSheetId,
          tenant
        })
        .update({ approval_status: 'SUBMITTED' });

      // Add comment for audit trail
      await trx('time_sheet_comments').insert({
        time_sheet_id: timeSheetId,
        user_id: approverId,
        comment: `Approval reversed: ${reason}`,
        created_at: trx.fn.now(),
        is_approver: true,
        tenant
      });
    });
  } catch (error) {
    console.error('Error reversing time sheet approval:', error);
    throw error;
  }
}
