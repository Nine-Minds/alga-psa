/**
 * Add Polish translations for internal notification templates
 *
 * This migration adds Polish (pl) translations for all internal notification templates
 * to match the templates available in other languages (en, fr, es, de, nl, it).
 */

const POLISH_TEMPLATES = {
  // Ticket notifications (matching 20251031160002 structure)
  'ticket-assigned': {
    title: 'Zgłoszenie przypisane',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" ({{priority}}) zostało do Ciebie przypisane przez {{performedByName}}'
  },
  'ticket-created-client': {
    title: 'Twoje zgłoszenie zostało utworzone',
    message: 'Twoje zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało utworzone i nasz zespół wkrótce odpowie'
  },
  'ticket-updated-client': {
    title: 'Twoje zgłoszenie zostało zaktualizowane',
    message: 'Twoje zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało zaktualizowane'
  },
  'ticket-closed-client': {
    title: 'Twoje zgłoszenie zostało zamknięte',
    message: 'Twoje zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało zamknięte'
  },
  'ticket-comment-added-client': {
    title: 'Nowy komentarz do Twojego zgłoszenia',
    message: '{{authorName}} skomentował(a) Twoje zgłoszenie #{{ticketId}}: "{{commentPreview}}"'
  },
  'message-sent': {
    title: 'Nowa wiadomość',
    message: '{{senderName}}: {{messagePreview}}'
  },
  'invoice-generated': {
    title: 'Nowa faktura utworzona',
    message: 'Faktura #{{invoiceNumber}} dla {{clientName}} została utworzona'
  },
  'payment-received': {
    title: 'Otrzymano płatność',
    message: 'Otrzymano płatność {{amount}} za fakturę #{{invoiceNumber}}'
  },
  'payment-overdue': {
    title: 'Płatność po terminie',
    message: 'Faktura #{{invoiceNumber}} jest przeterminowana o {{daysOverdue}} dni'
  },
  'user-mentioned-in-comment': {
    title: 'Wspomniano o Tobie w komentarzu',
    message: '{{commentAuthor}} wspomniał(a) o Tobie w zgłoszeniu #{{ticketNumber}}: {{commentPreview}}'
  },
  'user-mentioned-in-document': {
    title: 'Wspomniano o Tobie w dokumencie',
    message: '{{authorName}} wspomniał(a) o Tobie w dokumencie "{{documentName}}"'
  },
  'ticket-status-changed': {
    title: 'Zmieniono status zgłoszenia',
    message: 'Status zgłoszenia #{{ticketId}} "{{ticketTitle}}" zmieniony: {{oldStatus}} → {{newStatus}} przez {{performedByName}}'
  },
  'ticket-priority-changed': {
    title: 'Zmieniono priorytet zgłoszenia',
    message: 'Priorytet zgłoszenia #{{ticketId}} "{{ticketTitle}}" zmieniony: {{oldPriority}} → {{newPriority}} przez {{performedByName}}'
  },
  'ticket-reassigned': {
    title: 'Zgłoszenie przypisane ponownie',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" przypisane ponownie: {{oldAssignedTo}} → {{newAssignedTo}} przez {{performedByName}}'
  },

  // Appointment notifications
  'appointment-request-created-client': {
    title: 'Wniosek o wizytę wysłany',
    message: 'Twój wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}} został wysłany i oczekuje na zatwierdzenie.'
  },
  'appointment-request-created-staff': {
    title: 'Nowy wniosek o wizytę od {{clientName}}',
    message: '{{requesterName}} poprosił(a) o wizytę na {{serviceName}} w dniu {{requestedDate}} o {{requestedTime}}.'
  },
  'appointment-request-approved': {
    title: 'Wizyta potwierdzona!',
    message: 'Twoja wizyta na {{serviceName}} w dniu {{appointmentDate}} o {{appointmentTime}} została potwierdzona. Przypisany technik: {{technicianName}}.'
  },
  'appointment-request-declined': {
    title: 'Aktualizacja wniosku o wizytę',
    message: 'Nie udało się zrealizować wniosku o wizytę na {{serviceName}}. {{declineReason}}'
  },
  'appointment-request-cancelled-client': {
    title: 'Wniosek o wizytę anulowany',
    message: 'Twój wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}} został pomyślnie anulowany.'
  },
  'appointment-request-cancelled-staff': {
    title: 'Wniosek o wizytę anulowany',
    message: '{{requesterName}} anulował(a) wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}}.'
  },

  // Additional agent notifications (matching 20251115120001)
  'ticket-additional-agent-assigned': {
    title: 'Dodano jako dodatkowego agenta',
    message: 'Zostałeś(aś) dodany(a) jako dodatkowy agent do zgłoszenia #{{ticketId}} "{{ticketTitle}}" ({{priority}})'
  },
  'ticket-additional-agent-added': {
    title: 'Dodano dodatkowego agenta',
    message: '{{additionalAgentName}} został(a) dodany(a) jako dodatkowy agent do Twojego zgłoszenia #{{ticketId}} "{{ticketTitle}}"'
  },
  'ticket-additional-agent-added-client': {
    title: 'Przypisano dodatkowego agenta wsparcia',
    message: '{{additionalAgentName}} został(a) dodany(a) do pomocy przy Twoim zgłoszeniu #{{ticketId}} "{{ticketTitle}}"'
  },
  'task-additional-agent-assigned': {
    title: 'Dodano jako dodatkowego agenta',
    message: 'Zostałeś(aś) dodany(a) jako dodatkowy agent do zadania "{{taskName}}" w projekcie "{{projectName}}"'
  },
  'task-additional-agent-added': {
    title: 'Dodano dodatkowego agenta',
    message: '{{additionalAgentName}} został(a) dodany(a) jako dodatkowy agent do Twojego zadania "{{taskName}}" w projekcie "{{projectName}}"'
  }
};

// Map template names to their corresponding subtype names
const TEMPLATE_TO_SUBTYPE = {
  'ticket-created-client': 'ticket-created',
  'ticket-updated-client': 'ticket-updated',
  'ticket-closed-client': 'ticket-closed',
  'ticket-comment-added-client': 'ticket-comment-added',
  'message-sent': 'message-sent',
  'user-mentioned-in-comment': 'user-mentioned',
  'user-mentioned-in-document': 'user-mentioned',
  'ticket-additional-agent-added-client': 'ticket-additional-agent-added',
  'appointment-request-created-client': 'appointment-request-created',
  'appointment-request-created-staff': 'appointment-request-created',
  'appointment-request-cancelled-client': 'appointment-request-cancelled',
  'appointment-request-cancelled-staff': 'appointment-request-cancelled'
};

exports.up = async function(knex) {
  console.log('Adding Polish internal notification templates...');

  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id as id', 'name');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      console.warn(`Internal notification subtype '${name}' not found, skipping template`);
      return null;
    }
    return subtype.id;
  };

  const templateRows = [];

  for (const [templateName, translation] of Object.entries(POLISH_TEMPLATES)) {
    // Map template name to subtype name (e.g., 'ticket-created-client' -> 'ticket-created')
    const subtypeName = TEMPLATE_TO_SUBTYPE[templateName] || templateName;
    const subtypeId = getSubtypeId(subtypeName);

    if (!subtypeId) {
      continue;
    }

    templateRows.push({
      name: templateName,
      language_code: 'pl',
      title: translation.title,
      message: translation.message,
      subtype_id: subtypeId
    });
  }

  if (templateRows.length === 0) {
    console.warn('No Polish internal notification templates prepared; skipping insert.');
    return;
  }

  await knex('internal_notification_templates')
    .insert(templateRows)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id')
    });

  console.log(`✓ Polish internal notification templates added (${templateRows.length} templates)`);
};

exports.down = async function(knex) {
  await knex('internal_notification_templates')
    .where({ language_code: 'pl' })
    .whereIn('name', Object.keys(POLISH_TEMPLATES))
    .del();

  console.log('Polish internal notification templates removed');
};
