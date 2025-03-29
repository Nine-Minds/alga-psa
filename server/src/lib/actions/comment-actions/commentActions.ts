'use server'

import Comment from 'server/src/lib/models/comment';
import { IComment } from 'server/src/interfaces/comment.interface';
import { createTenantKnex } from 'server/src/lib/db';
import { convertBlockNoteToMarkdown } from 'server/src/lib/utils/blocknoteUtils';

export async function findCommentsByTicketId(ticketId: string) {
  try {
    const comments = await Comment.getAllbyTicketId(ticketId);
    return comments;
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comments for ticket id: ${ticketId}`);
  }
}

export async function findCommentById(commentId: string) {
  try {
    const comment = await Comment.get(commentId);
    return comment;
  } catch (error) {
    console.error(error);
    throw new Error(`Failed to find comment with id: ${commentId}`);
  }
}

export async function createComment(comment: Omit<IComment, 'tenant'>): Promise<string> {
  try {
    console.log(`[createComment] Starting with comment:`, {
      note_length: comment.note ? comment.note.length : 0,
      is_internal: comment.is_internal,
      is_resolution: comment.is_resolution,
      user_id: comment.user_id
    });
    
    // Get user's type to set author_type
    if (comment.user_id) {
      const { knex: db, tenant } = await createTenantKnex();
      const user = await db('users')
        .select('user_type')
        .where('user_id', comment.user_id)
        .andWhere('tenant', tenant!)
        .first();

      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    } else {
      comment.author_type = 'unknown';
    }

    // Only allow internal comments from internal users
    if (comment.is_internal && comment.author_type !== 'internal') {
      throw new Error('Only internal users can create internal comments');
    }

    // Convert BlockNote JSON to Markdown if note exists
    if (comment.note) {
      console.log(`[createComment] Converting note to markdown for new comment`);
      
      try {
        comment.markdown_content = await convertBlockNoteToMarkdown(comment.note);
        
        if (!comment.markdown_content || comment.markdown_content.trim() === '') {
          console.warn(`[createComment] Markdown conversion returned empty result, using fallback`);
          comment.markdown_content = "[Fallback markdown content]";
        }
        
        console.log(`[createComment] Markdown conversion successful:`, {
          length: comment.markdown_content.length
        });
      } catch (conversionError) {
        console.error(`[createComment] Error during markdown conversion:`, conversionError);
        comment.markdown_content = "[Error during content conversion]";
      }
    } else {
      comment.markdown_content = "[No content]";
    }
    
    // Create a copy of the comment object to ensure markdown_content is included
    const commentToInsert = {
      ...comment,
      markdown_content: comment.markdown_content || "[No markdown content]"
    };
    
    console.log(`[createComment] Final comment object for insertion:`, {
      ...commentToInsert,
      note: commentToInsert.note ? `${commentToInsert.note.substring(0, 50)}...` : undefined,
      markdown_content_length: commentToInsert.markdown_content ? commentToInsert.markdown_content.length : 0
    });
    
    // Use the Comment model to insert the comment
    const commentId = await Comment.insert(commentToInsert);
    console.log(`[createComment] Comment inserted with ID:`, commentId);
    
    // Verify the comment was inserted correctly
    const insertedComment = await Comment.get(commentId);
    if (insertedComment) {
      console.log(`[createComment] Verification - inserted comment:`, {
        comment_id: insertedComment.comment_id,
        has_markdown: !!insertedComment.markdown_content,
        markdown_length: insertedComment.markdown_content ? insertedComment.markdown_content.length : 0
      });
    }
    
    return commentId;
  } catch (error) {
    console.error(`Failed to create comment:`, error);
    throw new Error(`Failed to create comment`);
  }
}

export async function updateComment(id: string, comment: Partial<IComment>) {
  console.log(`[updateComment] Starting update for comment ID: ${id}`, {
    commentData: {
      ...comment,
      note: comment.note ? `${comment.note.substring(0, 50)}...` : undefined
    }
  });
  
  try {
    // Fetch existing comment to verify it exists
    const existingComment = await Comment.get(id);
    if (!existingComment) {
      console.error(`[updateComment] Comment with ID ${id} not found`);
      throw new Error(`Comment with id ${id} not found`);
    }
    console.log(`[updateComment] Found existing comment:`, existingComment);
    
    // Verify user permissions - only allow users to edit their own comments
    // or internal users to edit any comment
    if (comment.user_id && comment.user_id !== existingComment.user_id) {
      const { knex: db, tenant } = await createTenantKnex();
      const user = await db('users')
        .select('user_type')
        .where('user_id', comment.user_id)
        .andWhere('tenant', tenant!)
        .first();
      
      // Only internal users can edit other users' comments
      if (!user || user.user_type !== 'internal') {
        throw new Error('You can only edit your own comments');
      }
      
      // Set author_type based on user type
      if (user) {
        comment.author_type = user.user_type === 'internal' ? 'internal' : 'client';
      } else {
        comment.author_type = 'unknown';
      }
    }

    // Validate internal comment permissions
    if (comment.is_internal !== undefined) {
      // Only allow internal comments from internal users
      if (comment.is_internal && comment.author_type !== 'internal' && existingComment.author_type !== 'internal') {
        throw new Error('Only internal users can set comments as internal');
      }
      // If a client user is updating a comment, ensure they can't make it internal
      if (existingComment.author_type === 'client') {
        comment.is_internal = existingComment.is_internal; // Preserve internal status
      }
    }

    // Convert BlockNote JSON to Markdown if note is being updated
    if (comment.note !== undefined) {
      console.log(`[updateComment] Converting note to markdown for comment update`);
      
      try {
        comment.markdown_content = await convertBlockNoteToMarkdown(comment.note);
        
        if (!comment.markdown_content || comment.markdown_content.trim() === '') {
          console.warn(`[updateComment] Markdown conversion returned empty result, using fallback`);
          comment.markdown_content = "[Fallback markdown content]";
        }
        
        console.log(`[updateComment] Markdown conversion successful:`, {
          length: comment.markdown_content.length
        });
      } catch (conversionError) {
        console.error(`[updateComment] Error during markdown conversion:`, conversionError);
        comment.markdown_content = "[Error during content conversion]";
      }
    }

    // Create a copy of the comment object to ensure markdown_content is included
    const commentToUpdate = {
      ...comment,
      markdown_content: comment.note !== undefined ?
        (comment.markdown_content || "[No markdown content]") :
        comment.markdown_content
    };

    console.log(`[updateComment] Proceeding with update`, {
      finalUpdateData: {
        ...commentToUpdate,
        note: commentToUpdate.note ? `${commentToUpdate.note.substring(0, 50)}...` : undefined
      },
      hasMarkdownContent: commentToUpdate.markdown_content !== undefined,
      markdownContentLength: commentToUpdate.markdown_content ? commentToUpdate.markdown_content.length : 0
    });
    
    // Use the Comment model to update the comment
    await Comment.update(id, commentToUpdate);
    console.log(`[updateComment] Successfully updated comment with ID: ${id}`);
    
    // Verify the comment was updated correctly
    const updatedComment = await Comment.get(id);
    if (updatedComment) {
      console.log(`[updateComment] Verification - updated comment:`, {
        comment_id: updatedComment.comment_id,
        has_markdown: !!updatedComment.markdown_content,
        markdown_length: updatedComment.markdown_content ? updatedComment.markdown_content.length : 0
      });
    }
  } catch (error) {
    console.error(`[updateComment] Failed to update comment with ID ${id}:`, error);
    console.error(`[updateComment] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace available');
    throw new Error(`Failed to update comment with id ${id}`);
  }
}

export async function deleteComment(id: string) {
  try {
    await Comment.delete(id);
  } catch (error) {
    console.error(`Failed to delete comment with id ${id}:`, error);
    throw new Error(`Failed to delete comment with id ${id}`);
  }
}
