import { Knex } from 'knex';
import { ITimeSheetApproval, ITimeSheetComment } from 'server/src/interfaces/timeEntry.interfaces';

const TimeSheetComment = {
  getByTimeSheetId: async (knexOrTrx: Knex | Knex.Transaction, timeSheetId: string): Promise<ITimeSheetApproval | null> => {
    const comments = await knexOrTrx('time_sheet_comments')
      .join('users', function() {
        this.on('time_sheet_comments.user_id', '=', 'users.user_id')
            .andOn('time_sheet_comments.tenant', '=', 'users.tenant');
      })
      .where({ 'time_sheet_comments.time_sheet_id': timeSheetId })
      .select(
        'time_sheet_comments.*',
        'users.first_name',
        'users.last_name',
        'users.email'
      );
  
    if (comments.length === 0) {
      return null;
    }
  
    // Assuming the first comment's user is the time sheet owner
    const firstComment = comments[0];
    
    // Get tenant from the knex connection
    const tenant = (knexOrTrx as any).client.config.searchPath || 'public';
  
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

  add: async (knexOrTrx: Knex | Knex.Transaction, comment: Omit<ITimeSheetComment, 'comment_id' | 'created_at' | 'tenant'>): Promise<string> => {
    try {
      const [insertedComment] = await knexOrTrx<ITimeSheetComment>('time_sheet_comments')
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