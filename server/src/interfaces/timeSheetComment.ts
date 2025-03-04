// models/timeSheetComment.ts
import { TenantEntity } from ".";
import { createTenantKnex } from 'server/src/lib/db';
import { ITimeSheetApproval, ITimeSheetComment } from 'server/src/interfaces/timeEntry.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { Knex } from 'knex';
import { useTenant } from 'server/src/components/TenantProvider';

const TimeSheetComment = {
  getByTimeSheetId: async (timeSheetId: string): Promise<ITimeSheetApproval | null> => {
    const tenant = useTenant();
    if (!tenant) {
      throw new Error('tenant is not defined');
    }
    const {knex: db} = await createTenantKnex();
    const comments = await db('time_sheet_comments')
      .join('users', 'time_sheet_comments.user_id', 'users.user_id')
      .where({ 'time_sheet_comments.time_sheet_id': timeSheetId })
      .select(
        'time_sheet_comments.*',
        'users.first_name',
        'users.last_name',
        'users.email'
      );
  
    if (comments.length === 0) {
      return null; // or throw an error, depending on your error handling strategy
    }
  
    // Assuming the first comment's user is the time sheet owner
    const firstComment = comments[0];
  
    return {
      id: timeSheetId,
      employee_name: `${firstComment.first_name} ${firstComment.last_name}`,
      employee_email: firstComment.email,
      comments: comments.map((comment): ITimeSheetComment => ({
        comment_id: comment.comment_id,
        time_sheet_id: comment.time_sheet_id,
        user_id: comment.user_id,
        comment: comment.comment,
        created_at: comment.created_at,
        is_approver: comment.is_approver,
        user_name: `${comment.first_name} ${comment.last_name}`,
        tenant: tenant
      }))
    } as ITimeSheetApproval;
  },

  add: async (comment: Omit<ITimeSheetComment, 'comment_id' | 'created_at'>): Promise<string> => {
    try {
      const {knex: db} = await createTenantKnex();
      const [insertedComment] = await db<ITimeSheetComment>('time_sheet_comments')
        .insert(comment)
        .returning('comment_id');
      return insertedComment.comment_id;
    } catch (error) {
      console.error('Error adding comment to time sheet:', error);
      throw error;
    }
  },

  // Add more methods as needed (e.g., update, delete)
};

export default TimeSheetComment;
