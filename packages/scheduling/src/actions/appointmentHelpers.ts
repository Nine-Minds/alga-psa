'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { format, type Locale } from 'date-fns';
import { de, es, fr, it, nl, enUS } from 'date-fns/locale';

/**
 * Helper functions for appointment request notifications and data processing
 */

export interface TenantSettings {
  contactEmail: string;
  contactPhone: string;
  tenantName: string;
  defaultLocale: string;
}

export interface ScheduleApprover {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
}

/**
 * Get list of MSP users who can approve appointment requests
 * Users with 'user_schedule' 'update' permission
 */
export async function getScheduleApprovers(
  tenant: string
): Promise<ScheduleApprover[]> {
  const { knex: db } = await createTenantKnex(tenant);

  return await withTransaction(db, async (trx) => {
    const scopedDb = tenantDb(trx, tenant) as any;
    // Get users with schedule update permission
    // This queries users who have roles with the schedule:update permission
    const approversQuery = scopedDb.table('users as u')
      .where({
        'u.user_type': 'internal',
        'p.resource': 'user_schedule',
        'p.action': 'update'
      })
      .where(function(this: any) {
        this.where('u.is_inactive', false)
          .orWhereNull('u.is_inactive');
      })
      .select(
        'u.user_id',
        'u.email',
        'u.first_name',
        'u.last_name'
      )
      .distinct();
    scopedDb.tenantJoin(approversQuery, 'user_roles as ur', 'u.user_id', 'ur.user_id');
    scopedDb.tenantJoin(approversQuery, 'roles as r', 'ur.role_id', 'r.role_id');
    scopedDb.tenantJoin(approversQuery, 'role_permissions as rp', 'r.role_id', 'rp.role_id');
    scopedDb.tenantJoin(approversQuery, 'permissions as p', 'rp.permission_id', 'p.permission_id');
    const approvers = await approversQuery;

    return approvers;
  });
}

/**
 * Get tenant settings including contact information and company name
 */
export async function getTenantSettings(
  tenant: string
): Promise<TenantSettings> {
  const { knex: db } = await createTenantKnex(tenant);

  return await withTransaction(db, async (trx) => {
    const scopedDb = tenantDb(trx, tenant) as any;
    // Get tenant settings from tenant_settings table
    const settings = await scopedDb.table('tenant_settings')
      .where({ tenant })
      .first();

    // Extract settings from JSONB column or use defaults
    const tenantSettings = settings?.settings || {};

    // Get MSP company name - check multiple sources in order of preference:
    // 1. branding.clientName from tenant_settings (configured by user)
    // 2. client_name from tenants table (set during tenant creation)
    // 3. Fall back to a generic name (never show raw tenant ID)
    let tenantName = tenantSettings.branding?.clientName;

    if (!tenantName) {
      // Try to get tenant name from tenants table
      const tenantRecord = await scopedDb.table('tenants')
        .where({ tenant })
        .select('client_name')
        .first();
      tenantName = tenantRecord?.client_name;
    }

    // If still no name, use a generic placeholder instead of tenant ID
    if (!tenantName) {
      tenantName = 'Your Service Provider';
    }

    return {
      contactEmail: tenantSettings.supportEmail || tenantSettings.contactEmail || 'support@company.com',
      contactPhone: tenantSettings.supportPhone || tenantSettings.contactPhone || '',
      tenantName: tenantName,
      defaultLocale: tenantSettings.defaultLocale || 'en'
    };
  });
}

/**
 * Get client portal user_id from contact_id
 * Used for sending internal notifications to client users
 */
export async function getClientUserIdFromContact(
  contactId: string,
  tenant: string
): Promise<string | null> {
  const { knex: db } = await createTenantKnex(tenant);

  return await withTransaction(db, async (trx) => {
    const user = await (tenantDb(trx, tenant) as any).table('users')
      .where({
        contact_id: contactId,
        user_type: 'client'
      })
      .where(function(this: any) {
        this.where('is_inactive', false)
          .orWhereNull('is_inactive');
      })
      .select('user_id')
      .first();

    return user?.user_id || null;
  });
}

/**
 * Format date for display based on locale
 * @param dateString - ISO date string (YYYY-MM-DD)
 * @param locale - Locale code (en, de, es, fr, it, nl)
 */
export async function formatDate(dateString: string, locale: string = 'en'): Promise<string> {
  try {
    // Parse date components to avoid UTC midnight day-shift.
    // Appointment dates are wall-clock values (e.g. "2025-11-15"), not UTC instants.
    // new Date("2025-11-15") parses as UTC midnight, which when formatted in a
    // server timezone west of UTC would show the previous day.
    const [yearStr, monthStr, dayStr] = dateString.split('-');
    const date = new Date(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10) - 1,
      parseInt(dayStr, 10)
    );

    // Map locale codes to date-fns locales
    const localeMap: Record<string, Locale> = {
      en: enUS,
      de: de,
      es: es,
      fr: fr,
      it: it,
      nl: nl
    };

    const dateFnsLocale = localeMap[locale] || enUS;

    // Format: "November 15, 2025" or "15 novembre 2025" etc.
    return format(date, 'PPP', { locale: dateFnsLocale });
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString;
  }
}

/**
 * Format time for display based on locale
 * @param timeString - Time string in HH:MM format
 * @param locale - Locale code (en, de, es, fr, it, nl)
 */
export async function formatTime(timeString: string, locale: string = 'en'): Promise<string> {
  try {
    // Parse time string (HH:MM)
    const [hours, minutes] = timeString.split(':').map(Number);

    // Use a fixed date (Jan 15, 2000) to avoid DST edge cases on the current day.
    // Appointment times are wall-clock values, not UTC instants.
    const date = new Date(2000, 0, 15, hours, minutes, 0, 0);

    // Map locale codes to date-fns locales
    const localeMap: Record<string, Locale> = {
      en: enUS,
      de: de,
      es: es,
      fr: fr,
      it: it,
      nl: nl
    };

    const dateFnsLocale = localeMap[locale] || enUS;

    // Format time based on locale
    // English uses 12-hour format, others typically use 24-hour
    if (locale === 'en') {
      return format(date, 'p', { locale: dateFnsLocale }); // "2:00 PM"
    } else {
      return format(date, 'HH:mm', { locale: dateFnsLocale }); // "14:00"
    }
  } catch (error) {
    console.error('Error formatting time:', error);
    return timeString;
  }
}

/**
 * Generate ICS calendar file link for appointment
 * @param scheduleEntry - Schedule entry object
 */
export async function generateICSLink(
  scheduleEntry: {
    entry_id: string;
    scheduled_start: string;
    scheduled_end: string;
    title: string;
  }
): Promise<string> {
  // For now, return a link to an endpoint that will generate the ICS file
  // The actual ICS generation endpoint would need to be implemented
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/api/calendar/appointment/${scheduleEntry.entry_id}.ics`;
}

/**
 * Generate URL for requesting a new appointment from client portal
 */
export async function getRequestNewAppointmentLink(): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/client-portal/appointments`;
}

/**
 * Get company name for a client
 */
export async function getClientCompanyName(
  clientId: string,
  tenant: string
): Promise<string> {
  const { knex: db } = await createTenantKnex(tenant);

  return await withTransaction(db, async (trx) => {
    const client = await (tenantDb(trx, tenant) as any).table('clients')
      .where({
        client_id: clientId
      })
      .select('client_name')
      .first();

    return client?.client_name || 'Unknown Client';
  });
}
