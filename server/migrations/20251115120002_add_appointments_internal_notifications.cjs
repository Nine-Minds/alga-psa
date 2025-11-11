/**
 * Migration: Add Appointments category to internal notifications
 *
 * Creates:
 * - Appointments notification category
 * - Subtypes for appointment events
 * - Notification templates in English (with placeholders for other languages)
 */

exports.up = async function(knex) {
  console.log('Adding appointments internal notification category...');

  // 1. Insert Appointments category
  const [appointmentsCategory] = await knex('internal_notification_categories')
    .insert([
      {
        name: 'appointments',
        description: 'Appointment request and scheduling notifications',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true  // Available for both MSP and client portal
      }
    ])
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  const categoryId = appointmentsCategory.internal_notification_category_id;

  // 2. Insert subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      {
        internal_category_id: categoryId,
        name: 'appointment-request-created',
        description: 'New appointment request submitted',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-approved',
        description: 'Appointment request approved',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-declined',
        description: 'Appointment request declined',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-cancelled',
        description: 'Appointment request cancelled',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  // Get subtype IDs
  const requestCreatedSubtype = subtypes.find(s => s.name === 'appointment-request-created');
  const requestApprovedSubtype = subtypes.find(s => s.name === 'appointment-request-approved');
  const requestDeclinedSubtype = subtypes.find(s => s.name === 'appointment-request-declined');
  const requestCancelledSubtype = subtypes.find(s => s.name === 'appointment-request-cancelled');

  // 3. Insert English templates
  await knex('internal_notification_templates')
    .insert([
      // appointment-request-created-client (for the client who created the request)
      {
        name: 'appointment-request-created-client',
        language_code: 'en',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Submitted',
        message: 'Your appointment request for {{serviceName}} on {{requestedDate}} has been submitted and is pending approval.'
      },
      // appointment-request-created-staff (for MSP staff)
      {
        name: 'appointment-request-created-staff',
        language_code: 'en',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'New Appointment Request from {{clientName}}',
        message: '{{requesterName}} has requested an appointment for {{serviceName}} on {{requestedDate}} at {{requestedTime}}.'
      },
      // appointment-request-approved (for client)
      {
        name: 'appointment-request-approved',
        language_code: 'en',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Appointment Confirmed!',
        message: 'Your appointment for {{serviceName}} on {{appointmentDate}} at {{appointmentTime}} has been confirmed. Assigned technician: {{technicianName}}.'
      },
      // appointment-request-declined (for client)
      {
        name: 'appointment-request-declined',
        language_code: 'en',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Update',
        message: 'Your appointment request for {{serviceName}} could not be accommodated. {{declineReason}}'
      },
      // appointment-request-cancelled (for MSP staff)
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'en',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Cancelled',
        message: '{{requesterName}} has cancelled their appointment request for {{serviceName}} on {{requestedDate}}.'
      }
    ])
    .onConflict(['name', 'language_code'])
    .ignore();

  console.log('Appointments internal notification category created successfully');
};

exports.down = async function(knex) {
  console.log('Removing appointments internal notification category...');

  // Get the category ID
  const category = await knex('internal_notification_categories')
    .where({ name: 'appointments' })
    .first();

  if (!category) {
    console.log('Appointments category not found, nothing to remove');
    return;
  }

  const categoryId = category.internal_notification_category_id;

  // Get subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .where({ internal_category_id: categoryId })
    .select('internal_notification_subtype_id');

  const subtypeIds = subtypes.map(s => s.internal_notification_subtype_id);

  if (subtypeIds.length > 0) {
    // Delete templates associated with these subtypes
    await knex('internal_notification_templates')
      .whereIn('subtype_id', subtypeIds)
      .delete();

    // Delete subtypes
    await knex('internal_notification_subtypes')
      .whereIn('internal_notification_subtype_id', subtypeIds)
      .delete();
  }

  // Delete category
  await knex('internal_notification_categories')
    .where({ internal_notification_category_id: categoryId })
    .delete();

  console.log('Appointments internal notification category removed successfully');
};
