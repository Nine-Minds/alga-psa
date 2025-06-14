/**
 * Scheduled notification jobs for time-based notifications
 * Uses pg-boss for job scheduling and notification creation
 */

import { JobScheduler, IJobScheduler } from '../jobs/jobScheduler';
import { JobService } from '../../services/job.service';
import { StorageService } from '../storage/StorageService';
import { NotificationPublisher } from './publisher';
import { createTenantKnex } from '../db';
import logger from '@shared/core/logger';

/**
 * Schedule all recurring notification jobs
 */
export async function scheduleAllNotificationJobs(): Promise<void> {
  try {
    // Get JobScheduler instance
    const jobService = await JobService.create();
    const storageService = new StorageService();
    const jobScheduler: IJobScheduler = await JobScheduler.getInstance(jobService, storageService);
    
    // Register handlers first
    jobScheduler.registerJobHandler('sla-breach-notifications', handleSLABreachCheck);
    jobScheduler.registerJobHandler('task-due-notifications', handleTaskDueCheck);
    jobScheduler.registerJobHandler('invoice-overdue-notifications', handleInvoiceOverdueCheck);
    jobScheduler.registerJobHandler('bucket-hours-notifications', handleBucketHoursCheck);
    jobScheduler.registerJobHandler('asset-warranty-notifications', handleAssetWarrantyCheck);
    
    // Schedule recurring jobs
    // SLA breach warning checks (every 15 minutes)
    await jobScheduler.scheduleRecurringJob('sla-breach-notifications', '*/15 * * * *', { tenantId: 'system' });
    
    // Task due date checks (daily at 9 AM)
    await jobScheduler.scheduleRecurringJob('task-due-notifications', '0 9 * * *', { tenantId: 'system' });
    
    // Invoice overdue checks (daily at 10 AM)
    await jobScheduler.scheduleRecurringJob('invoice-overdue-notifications', '0 10 * * *', { tenantId: 'system' });
    
    // Bucket hours low checks (daily at 8 AM)
    await jobScheduler.scheduleRecurringJob('bucket-hours-notifications', '0 8 * * *', { tenantId: 'system' });
    
    // Asset warranty expiring checks (weekly on Monday at 9 AM)
    await jobScheduler.scheduleRecurringJob('asset-warranty-notifications', '0 9 * * 1', { tenantId: 'system' });
    
    logger.info('All notification scheduled jobs have been registered');
  } catch (error) {
    logger.error('Failed to schedule notification jobs:', error);
    throw error;
  }
}

/**
 * Check for tickets approaching SLA breach
 */
async function handleSLABreachCheck(job: any): Promise<void> {
  try {
    const { knex: tenantKnex, tenant } = await createTenantKnex();
    
    // Find tickets approaching SLA breach (within 1 hour)
    const breachingTickets = await tenantKnex('tickets as t')
      .leftJoin('sla_policies as sla', 't.sla_policy_id', 'sla.sla_policy_id')
      .where('t.tenant', tenant)
      .whereNull('t.closed_at')
      .whereNotNull('sla.response_time_hours')
      .whereRaw(`
        EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 > (sla.response_time_hours - 1)
        AND EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 < sla.response_time_hours
      `)
      .select('t.*', 'sla.response_time_hours');

    const publisher = new NotificationPublisher();
    try {
      for (const ticket of breachingTickets) {
        // Notify assigned user and managers
        const userIds = [];
        if (ticket.assigned_to) {
          userIds.push(String(ticket.assigned_to));
        }
        
        // Notify managers
        const managers = await tenantKnex('users')
          .where('tenant', tenant)
          .whereIn('role', ['admin', 'manager'])
          .where('is_active', true)
          .pluck('user_id');
        userIds.push(...managers.map(id => String(id)));
        
        // Get notification type
        const notificationType = await tenantKnex('internal_notification_types')
          .where('type_name', 'TICKET_SLA_BREACH_WARNING')
          .first();
        
        if (notificationType) {
          for (const userId of [...new Set(userIds)]) {
            await publisher.publishNotification({
              user_id: userId,
              type_id: notificationType.internal_notification_type_id,
              title: '', // Will be populated from template
              data: {
                ticket_number: ticket.ticket_number,
                ticket_title: ticket.title,
                sla_hours: ticket.response_time_hours,
                ticket_id: ticket.ticket_id
              },
              action_url: `/msp/tickets/${ticket.ticket_id}`,
            });
          }
        }
      }
      
      logger.info(`Processed ${breachingTickets.length} SLA breach warnings`);
    } finally {
      publisher.disconnect();
    }
  } catch (error) {
    logger.error('Failed to process SLA breach notifications:', error);
  }
}

/**
 * Check for tasks that are due soon or overdue
 */
async function handleTaskDueCheck(job: any): Promise<void> {
  try {
    const { knex: tenantKnex, tenant } = await createTenantKnex();
    
    // Find tasks due within next 24 hours or overdue
    const dueTasks = await tenantKnex('project_tasks as pt')
      .join('projects as p', 'pt.project_id', 'p.project_id')
      .where('pt.tenant', tenant)
      .whereNotNull('pt.assigned_to')
      .whereNotNull('pt.due_date')
      .whereNull('pt.completed_at')
      .where(function() {
        // Due within next 24 hours or overdue
        this.whereBetween('pt.due_date', [
          tenantKnex.raw('NOW()'),
          tenantKnex.raw("NOW() + INTERVAL '24 hours'")
        ]).orWhere('pt.due_date', '<', tenantKnex.raw('NOW()'));
      })
      .select('pt.*', 'p.project_name');

    const publisher = new NotificationPublisher();
    try {
      for (const task of dueTasks) {
        // Get notification type
        const notificationType = await tenantKnex('internal_notification_types')
          .where('type_name', 'PROJECT_TASK_DUE')
          .first();
        
        if (notificationType) {
          await publisher.publishNotification({
            user_id: String(task.assigned_to),
            type_id: notificationType.internal_notification_type_id,
            title: '', // Will be populated from template
            data: {
              task_name: task.task_name,
              project_name: task.project_name,
              due_date: task.due_date.toISOString().split('T')[0],
              project_id: task.project_id,
              task_id: task.task_id
            },
            action_url: `/msp/projects/${task.project_id}`,
          });
        }
      }
      
      logger.info(`Processed ${dueTasks.length} task due notifications`);
    } finally {
      publisher.disconnect();
    }
  } catch (error) {
    logger.error('Failed to process task due notifications:', error);
  }
}

/**
 * Check for overdue invoices
 */
async function handleInvoiceOverdueCheck(job: any): Promise<void> {
  try {
    const { knex: tenantKnex, tenant } = await createTenantKnex();
    
    // Find invoices that are overdue (past due date + grace period)
    const overdueInvoices = await tenantKnex('invoices as i')
      .join('companies as c', 'i.company_id', 'c.company_id')
      .where('i.tenant', tenant)
      .where('i.status', 'sent')
      .where('i.due_date', '<', tenantKnex.raw('NOW()'))
      .whereNull('i.paid_at')
      .select('i.*', 'c.company_name');

    const publisher = new NotificationPublisher();
    try {
      for (const invoice of overdueInvoices) {
        // Notify accounting staff and managers
        const accountingUsers = await tenantKnex('users')
          .where('tenant', tenant)
          .whereIn('role', ['admin', 'manager', 'accountant'])
          .where('is_active', true)
          .pluck('user_id');
        
        // Get notification type
        const notificationType = await tenantKnex('internal_notification_types')
          .where('type_name', 'INVOICE_OVERDUE')
          .first();
        
        if (notificationType) {
          for (const userId of accountingUsers) {
            await publisher.publishNotification({
              user_id: String(userId),
              type_id: notificationType.internal_notification_type_id,
              title: '', // Will be populated from template
              data: {
                invoice_number: invoice.invoice_number,
                company_name: invoice.company_name,
                amount: `$${invoice.total_amount}`,
                days_overdue: Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24)),
                invoice_id: invoice.invoice_id
              },
              action_url: `/msp/invoices/${invoice.invoice_id}`,
            });
          }
        }
      }
      
      logger.info(`Processed ${overdueInvoices.length} overdue invoice notifications`);
    } finally {
      publisher.disconnect();
    }
  } catch (error) {
    logger.error('Failed to process overdue invoice notifications:', error);
  }
}

/**
 * Check for bucket hours running low
 */
async function handleBucketHoursCheck(job: any): Promise<void> {
  try {
    const { knex: tenantKnex, tenant } = await createTenantKnex();
    
    // Find buckets with low remaining hours (< 20% of original)
    const lowBuckets = await tenantKnex('bucket_usage as bu')
      .join('companies as c', 'bu.company_id', 'c.company_id')
      .where('bu.tenant', tenant)
      .where('bu.is_active', true)
      .whereRaw('bu.hours_remaining < (bu.hours_purchased * 0.2)')
      .select('bu.*', 'c.company_name');

    const publisher = new NotificationPublisher();
    try {
      for (const bucket of lowBuckets) {
        // Notify account managers and client contacts
        const userIds = [];
        
        // Get account managers
        const managers = await tenantKnex('users')
          .where('tenant', tenant)
          .whereIn('role', ['admin', 'manager', 'account_manager'])
          .where('is_active', true)
          .pluck('user_id');
        userIds.push(...managers.map(id => String(id)));
        
        // Get notification type
        const notificationType = await tenantKnex('internal_notification_types')
          .where('type_name', 'BUCKET_HOURS_LOW')
          .first();
        
        if (notificationType) {
          for (const userId of [...new Set(userIds)]) {
            await publisher.publishNotification({
              user_id: String(userId),
              type_id: notificationType.internal_notification_type_id,
              title: '', // Will be populated from template
              data: {
                bucket_name: `${bucket.company_name} Prepaid Hours`,
                hours_remaining: bucket.hours_remaining,
                hours_purchased: bucket.hours_purchased,
                percentage_remaining: Math.round((bucket.hours_remaining / bucket.hours_purchased) * 100),
                company_id: bucket.company_id
              },
              action_url: `/msp/companies/${bucket.company_id}`,
            });
          }
        }
      }
      
      logger.info(`Processed ${lowBuckets.length} low bucket notifications`);
    } finally {
      publisher.disconnect();
    }
  } catch (error) {
    logger.error('Failed to process bucket hours notifications:', error);
  }
}

/**
 * Check for assets with expiring warranties
 */
async function handleAssetWarrantyCheck(job: any): Promise<void> {
  try {
    const { knex: tenantKnex, tenant } = await createTenantKnex();
    
    // Find assets with warranties expiring within 30 days
    const expiringAssets = await tenantKnex('assets as a')
      .join('companies as c', 'a.company_id', 'c.company_id')
      .where('a.tenant', tenant)
      .whereNotNull('a.warranty_end_date')
      .whereBetween('a.warranty_end_date', [
        tenantKnex.raw('NOW()'),
        tenantKnex.raw("NOW() + INTERVAL '30 days'")
      ])
      .select('a.*', 'c.company_name');

    const publisher = new NotificationPublisher();
    try {
      for (const asset of expiringAssets) {
        // Notify managers and technicians
        const managers = await tenantKnex('users')
          .where('tenant', tenant)
          .whereIn('role', ['admin', 'manager', 'technician'])
          .where('is_active', true)
          .pluck('user_id');
        
        // Get notification type
        const notificationType = await tenantKnex('internal_notification_types')
          .where('type_name', 'ASSET_WARRANTY_EXPIRING')
          .first();
        
        if (notificationType) {
          for (const userId of managers) {
            await publisher.publishNotification({
              user_id: String(userId),
              type_id: notificationType.internal_notification_type_id,
              title: '', // Will be populated from template
              data: {
                asset_name: asset.asset_name || `${asset.manufacturer} ${asset.model}`,
                company_name: asset.company_name,
                expiry_date: asset.warranty_end_date.toISOString().split('T')[0],
                days_until_expiry: Math.ceil((new Date(asset.warranty_end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
                asset_id: asset.asset_id
              },
              action_url: `/msp/assets/${asset.asset_id}`,
            });
          }
        }
      }
      
      logger.info(`Processed ${expiringAssets.length} warranty expiration notifications`);
    } finally {
      publisher.disconnect();
    }
  } catch (error) {
    logger.error('Failed to process asset warranty notifications:', error);
  }
}

/**
 * Initialize scheduled notification jobs
 */
export async function initializeScheduledNotifications(): Promise<void> {
  try {
    await scheduleAllNotificationJobs();
    logger.info('Scheduled notification system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize scheduled notifications:', error);
    throw error;
  }
}