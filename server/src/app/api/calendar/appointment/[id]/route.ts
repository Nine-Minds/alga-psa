import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { generateICS, type ICSEventData } from '@alga-psa/scheduling';

/**
 * GET /api/calendar/appointment/[id].ics
 * Generate and download an ICS file for an approved appointment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scheduleEntryId = params.id.replace('.ics', '');

    if (!scheduleEntryId) {
      return NextResponse.json(
        { error: 'Schedule entry ID is required' },
        { status: 400 }
      );
    }

    const { knex: db } = await createTenantKnex();

    const scheduleEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get schedule entry with appointment request details
      const entry = await tenantDb(trx, '__appointment_ics_entry_discovery__')
        .unscoped('schedule_entries', 'tenant discovery for public appointment ICS by schedule entry id')
        .where({ entry_id: scheduleEntryId })
        .first();

      if (!entry) {
        return null;
      }

      const scopedDb = tenantDb(trx, entry.tenant);

      // Get appointment request details if this is an appointment
      let appointmentRequest: any = null;
      if (entry.work_item_type === 'appointment_request' && entry.work_item_id) {
        appointmentRequest = await scopedDb.table('appointment_requests')
          .where({ appointment_request_id: entry.work_item_id })
          .first();
      }

      // Get service details
      let service: any = null;
      if (appointmentRequest?.service_id) {
        service = await scopedDb.table('service_catalog')
          .where({ service_id: appointmentRequest.service_id })
          .first();
      }

      // Get assigned user (technician)
      const assigneeQuery = scopedDb.table('schedule_entry_assignees')
        .where({ 'schedule_entry_assignees.entry_id': scheduleEntryId })
        .select('users.user_id', 'users.first_name', 'users.last_name', 'users.email');
      scopedDb.tenantJoin(assigneeQuery, 'users', 'schedule_entry_assignees.user_id', 'users.user_id');
      const assignee = await assigneeQuery.first();

      // Get client/contact info
      let contact: any = null;
      if (appointmentRequest?.contact_id) {
        contact = await scopedDb.table('contacts')
          .where({ contact_name_id: appointmentRequest.contact_id })
          .first();
      }

      // Get tenant settings for company name
      const tenantSettings = await scopedDb.table('tenant_settings')
        .first();

      return {
        entry,
        appointmentRequest,
        service,
        assignee,
        contact,
        tenantSettings
      };
    });

    if (!scheduleEntry || !scheduleEntry.entry) {
      return NextResponse.json(
        { error: 'Schedule entry not found' },
        { status: 404 }
      );
    }

    const { entry, appointmentRequest, service, assignee, contact, tenantSettings } = scheduleEntry;

    // Prepare ICS event data
    const companyName = tenantSettings?.settings?.companyName || 'Your MSP';
    const supportEmail = tenantSettings?.settings?.supportEmail || tenantSettings?.settings?.contactEmail || 'support@company.com';

    const eventData: ICSEventData = {
      uid: entry.entry_id,
      title: entry.title || 'Appointment',
      description: entry.notes || appointmentRequest?.description || '',
      location: `${companyName} - Service Appointment`,
      startDate: new Date(entry.scheduled_start),
      endDate: new Date(entry.scheduled_end),
      organizerName: assignee ? `${assignee.first_name} ${assignee.last_name}` : companyName,
      organizerEmail: assignee?.email || supportEmail,
      attendeeName: contact?.full_name || appointmentRequest?.requester_name || '',
      attendeeEmail: contact?.email || appointmentRequest?.requester_email || '',
      url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/client-portal/appointments/${appointmentRequest?.appointment_request_id || ''}`
    };

    const icsContent = generateICS(eventData);

    // Return ICS file with proper headers
    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="appointment-${scheduleEntryId.substring(0, 8)}.ics"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[ICS Generation] Error generating ICS file:', error);
    return NextResponse.json(
      { error: 'Failed to generate calendar file' },
      { status: 500 }
    );
  }
}
