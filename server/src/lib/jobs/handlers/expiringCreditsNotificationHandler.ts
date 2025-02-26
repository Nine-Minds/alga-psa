import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { getEmailNotificationService } from '@/lib/notifications/email';
import { ICreditTracking } from '@/interfaces/billing.interfaces';
import { formatCurrency, formatDate } from '@/lib/utils/formatters';
import { toPlainDate, toISODate } from '@/lib/utils/dateTimeUtils';

export interface ExpiringCreditsNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  companyId?: string; // Optional: process only a specific company
}

/**
 * Job handler for sending notifications about credits that will expire soon
 * This job:
 * 1. Finds credits that will expire within the configured notification thresholds
 * 2. Groups them by company and expiration date
 * 3. Sends notifications to company contacts
 * 
 * @param data Job data containing tenant ID and optional company ID
 */
export async function expiringCreditsNotificationHandler(data: ExpiringCreditsNotificationJobData): Promise<void> {
  const { tenantId, companyId } = data;
  
  if (!tenantId) {
    throw new Error('Tenant ID is required for expiring credits notification job');
  }
  
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  
  console.log(`Processing expiring credits notifications for tenant ${tenant}${companyId ? ` and company ${companyId}` : ''}`);
  
  try {
    // Get notification thresholds from settings
    const defaultSettings = await knex('default_billing_settings')
      .where({ tenant })
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
      await processNotificationsForThreshold(knex, tenant, daysBeforeExpiration, companyId);
    }
    
  } catch (error: any) {
    console.error(`Error processing expiring credits notifications: ${error.message}`, error);
    throw error; // Re-throw to let pg-boss handle the failure
  }
}

/**
 * Process notifications for a specific threshold (days before expiration)
 */
async function processNotificationsForThreshold(
  knex: Knex,
  tenant: string,
  daysBeforeExpiration: number,
  companyId?: string
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
  
  // Add company filter if provided
  if (companyId) {
    query = query.where('company_id', companyId);
  }
  
  const expiringCredits: ICreditTracking[] = await query;
  
  if (!expiringCredits.length) {
    console.log(`No credits expiring in ${daysBeforeExpiration} days`);
    return;
  }
  
  console.log(`Found ${expiringCredits.length} credits expiring in ${daysBeforeExpiration} days`);
  
  // Group credits by company
  const creditsByCompany: Record<string, ICreditTracking[]> = {};
  
  for (const credit of expiringCredits) {
    if (!creditsByCompany[credit.company_id]) {
      creditsByCompany[credit.company_id] = [];
    }
    creditsByCompany[credit.company_id].push(credit);
  }
  
  // Process each company
  for (const [companyId, credits] of Object.entries(creditsByCompany)) {
    await sendCompanyNotification(knex, tenant, companyId, credits, daysBeforeExpiration);
  }
}

/**
 * Send notification for a specific company's expiring credits
 */
async function sendCompanyNotification(
  knex: Knex,
  tenant: string,
  companyId: string,
  credits: ICreditTracking[],
  daysBeforeExpiration: number
): Promise<void> {
  try {
    // Get company details
    const company = await knex('companies')
      .where({ company_id: companyId, tenant })
      .first();
      
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }
    
    // Get company billing contacts
    const contacts = await knex('company_contacts')
      .where({ company_id: companyId, tenant })
      .where('is_billing_contact', true)
      .select('user_id', 'email');
      
    if (!contacts.length) {
      console.log(`No billing contacts found for company ${companyId}, skipping notification`);
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
      company: {
        id: company.company_id,
        name: company.name
      },
      credits: {
        totalAmount: formatCurrency(totalAmount),
        expirationDate: formatDate(credits[0].expiration_date),
        daysRemaining: daysBeforeExpiration,
        items: creditItems,
        url: `${process.env.APP_URL}/billing/credits?company=${companyId}`
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
      
      console.log(`Sent credit expiration notification to ${contact.email} for company ${company.name}`);
    }
    
  } catch (error: any) {
    console.error(`Error sending company notification for ${companyId}: ${error.message}`);
    throw error;
  }
}