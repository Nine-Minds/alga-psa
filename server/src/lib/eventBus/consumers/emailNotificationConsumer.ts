import { createClient } from 'redis';
import { Event, EventSchemas, EventType } from '../events';
import { BaseEventSchema } from '../events';
import { sendEventEmail } from '../../notifications/sendEventEmail';
import logger from '../../../utils/logger';
import { getRedisConfig, getEventStream } from '../../../config/redisConfig';
import { getSecret } from '../../utils/getSecret';
import { getConnection } from '../../db/db';

const PROCESSED_EVENTS_TTL = 60 * 60 * 24 * 3; // 3 days in seconds

// Get consumer group from config
const config = getRedisConfig();
const CONSUMER_GROUP = config.eventBus.consumerGroup;

export async function initializeEmailNotificationConsumer(tenantId: string) {
  const config = getRedisConfig();
  const password = await getSecret('redis_password', 'REDIS_PASSWORD');
  const client = createClient({
    url: config.url,
    password,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > config.eventBus.reconnectStrategy.retries) {
          return new Error('Max reconnection attempts reached');
        }
        return Math.min(
          config.eventBus.reconnectStrategy.initialDelay,
          config.eventBus.reconnectStrategy.maxDelay
        );
      }
    }
  });

  client.on('error', (err) => {
    logger.error('[EmailNotificationConsumer] Redis Client Error:', err);
  });

  await client.connect();

  const consumerName = `${process.pid}-${Math.random()}`; // Unique consumer name

  // Initialize consumer groups for each event type
  for (const eventType of Object.keys(EventSchemas)) {
    const streamKey = getEventStream(eventType);
    try {
      // Check if stream exists
      const streamInfo = await client.xInfoStream(streamKey).catch(() => null);
      
      // If stream doesn't exist, create it with initial message
      if (!streamInfo) {
        await client.xAdd(streamKey, '*', { event: JSON.stringify({ init: true }) });
      }

      // Create consumer group
      await client.xGroupCreate(streamKey, CONSUMER_GROUP, '0', { MKSTREAM: true });
      logger.info(`[EmailNotificationConsumer] Created consumer group for stream: ${streamKey}`);
    } catch (error) {
      // Ignore if group already exists
      if (!(error instanceof Error && error.message.includes('BUSYGROUP'))) {
        logger.error(`[EmailNotificationConsumer] Error creating consumer group for ${streamKey}:`, error);
        throw error;
      }
    }
  }

  async function getEmailRecipient(event: Event): Promise<string | null> {
    const knex = await getConnection(tenantId);
    
    switch (event.eventType) {
      case 'TICKET_CREATED':
      case 'TICKET_UPDATED':
      case 'TICKET_CLOSED':
      case 'TICKET_ASSIGNED':
      case 'TICKET_COMMENT_ADDED': {
        const ticket = await knex('tickets as t')
          .select(
            't.assigned_to',
            't.ticket_number',
            't.title',
            'c.email as company_email',
            'co.email as contact_email',
            'p.priority_name',
            's.name as status_name'
          )
          .leftJoin('contacts as co', function() {
            this.on('t.contact_name_id', 'co.contact_name_id')
                .andOn('t.tenant', 'co.tenant');
          })
          .leftJoin('companies as c', function() {
            this.on('t.company_id', 'c.company_id')
                .andOn('t.tenant', 'c.tenant');
          })
          .leftJoin('priorities as p', function() {
            this.on('t.priority_id', 'p.priority_id')
                .andOn('t.tenant', 'p.tenant');
          })
          .leftJoin('statuses as s', function() {
            this.on('t.status_id', 's.status_id')
                .andOn('t.tenant', 's.tenant');
          })
          .where('t.ticket_id', event.payload.ticketId)
          .first();

        // Store ticket details in event payload for email context
        if (ticket) {
          event.payload.ticketNumber = ticket.ticket_number;
          event.payload.title = ticket.title;
          event.payload.priority = ticket.priority_name || 'Unknown';
          event.payload.status = ticket.status_name || 'Unknown';
        }
        
        // Return company email if available
        if (ticket?.company_email) {
          return ticket.company_email;
        }
        
        // Fallback to assigned user's email
        if (ticket?.assigned_to) {
          const user = await knex('users')
            .select('email')
            .where('user_id', ticket.assigned_to)
            .first();
          return user?.email || null;
        }
        break;
      }
      
      case 'TIME_ENTRY_SUBMITTED':
      case 'TIME_ENTRY_APPROVED': {
        const user = await knex('users')
          .select('email')
          .where('id', event.payload.userId)
          .first();
        return user?.email || null;
      }
      
      case 'INVOICE_GENERATED':
      case 'INVOICE_FINALIZED': {
        const company = await knex('companies')
          .select('billing_email')
          .where('id', event.payload.companyId)
          .first();
        return company?.billing_email || null;
      }

      case 'PROJECT_CREATED':
      case 'PROJECT_UPDATED':
      case 'PROJECT_CLOSED': {
        const project = await knex('projects as p')
          .select(
            'p.*',
            'c.email as company_email',
            'ct.email as contact_email',
            's.name as status_name',
            'u.email as assigned_user_email'
          )
          .leftJoin('companies as c', function() {
            this.on('c.company_id', '=', 'p.company_id')
                .andOn('c.tenant', '=', 'p.tenant');
          })
          .leftJoin('contacts as ct', function() {
            this.on('ct.contact_name_id', '=', 'p.contact_name_id')
                .andOn('ct.tenant', '=', 'p.tenant')
                .andOn('ct.is_inactive', '=', knex.raw('false'));
          })
          .leftJoin('users as u', function() {
            this.on('u.user_id', '=', 'p.assigned_to')
                .andOn('u.tenant', '=', 'p.tenant')
                .andOn('u.is_inactive', '=', knex.raw('false'));
          })
          .leftJoin('statuses as s', function() {
            this.on('s.status_id', '=', 'p.status')
                .andOn('s.tenant', '=', 'p.tenant');
          })
          .where('p.project_id', event.payload.projectId)
          .first();

        if (project) {
          event.payload.projectNumber = project.project_number;
          event.payload.name = project.project_name;
          event.payload.status = project.status_name || 'Unknown';
        }

        // Collect all recipient emails
        const recipients: string[] = [];

        // Add contact or company email
        if (project?.contact_email) {
          recipients.push(project.contact_email);
        } else if (project?.company_email) {
          recipients.push(project.company_email);
        }

        // Always add assigned user email if available
        if (project?.assigned_user_email) {
          recipients.push(project.assigned_user_email);
        }

        return recipients.length > 0 ? recipients.join(',') : null;
      }
    }
    
    return null;
  }

  async function getEmailTemplate(eventType: EventType): Promise<string> {
    switch (eventType) {
      case 'TICKET_CREATED':
        return 'ticket-created';
      case 'TICKET_UPDATED':
        return 'ticket-updated';
      case 'TICKET_CLOSED':
        return 'ticket-closed';
      case 'TICKET_ASSIGNED':
        return 'ticket-assigned';
      case 'TICKET_COMMENT_ADDED':
        return 'ticket-comment-added';
      case 'TIME_ENTRY_SUBMITTED':
        return 'time-entry-submitted';
      case 'TIME_ENTRY_APPROVED':
        return 'time-entry-approved';
      case 'INVOICE_GENERATED':
        return 'invoice-generated';
      case 'INVOICE_FINALIZED':
        return 'invoice-finalized';
      case 'PROJECT_CREATED':
        return 'project-created';
      case 'PROJECT_UPDATED':
        return 'project-updated';
      case 'PROJECT_CLOSED':
        return 'project-closed';
      default:
        throw new Error(`No email template defined for event type: ${eventType}`);
    }
  }

  async function getEmailSubject(event: Event): Promise<string> {
    switch (event.eventType) {
      case 'TICKET_CREATED':
        return 'New Ticket Assigned';
      case 'TICKET_UPDATED':
        return 'Ticket Updated';
      case 'TICKET_CLOSED':
        return 'Ticket Closed';
      case 'TICKET_ASSIGNED':
        return 'Ticket Assignment Changed';
      case 'TICKET_COMMENT_ADDED':
        return `New Comment on Ticket: ${event.payload.ticket.title}`;
      case 'TIME_ENTRY_SUBMITTED':
        return 'Time Entry Submitted for Approval';
      case 'TIME_ENTRY_APPROVED':
        return 'Time Entry Approved';
      case 'INVOICE_GENERATED':
        return 'New Invoice Generated';
      case 'INVOICE_FINALIZED':
        return 'Invoice Finalized';
      case 'PROJECT_CREATED':
        return `New Project: ${event.payload.name}`;
      case 'PROJECT_UPDATED':
        return `Project Updated: ${event.payload.name}`;
      case 'PROJECT_CLOSED':
        return `Project Closed: ${event.payload.name}`;
      default:
        return `${event.eventType} Notification`;
    }
  }

  const getProcessedSetKey = (tenantId: string): string => {
    return `processed_events:email:${tenantId}`;
  };

  const isEventProcessed = async (event: Event): Promise<boolean> => {
    const setKey = getProcessedSetKey(event.payload.tenantId);
    return await client.sIsMember(setKey, event.id);
  };

  const markEventProcessed = async (event: Event): Promise<void> => {
    const setKey = getProcessedSetKey(event.payload.tenantId);
    await client.sAdd(setKey, event.id);
    await client.expire(setKey, PROCESSED_EVENTS_TTL);
  };

  async function processMessages() {
    try {
      const streams = Object.keys(EventSchemas).map((eventType): { key: string; id: string } => ({
        key: getEventStream(eventType),
        id: '>'
      }));

      const streamResponses = await client.xReadGroup(
        CONSUMER_GROUP,
        consumerName,
        streams,
        {
          COUNT: config.eventBus.batchSize,
          BLOCK: config.eventBus.blockingTimeout
        }
      );

      if (streamResponses) {
        for (const { name: stream, messages } of streamResponses) {
          for (const message of messages) {
            try {
              const rawEvent = JSON.parse(message.message.event as string);
              const baseEvent = BaseEventSchema.parse(rawEvent);
              const eventSchema = EventSchemas[baseEvent.eventType];

              if (!eventSchema) {
                logger.error('[EmailNotificationConsumer] Unknown event type:', {
                  eventType: baseEvent.eventType,
                  availableTypes: Object.keys(EventSchemas)
                });
                await client.xAck(stream, CONSUMER_GROUP, message.id);
                continue;
              }

              const event = eventSchema.parse(rawEvent) as Event;

              // Check if event has already been processed
              const isProcessed = await isEventProcessed(event);
              if (isProcessed) {
                logger.info('[EmailNotificationConsumer] Skipping already processed event:', {
                  eventId: event.id,
                  eventType: event.eventType
                });
                await client.xAck(stream, CONSUMER_GROUP, message.id);
                continue;
              }

              // Get email recipient
              const recipientEmail = await getEmailRecipient(event);
              if (!recipientEmail) {
                logger.warn('[EmailNotificationConsumer] No recipient found for event:', {
                  eventType: event.eventType,
                  eventId: event.id
                });
                await client.xAck(stream, CONSUMER_GROUP, message.id);
                continue;
              }

              // Send email notification
              await sendEventEmail({
                tenantId,
                to: recipientEmail,
                subject: await getEmailSubject(event),
                template: await getEmailTemplate(event.eventType),
                context: event.eventType.startsWith('PROJECT_') ? {
                  project: {
                    id: event.payload.projectNumber || event.payload.projectId,
                    name: event.payload.name,
                    status: event.payload.status,
                    url: `/projects/${event.payload.projectNumber || event.payload.projectId}`
                  }
                } : {
                  ticket: {
                    id: event.payload.ticketNumber || event.payload.ticketId,
                    title: event.payload.title,
                    priority: event.payload.priority,
                    status: event.payload.status,
                    url: `/tickets/${event.payload.ticketNumber || event.payload.ticketId}`
                  }
                }
              });

              // Mark as processed and acknowledge
              await markEventProcessed(event);
              await client.xAck(stream, CONSUMER_GROUP, message.id);
              
              logger.info('[EmailNotificationConsumer] Successfully processed event:', {
                eventType: event.eventType,
                eventId: event.id,
                recipient: recipientEmail
              });
            } catch (error) {
              logger.error('[EmailNotificationConsumer] Error processing message:', {
                error,
                stream,
                messageId: message.id,
                errorMessage: error instanceof Error ? error.message : 'Unknown error'
              });
              // Don't acknowledge - will be retried
              continue;
            }
          }
        }
      }
    } catch (error) {
      logger.error('[EmailNotificationConsumer] Error in message processing loop:', error);
    }

    // Continue processing
    setImmediate(processMessages);
  }

  async function checkPendingMessages() {
    try {
      // Check pending messages for each event type stream
      for (const eventType of Object.keys(EventSchemas)) {
        const streamKey = getEventStream(eventType);
        
        // Get pending entries that are idle for more than 60 seconds
        const pendingInfo = await client.xPending(
          streamKey,
          CONSUMER_GROUP
        );

        if (pendingInfo.pending === 0) continue;

        // Get detailed pending entries
        const pendingEntries = await client.xPendingRange(
          streamKey,
          CONSUMER_GROUP,
          '-',
          '+',
          10
        );

        for (const entry of pendingEntries) {
          const { id: messageId, millisecondsSinceLastDelivery: idleTime } = entry;
          // Only process messages that have been idle for more than 60 seconds
          if (idleTime > 60000) {
            // Claim the message
            const claimed = await client.xClaim(
              streamKey,
              CONSUMER_GROUP,
              consumerName,
              60000,
              [messageId]
            );

            if (claimed && claimed.length > 0 && claimed[0]?.message) {
              const message = claimed[0];
              try {
                const rawEvent = JSON.parse(message.message.event as string);
                const baseEvent = BaseEventSchema.parse(rawEvent);
                const eventSchema = EventSchemas[baseEvent.eventType];

                if (!eventSchema) {
                  logger.error('[EmailNotificationConsumer] Unknown event type in pending message:', {
                    eventType: baseEvent.eventType,
                    messageId
                  });
                  await client.xAck(streamKey, CONSUMER_GROUP, messageId);
                  continue;
                }

                const event = eventSchema.parse(rawEvent) as Event;

                // Check if already processed
                const isProcessed = await isEventProcessed(event);
                if (isProcessed) {
                  logger.info('[EmailNotificationConsumer] Skipping already processed pending event:', {
                    eventId: event.id,
                    eventType: event.eventType
                  });
                  await client.xAck(streamKey, CONSUMER_GROUP, messageId);
                  continue;
                }

                // Get email recipient
                const recipientEmail = await getEmailRecipient(event);
                if (!recipientEmail) {
                  logger.warn('[EmailNotificationConsumer] No recipient found for pending event:', {
                    eventType: event.eventType,
                    eventId: event.id
                  });
                  await client.xAck(streamKey, CONSUMER_GROUP, messageId);
                  continue;
                }

                // Send email notification
                await sendEventEmail({
                  tenantId,
                  to: recipientEmail,
                  subject: await getEmailSubject(event),
                  template: await getEmailTemplate(event.eventType),
                  context: event.eventType.startsWith('PROJECT_') ? {
                    project: {
                      id: event.payload.projectNumber || event.payload.projectId,
                      name: event.payload.name,
                      status: event.payload.status,
                      url: `/projects/${event.payload.projectNumber || event.payload.projectId}`
                    }
                  } : {
                    ticket: {
                      id: event.payload.ticketNumber || event.payload.ticketId,
                      title: event.payload.title,
                      priority: event.payload.priority,
                      status: event.payload.status,
                      url: `/tickets/${event.payload.ticketNumber || event.payload.ticketId}`
                    }
                  }
                });

                // Mark as processed and acknowledge
                await markEventProcessed(event);
                await client.xAck(streamKey, CONSUMER_GROUP, messageId);

                logger.info('[EmailNotificationConsumer] Successfully processed pending event:', {
                  eventType: event.eventType,
                  eventId: event.id,
                  recipient: recipientEmail
                });
              } catch (error) {
                logger.error('[EmailNotificationConsumer] Error processing pending message:', {
                  error,
                  streamKey,
                  messageId,
                  errorMessage: error instanceof Error ? error.message : 'Unknown error'
                });
                // Don't acknowledge - will be retried
                continue;
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('[EmailNotificationConsumer] Error checking pending messages:', error);
    }

    // Schedule next check
    setTimeout(checkPendingMessages, 60000); // Check every 60 seconds
  }

  // Start processing messages and checking pending messages
  processMessages();
  checkPendingMessages();

  // Return cleanup function
  return async () => {
    await client.quit();
  };
}
