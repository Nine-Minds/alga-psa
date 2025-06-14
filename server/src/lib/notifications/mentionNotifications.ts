/**
 * Utility functions for creating USER_MENTIONED notifications
 * Can be called directly from comment creation logic
 */

import { NotificationPublisher } from './publisher';
import { createTenantKnex } from '../db';
import logger from '@shared/core/logger';

/**
 * Parse @mentions from text content
 */
function parseUserMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]); // Extract username without @
  }
  return mentions;
}

/**
 * Create USER_MENTIONED notifications for @mentions in content
 */
export async function createMentionNotifications(
  content: string,
  contextType: 'ticket' | 'project' | 'task' | 'document',
  contextId: string,
  contextName: string,
  mentioningUserId: string,
  tenantId: string
): Promise<void> {
  try {
    const mentions = parseUserMentions(content);
    if (mentions.length === 0) return;

    const { knex: tenantKnex } = await createTenantKnex();
    
    // Get mentioned users
    const mentionedUsers = await tenantKnex('users')
      .where('tenant', tenantId)
      .where('is_active', true)
      .whereIn('username', mentions)
      .whereNot('user_id', mentioningUserId) // Don't notify the person who made the mention
      .select('user_id', 'username', 'first_name', 'last_name');

    if (mentionedUsers.length === 0) return;

    // Get the mentioning user's name
    const mentioningUser = await tenantKnex('users')
      .where('user_id', mentioningUserId)
      .first();
    
    const mentioningUserName = mentioningUser 
      ? `${mentioningUser.first_name} ${mentioningUser.last_name}`.trim()
      : 'Someone';

    // Get notification type
    const notificationType = await tenantKnex('internal_notification_types')
      .where('type_name', 'USER_MENTIONED')
      .first();

    if (!notificationType) {
      logger.error('USER_MENTIONED notification type not found');
      return;
    }

    // Determine action URL based on context
    const getActionUrl = (contextType: string, contextId: string): string => {
      switch (contextType) {
        case 'ticket':
          return `/msp/tickets/${contextId}`;
        case 'project':
          return `/msp/projects/${contextId}`;
        case 'task':
          return `/msp/projects/${contextId}`; // Assuming tasks link to project
        case 'document':
          return `/msp/documents/${contextId}`;
        default:
          return '/msp/dashboard';
      }
    };

    const publisher = new NotificationPublisher();
    try {
      for (const user of mentionedUsers) {
        await publisher.publishNotification({
          user_id: String(user.user_id),
          type_id: notificationType.internal_notification_type_id,
          title: '', // Will be populated from template
          data: {
            user_name: mentioningUserName,
            context_type: contextType,
            context_name: contextName,
            context_id: contextId,
            mentioned_username: user.username,
            content_preview: content.substring(0, 100)
          },
          action_url: getActionUrl(contextType, contextId),
        });
      }

      logger.info(`Created ${mentionedUsers.length} mention notifications`, {
        contextType,
        contextId,
        mentions: mentions.join(', '),
        mentioningUser: mentioningUserName
      });
    } finally {
      publisher.disconnect();
    }

  } catch (error) {
    logger.error('Failed to create mention notifications:', {
      error: error instanceof Error ? error.message : String(error),
      contextType,
      contextId
    });
  }
}

/**
 * Create a DOCUMENT_SHARED notification
 */
export async function createDocumentSharedNotification(
  documentId: string,
  documentName: string,
  sharedWithUserIds: string[],
  sharingUserId: string,
  tenantId: string
): Promise<void> {
  try {
    const { knex: tenantKnex } = await createTenantKnex();
    
    // Get the sharing user's name
    const sharingUser = await tenantKnex('users')
      .where('user_id', sharingUserId)
      .first();
    
    const sharingUserName = sharingUser 
      ? `${sharingUser.first_name} ${sharingUser.last_name}`.trim()
      : 'Someone';

    // Get notification type
    const notificationType = await tenantKnex('internal_notification_types')
      .where('type_name', 'DOCUMENT_SHARED')
      .first();

    if (!notificationType) {
      logger.error('DOCUMENT_SHARED notification type not found');
      return;
    }

    const publisher = new NotificationPublisher();
    try {
      for (const userId of sharedWithUserIds) {
        if (userId === sharingUserId) continue; // Don't notify the sharer
        
        await publisher.publishNotification({
          user_id: String(userId),
          type_id: notificationType.internal_notification_type_id,
          title: '', // Will be populated from template
          data: {
            user_name: sharingUserName,
            document_name: documentName,
            document_id: documentId
          },
          action_url: `/msp/documents/${documentId}`,
        });
      }

      logger.info(`Created ${sharedWithUserIds.length} document shared notifications`, {
        documentId,
        documentName,
        sharingUser: sharingUserName
      });
    } finally {
      publisher.disconnect();
    }

  } catch (error) {
    logger.error('Failed to create document shared notifications:', {
      error: error instanceof Error ? error.message : String(error),
      documentId
    });
  }
}

/**
 * Example usage in comment creation:
 * 
 * // In ticket comment creation
 * await createMentionNotifications(
 *   commentContent,
 *   'ticket',
 *   ticketId,
 *   ticketTitle,
 *   currentUserId,
 *   tenantId
 * );
 */