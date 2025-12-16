import { Knex } from 'knex';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { getEmailNotificationService } from 'server/src/lib/notifications/email';
import { ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { formatCurrency, formatDate } from 'server/src/lib/utils/formatters';
import { toPlainDate, toISODate } from 'server/src/lib/utils/dateTimeUtils';

export interface ExpiringCreditsNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

/**
 * Job handler for sending notifications about credits that will expire soon
 * This job:
 * 1. Finds credits that will expire within the configured notification thresholds
 * 2. Groups them by client and expiration date
 * 3. Sends notifications to client contacts
 * 
 * @param data Job data containing tenant ID and optional client ID
 */
export async function expiringCreditsNotificationHandler(data: ExpiringCreditsNotificationJobData): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for expiring credits notification job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    console.log(`Processing expiring credits notifications for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      // Get notification thresholds from settings
      const defaultSettings = await knex('default_billing_settings')
        .where({ tenant: tenantId })
        .first();

      if (!defaultSettings || !defaultSettings.credit_expiration_notification_days) {
        console.log('No notification thresholds configured, skipping notifications');
        return;
      }

      const notificationThresholds: number[] = defaultSettings.credit_expiration_notification_days;

      if (!notificationThresholds.length) {
        console.log('Empty notification thresholds array, skipping notifications');
        return;
      }

      // Process each threshold
      for (const daysBeforeExpiration of notificationThresholds) {
        await processNotificationsForThreshold(knex, tenantId, daysBeforeExpiration, clientId);
      }

    } catch (error: any) {
      console.error(`Error processing expiring credits notifications: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}

/**
 * Process notifications for a specific threshold (days before expiration)
 */
async function processNotificationsForThreshold(
  knex: Knex,
  tenant: string,
  daysBeforeExpiration: number,
  clientId?: string
): Promise<void> {
  // Calculate the target date (credits expiring in exactly daysBeforeExpiration days)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBeforeExpiration);
  
  // Format dates for SQL comparison (start and end of the target day)
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  
  // Find credits expiring on the target date
  let query = knex('credit_tracking')
    .where('tenant', tenant)
    .where('is_expired', false)
    .whereNotNull('expiration_date')
    .where('remaining_amount', '>', 0)
    .whereBetween('expiration_date', [startOfDay.toISOString(), endOfDay.toISOString()]);
  
  // Add client filter if provided
  if (clientId) {
    query = query.where('client_id', clientId);
  }
  
  const expiringCredits: ICreditTracking[] = await query;
  
  if (!expiringCredits.length) {
    console.log(`No credits expiring in ${daysBeforeExpiration} days`);
    return;
  }
  
  console.log(`Found ${expiringCredits.length} credits expiring in ${daysBeforeExpiration} days`);
  
  // Group credits by client
  const creditsByClient: Record<string, ICreditTracking[]> = {};
  
  for (const credit of expiringCredits) {
    if (!creditsByClient[credit.client_id]) {
      creditsByClient[credit.client_id] = [];
    }
    creditsByClient[credit.client_id].push(credit);
  }
  
  // Process each client
  for (const [clientId, credits] of Object.entries(creditsByClient)) {
    await sendClientNotification(knex, tenant, clientId, credits, daysBeforeExpiration);
  }
}

/**
 * Send notification for a specific client's expiring credits
 */
async function sendClientNotification(
  knex: Knex,
  tenant: string,
  clientId: string,
  credits: ICreditTracking[],
  daysBeforeExpiration: number
): Promise<void> {
  try {
    // Get client details
    const client = await knex('clients')
      .where({ client_id: clientId, tenant })
      .first();
      
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }
    
    // Get client billing contacts
    const contacts = await knex('client_contacts')
      .where({ client_id: clientId, tenant })
      .where('is_billing_contact', true)
      .select('user_id', 'email');
      
    if (!contacts.length) {
      console.log(`No billing contacts found for client ${clientId}, skipping notification`);
      return;
    }
    
    // Get transaction details for each credit
    const transactionIds = credits.map(credit => credit.transaction_id);
    const transactions = await knex('transactions')
      .whereIn('transaction_id', transactionIds)
      .where('tenant', tenant);
      
    // Create transaction lookup map
    const transactionMap = transactions.reduce((acc, tx) => {
      acc[tx.transaction_id] = tx;
      return acc;
    }, {} as Record<string, any>);
    
    // Calculate total expiring amount
    const totalAmount = credits.reduce((sum, credit) => sum + Number(credit.remaining_amount), 0);
    
    // Format credit data for the email template
    const creditItems = credits.map(credit => ({
      creditId: credit.credit_id,
      amount: formatCurrency(Number(credit.remaining_amount)),
      expirationDate: formatDate(credit.expiration_date),
      transactionId: credit.transaction_id,
      description: transactionMap[credit.transaction_id]?.description || 'N/A'
    }));
    
    // Prepare email template data
    const templateData = {
      client: {
        id: client.client_id,
        name: client.name
      },
      credits: {
        totalAmount: formatCurrency(totalAmount),
        expirationDate: formatDate(credits[0].expiration_date),
        daysRemaining: daysBeforeExpiration,
        items: creditItems,
        url: `${process.env.APP_URL}/billing/credits?client=${clientId}`
      }
    };
    
    // Get notification service
    const notificationService = getEmailNotificationService();
    
    // Get notification subtype
    const subtype = await knex('notification_subtypes')
      .where({ name: 'Credit Expiring' })
      .first();
      
    if (!subtype) {
      throw new Error('Credit Expiring notification subtype not found');
    }
    
    // Send notification to each contact
    for (const contact of contacts) {
      await notificationService.sendNotification({
        tenant,
        userId: contact.user_id,
        subtypeId: subtype.id,
        emailAddress: contact.email,
        templateName: 'credit-expiring',
        data: templateData
      });
      
      console.log(`Sent credit expiration notification to ${contact.email} for client ${client.name}`);
    }
    
  } catch (error: any) {
    console.error(`Error sending client notification for ${clientId}: ${error.message}`);
    throw error;
  }
}