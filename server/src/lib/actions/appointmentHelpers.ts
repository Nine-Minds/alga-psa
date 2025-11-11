'use server';

import { createTenantKnex } from '../db';
import { withTransaction } from '@shared/db';
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
 * Users with 'schedule' 'update' permission
 */
export async function getScheduleApprovers(
  tenant: string
): Promise<ScheduleApprover[]> {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    // Get users with schedule update permission
    // This queries users who have roles with the schedule:update permission
    const approvers = await trx('users as u')
      .join('user_roles as ur', function() {
        this.on('u.user_id', 'ur.user_id')
          .andOn('u.tenant', 'ur.tenant');
      })
      .join('roles as r', function() {
        this.on('ur.role_id', 'r.role_id')
          .andOn('ur.tenant', 'r.tenant');
      })
      .join('role_permissions as rp', function() {
        this.on('r.role_id', 'rp.role_id')
          .andOn('r.tenant', 'rp.tenant');
      })
      .join('permissions as p', function() {
        this.on('rp.permission_id', 'p.permission_id')
          .andOn('rp.tenant', 'p.tenant');
      })
      .where({
        'u.tenant': tenant,
        'u.user_type': 'internal',
        'p.resource': 'schedule',
        'p.action': 'update'
      })
      .whereNull('u.is_inactive')
      .select(
        'u.user_id',
        'u.email',
        'u.first_name',
        'u.last_name'
      )
      .distinct();

    return approvers;
  });
}

/**
 * Get tenant settings including contact information and company name
 */
export async function getTenantSettings(
  tenant: string
): Promise<TenantSettings> {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    // Get tenant settings from tenant_settings table
    const settings = await trx('tenant_settings')
      .where({ tenant })
      .first();

    // Extract settings from JSONB column or use defaults
    const tenantSettings = settings?.settings || {};

    // Get company information from companies table (MSP company)
    const mspCompany = await trx('companies')
      .where({
        tenant,
        is_msp: true
      })
      .first();

    return {
      contactEmail: tenantSettings.supportEmail || tenantSettings.contactEmail || 'support@company.com',
      contactPhone: tenantSettings.supportPhone || tenantSettings.contactPhone || '',
      tenantName: mspCompany?.company_name || tenantSettings.companyName || 'Your MSP',
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
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    const user = await trx('users')
      .where({
        tenant,
        contact_id: contactId,
        user_type: 'client'
      })
      .whereNull('is_inactive')
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
    const date = new Date(dateString);

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

    // Create a date object for today with the specified time
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

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
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    const company = await trx('companies')
      .where({
        company_id: clientId,
        tenant
      })
      .select('company_name')
      .first();

    return company?.company_name || 'Unknown Client';
  });
}
