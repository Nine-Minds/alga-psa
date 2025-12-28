/**
 * Add Polish translations for internal notification templates
 */

const POLISH_TEMPLATES = {
  'ticket-assigned': {
    title: 'Zgłoszenie przypisane',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało do Ciebie przypisane'
  },
  'ticket-created': {
    title: 'Nowe zgłoszenie utworzone',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało utworzone dla {{clientName}}'
  },
  'ticket-updated': {
    title: 'Zgłoszenie zaktualizowane',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało zaktualizowane'
  },
  'ticket-closed': {
    title: 'Zgłoszenie zamknięte',
    message: 'Zgłoszenie #{{ticketId}} "{{ticketTitle}}" zostało zamknięte'
  },
  'ticket-comment-added': {
    title: 'Nowy komentarz',
    message: '{{authorName}} dodał(a) komentarz do zgłoszenia #{{ticketId}}'
  },
  'project-assigned': {
    title: 'Projekt przypisany',
    message: 'Projekt "{{projectName}}" został do Ciebie przypisany'
  },
  'project-created': {
    title: 'Nowy projekt utworzony',
    message: 'Projekt "{{projectName}}" został utworzony dla {{clientName}}'
  },
  'task-assigned': {
    title: 'Zadanie przypisane',
    message: 'Zadanie "{{taskName}}" w projekcie "{{projectName}}" zostało do Ciebie przypisane'
  },
  'task-comment-added': {
    title: 'Nowy komentarz do zadania',
    message: '{{authorName}} dodał(a) komentarz do zadania "{{taskName}}"'
  },
  'milestone-completed': {
    title: 'Kamień milowy ukończony',
    message: 'Kamień milowy "{{milestoneName}}" w projekcie "{{projectName}}" został ukończony'
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
  'system-announcement': {
    title: 'Ogłoszenie systemowe',
    message: '{{announcementTitle}}'
  },
  'user-mentioned': {
    title: 'Wspomniano o Tobie',
    message: '{{authorName}} wspomniał(a) o Tobie w {{entityType}} {{entityName}}'
  },
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
  }
};

exports.up = async function(knex) {
  console.log('Adding Polish internal notification templates...');

  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id as id', 'name');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  const templateRows = Object.entries(POLISH_TEMPLATES).map(([name, translation]) => ({
    name,
    language_code: 'pl',
    title: translation.title,
    message: translation.message,
    subtype_id: getSubtypeId(name)
  }));

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

  console.log('✓ Polish internal notification templates added');
};

exports.down = async function(knex) {
  await knex('internal_notification_templates')
    .where({ language_code: 'pl' })
    .whereIn('name', Object.keys(POLISH_TEMPLATES))
    .del();
};
