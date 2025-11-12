/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  console.log('Seeding internal notification categories, subtypes, and templates for dev...');

  const categories = await knex('internal_notification_categories')
    .insert([
      {
        name: 'tickets',
        description: 'Ticket-related notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'projects',
        description: 'Project-related notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'invoices',
        description: 'Invoice and billing notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'system',
        description: 'System and administrative notifications',
        is_enabled: true,
        is_default_enabled: true
      }
    ])
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled')
    })
    .returning('*');

  const getCategoryId = (name) => {
    const category = categories.find(c => c.name === name);
    if (!category) {
      throw new Error(`Internal notification category '${name}' not found`);
    }
    return category.internal_notification_category_id;
  };

  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      {
        internal_category_id: getCategoryId('tickets'),
        name: 'ticket-assigned',
        description: 'Ticket assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('tickets'),
        name: 'ticket-created',
        description: 'New ticket created',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('tickets'),
        name: 'ticket-updated',
        description: 'Ticket updated',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('tickets'),
        name: 'ticket-closed',
        description: 'Ticket closed',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('tickets'),
        name: 'ticket-comment-added',
        description: 'Comment added to ticket',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('projects'),
        name: 'project-assigned',
        description: 'Project assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('projects'),
        name: 'project-created',
        description: 'New project created',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('projects'),
        name: 'task-assigned',
        description: 'Task assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('projects'),
        name: 'milestone-completed',
        description: 'Project milestone completed',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('invoices'),
        name: 'invoice-generated',
        description: 'New invoice generated',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('invoices'),
        name: 'payment-received',
        description: 'Payment received for invoice',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('invoices'),
        name: 'payment-overdue',
        description: 'Payment is overdue',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('system'),
        name: 'system-announcement',
        description: 'System announcement',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: getCategoryId('system'),
        name: 'user-mentioned',
        description: 'User mentioned in comment or note',
        is_enabled: true,
        is_default_enabled: true
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled')
    })
    .returning('*');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.internal_notification_subtype_id;
  };

  const templates = {
    'ticket-assigned': {
      en: {
        title: 'Ticket Assigned',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been assigned to you'
      },
      fr: {
        title: 'Ticket attribué',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" vous a été attribué'
      },
      es: {
        title: 'Ticket asignado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se le ha asignado'
      },
      de: {
        title: 'Ticket zugewiesen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde Ihnen zugewiesen'
      },
      nl: {
        title: 'Ticket toegewezen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is aan u toegewezen'
      },
      it: {
        title: 'Ticket assegnato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" le è stato assegnato'
      }
    },
    'ticket-created': {
      en: {
        title: 'New Ticket Created',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" was created for {{clientName}}'
      },
      fr: {
        title: 'Nouveau ticket créé',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été créé pour {{clientName}}'
      },
      es: {
        title: 'Nuevo ticket creado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se creó para {{clientName}}'
      },
      de: {
        title: 'Neues Ticket erstellt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde für {{clientName}} erstellt'
      },
      nl: {
        title: 'Nieuw ticket aangemaakt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is aangemaakt voor {{clientName}}'
      },
      it: {
        title: 'Nuovo ticket creato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato creato per {{clientName}}'
      }
    },
    'ticket-updated': {
      en: {
        title: 'Ticket Updated',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been updated'
      },
      fr: {
        title: 'Ticket mis à jour',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été mis à jour'
      },
      es: {
        title: 'Ticket actualizado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha actualizado'
      },
      de: {
        title: 'Ticket aktualisiert',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde aktualisiert'
      },
      nl: {
        title: 'Ticket bijgewerkt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is bijgewerkt'
      },
      it: {
        title: 'Ticket aggiornato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato aggiornato'
      }
    },
    'ticket-closed': {
      en: {
        title: 'Ticket Closed',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been closed'
      },
      fr: {
        title: 'Ticket fermé',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été fermé'
      },
      es: {
        title: 'Ticket cerrado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha cerrado'
      },
      de: {
        title: 'Ticket geschlossen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde geschlossen'
      },
      nl: {
        title: 'Ticket gesloten',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is gesloten'
      },
      it: {
        title: 'Ticket chiuso',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato chiuso'
      }
    },
    'ticket-comment-added': {
      en: {
        title: 'New Comment',
        message: '{{authorName}} added a comment to ticket #{{ticketId}}'
      },
      fr: {
        title: 'Nouveau commentaire',
        message: '{{authorName}} a ajouté un commentaire au ticket #{{ticketId}}'
      },
      es: {
        title: 'Nuevo comentario',
        message: '{{authorName}} agregó un comentario al ticket #{{ticketId}}'
      },
      de: {
        title: 'Neuer Kommentar',
        message: '{{authorName}} hat einen Kommentar zum Ticket #{{ticketId}} hinzugefügt'
      },
      nl: {
        title: 'Nieuwe opmerking',
        message: '{{authorName}} heeft een opmerking toegevoegd aan ticket #{{ticketId}}'
      },
      it: {
        title: 'Nuovo commento',
        message: '{{authorName}} ha aggiunto un commento al ticket #{{ticketId}}'
      }
    },
    'project-assigned': {
      en: {
        title: 'Project Assigned',
        message: 'Project "{{projectName}}" has been assigned to you'
      },
      fr: {
        title: 'Projet attribué',
        message: 'Le projet "{{projectName}}" vous a été attribué'
      },
      es: {
        title: 'Proyecto asignado',
        message: 'El proyecto "{{projectName}}" se le ha asignado'
      },
      de: {
        title: 'Projekt zugewiesen',
        message: 'Projekt "{{projectName}}" wurde Ihnen zugewiesen'
      },
      nl: {
        title: 'Project toegewezen',
        message: 'Project "{{projectName}}" is aan u toegewezen'
      },
      it: {
        title: 'Progetto assegnato',
        message: 'Il progetto "{{projectName}}" le è stato assegnato'
      }
    },
    'project-created': {
      en: {
        title: 'New Project Created',
        message: 'Project "{{projectName}}" was created for {{clientName}}'
      },
      fr: {
        title: 'Nouveau projet créé',
        message: 'Le projet "{{projectName}}" a été créé pour {{clientName}}'
      },
      es: {
        title: 'Nuevo proyecto creado',
        message: 'El proyecto "{{projectName}}" se creó para {{clientName}}'
      },
      de: {
        title: 'Neues Projekt erstellt',
        message: 'Projekt "{{projectName}}" wurde für {{clientName}} erstellt'
      },
      nl: {
        title: 'Nieuw project aangemaakt',
        message: 'Project "{{projectName}}" is aangemaakt voor {{clientName}}'
      },
      it: {
        title: 'Nuovo progetto creato',
        message: 'Il progetto "{{projectName}}" è stato creato per {{clientName}}'
      }
    },
    'task-assigned': {
      en: {
        title: 'Task Assigned',
        message: 'Task "{{taskName}}" in project "{{projectName}}" has been assigned to you'
      },
      fr: {
        title: 'Tâche attribuée',
        message: 'La tâche "{{taskName}}" du projet "{{projectName}}" vous a été attribuée'
      },
      es: {
        title: 'Tarea asignada',
        message: 'La tarea "{{taskName}}" del proyecto "{{projectName}}" se le ha asignado'
      },
      de: {
        title: 'Aufgabe zugewiesen',
        message: 'Die Aufgabe "{{taskName}}" im Projekt "{{projectName}}" wurde Ihnen zugewiesen'
      },
      nl: {
        title: 'Taak toegewezen',
        message: 'De taak "{{taskName}}" in project "{{projectName}}" is aan u toegewezen'
      },
      it: {
        title: 'Attività assegnata',
        message: 'L\'attività "{{taskName}}" del progetto "{{projectName}}" le è stata assegnata'
      }
    },
    'milestone-completed': {
      en: {
        title: 'Milestone Completed',
        message: 'Milestone "{{milestoneName}}" in project "{{projectName}}" has been completed'
      },
      fr: {
        title: 'Jalon terminé',
        message: 'Le jalon "{{milestoneName}}" du projet "{{projectName}}" est terminé'
      },
      es: {
        title: 'Hito completado',
        message: 'El hito "{{milestoneName}}" del proyecto "{{projectName}}" se ha completado'
      },
      de: {
        title: 'Meilenstein abgeschlossen',
        message: 'Der Meilenstein "{{milestoneName}}" im Projekt "{{projectName}}" wurde abgeschlossen'
      },
      nl: {
        title: 'Mijlpaal voltooid',
        message: 'De mijlpaal "{{milestoneName}}" in project "{{projectName}}" is voltooid'
      },
      it: {
        title: 'Traguardo completato',
        message: 'La milestone "{{milestoneName}}" del progetto "{{projectName}}" è stata completata'
      }
    },
    'invoice-generated': {
      en: {
        title: 'New Invoice Generated',
        message: 'Invoice #{{invoiceNumber}} for {{clientName}} has been generated'
      },
      fr: {
        title: 'Facture générée',
        message: 'La facture #{{invoiceNumber}} pour {{clientName}} a été générée'
      },
      es: {
        title: 'Factura generada',
        message: 'La factura #{{invoiceNumber}} para {{clientName}} se ha generado'
      },
      de: {
        title: 'Rechnung erstellt',
        message: 'Rechnung #{{invoiceNumber}} für {{clientName}} wurde erstellt'
      },
      nl: {
        title: 'Factuur aangemaakt',
        message: 'Factuur #{{invoiceNumber}} voor {{clientName}} is aangemaakt'
      },
      it: {
        title: 'Fattura generata',
        message: 'La fattura #{{invoiceNumber}} per {{clientName}} è stata generata'
      }
    },
    'payment-received': {
      en: {
        title: 'Payment Received',
        message: 'Payment of {{amount}} received for invoice #{{invoiceNumber}}'
      },
      fr: {
        title: 'Paiement reçu',
        message: 'Paiement de {{amount}} reçu pour la facture #{{invoiceNumber}}'
      },
      es: {
        title: 'Pago recibido',
        message: 'Pago de {{amount}} recibido para la factura #{{invoiceNumber}}'
      },
      de: {
        title: 'Zahlung eingegangen',
        message: 'Zahlung über {{amount}} für Rechnung #{{invoiceNumber}} ist eingegangen'
      },
      nl: {
        title: 'Betaling ontvangen',
        message: 'Betaling van {{amount}} voor factuur #{{invoiceNumber}} is ontvangen'
      },
      it: {
        title: 'Pagamento ricevuto',
        message: 'Pagamento di {{amount}} ricevuto per la fattura #{{invoiceNumber}}'
      }
    },
    'payment-overdue': {
      en: {
        title: 'Payment Overdue',
        message: 'Invoice #{{invoiceNumber}} is {{daysOverdue}} days overdue'
      },
      fr: {
        title: 'Paiement en retard',
        message: 'La facture #{{invoiceNumber}} est en retard de {{daysOverdue}} jours'
      },
      es: {
        title: 'Pago vencido',
        message: 'La factura #{{invoiceNumber}} tiene {{daysOverdue}} días de atraso'
      },
      de: {
        title: 'Zahlung überfällig',
        message: 'Rechnung #{{invoiceNumber}} ist seit {{daysOverdue}} Tagen überfällig'
      },
      nl: {
        title: 'Betaling te laat',
        message: 'Factuur #{{invoiceNumber}} is {{daysOverdue}} dagen te laat'
      },
      it: {
        title: 'Pagamento in ritardo',
        message: 'La fattura #{{invoiceNumber}} è in ritardo di {{daysOverdue}} giorni'
      }
    },
    'system-announcement': {
      en: {
        title: 'System Announcement',
        message: '{{announcementTitle}}'
      },
      fr: {
        title: 'Annonce système',
        message: '{{announcementTitle}}'
      },
      es: {
        title: 'Anuncio del sistema',
        message: '{{announcementTitle}}'
      },
      de: {
        title: 'Systemankündigung',
        message: '{{announcementTitle}}'
      },
      nl: {
        title: 'Systeemmededeling',
        message: '{{announcementTitle}}'
      },
      it: {
        title: 'Annuncio di sistema',
        message: '{{announcementTitle}}'
      }
    },
    'user-mentioned': {
      en: {
        title: 'You were mentioned',
        message: '{{authorName}} mentioned you in {{entityType}} {{entityName}}'
      },
      fr: {
        title: 'Vous avez été mentionné',
        message: '{{authorName}} vous a mentionné dans {{entityType}} {{entityName}}'
      },
      es: {
        title: 'Ha sido mencionado',
        message: '{{authorName}} le mencionó en {{entityType}} {{entityName}}'
      },
      de: {
        title: 'Sie wurden erwähnt',
        message: '{{authorName}} hat Sie in {{entityType}} {{entityName}} erwähnt'
      },
      nl: {
        title: 'U bent genoemd',
        message: '{{authorName}} heeft u genoemd in {{entityType}} {{entityName}}'
      },
      it: {
        title: 'È stato menzionato',
        message: '{{authorName}} l\'ha menzionato in {{entityType}} {{entityName}}'
      }
    }
  };

  const languageCodes = ['en', 'fr', 'es', 'de', 'nl', 'it'];
  const templateRows = [];

  for (const [name, translations] of Object.entries(templates)) {
    const subtypeId = getSubtypeId(name);
    for (const code of languageCodes) {
      const translation = translations[code];
      if (!translation) {
        continue;
      }

      templateRows.push({
        name,
        language_code: code,
        title: translation.title,
        message: translation.message,
        subtype_id: subtypeId
      });
    }
  }

  if (templateRows.length === 0) {
    console.warn('No internal notification template rows prepared; skipping insert.');
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

  console.log('✓ Internal notification templates seeded for dev');
};
