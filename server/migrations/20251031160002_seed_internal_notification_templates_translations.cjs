/**
 * Seed translations for internal notification templates (fr, es, de, nl, it)
 */

exports.up = async function(knex) {
  console.log('Seeding internal notification template translations...');

  const targetLanguages = ['fr', 'es', 'de', 'nl', 'it'];

  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id as id', 'name');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  const translations = {
    fr: {
      'ticket-assigned': {
        title: 'Ticket attribué',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" vous a été attribué'
      },
      'ticket-created': {
        title: 'Nouveau ticket créé',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été créé pour {{clientName}}'
      },
      'ticket-updated': {
        title: 'Ticket mis à jour',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été mis à jour'
      },
      'ticket-closed': {
        title: 'Ticket fermé',
        message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a été fermé'
      },
      'ticket-comment-added': {
        title: 'Nouveau commentaire',
        message: '{{authorName}} a ajouté un commentaire au ticket #{{ticketId}}'
      },
      'project-assigned': {
        title: 'Projet attribué',
        message: 'Le projet "{{projectName}}" vous a été attribué'
      },
      'project-created': {
        title: 'Nouveau projet créé',
        message: 'Le projet "{{projectName}}" a été créé pour {{clientName}}'
      },
      'task-assigned': {
        title: 'Tâche attribuée',
        message: 'La tâche "{{taskName}}" du projet "{{projectName}}" vous a été attribuée'
      },
      'milestone-completed': {
        title: 'Jalon terminé',
        message: 'Le jalon "{{milestoneName}}" du projet "{{projectName}}" est terminé'
      },
      'invoice-generated': {
        title: 'Facture générée',
        message: 'La facture #{{invoiceNumber}} pour {{clientName}} a été générée'
      },
      'payment-received': {
        title: 'Paiement reçu',
        message: 'Paiement de {{amount}} reçu pour la facture #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Paiement en retard',
        message: 'La facture #{{invoiceNumber}} est en retard de {{daysOverdue}} jours'
      },
      'system-announcement': {
        title: 'Annonce système',
        message: '{{announcementTitle}}'
      },
      'user-mentioned': {
        title: 'Vous avez été mentionné',
        message: '{{authorName}} vous a mentionné dans {{entityType}} {{entityName}}'
      }
    },
    es: {
      'ticket-assigned': {
        title: 'Ticket asignado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se le ha asignado'
      },
      'ticket-created': {
        title: 'Nuevo ticket creado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se creó para {{clientName}}'
      },
      'ticket-updated': {
        title: 'Ticket actualizado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha actualizado'
      },
      'ticket-closed': {
        title: 'Ticket cerrado',
        message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha cerrado'
      },
      'ticket-comment-added': {
        title: 'Nuevo comentario',
        message: '{{authorName}} agregó un comentario al ticket #{{ticketId}}'
      },
      'project-assigned': {
        title: 'Proyecto asignado',
        message: 'El proyecto "{{projectName}}" se le ha asignado'
      },
      'project-created': {
        title: 'Nuevo proyecto creado',
        message: 'El proyecto "{{projectName}}" se creó para {{clientName}}'
      },
      'task-assigned': {
        title: 'Tarea asignada',
        message: 'La tarea "{{taskName}}" del proyecto "{{projectName}}" se le ha asignado'
      },
      'milestone-completed': {
        title: 'Hito completado',
        message: 'El hito "{{milestoneName}}" del proyecto "{{projectName}}" se ha completado'
      },
      'invoice-generated': {
        title: 'Factura generada',
        message: 'La factura #{{invoiceNumber}} para {{clientName}} se ha generado'
      },
      'payment-received': {
        title: 'Pago recibido',
        message: 'Pago de {{amount}} recibido para la factura #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Pago vencido',
        message: 'La factura #{{invoiceNumber}} tiene {{daysOverdue}} días de atraso'
      },
      'system-announcement': {
        title: 'Anuncio del sistema',
        message: '{{announcementTitle}}'
      },
      'user-mentioned': {
        title: 'Ha sido mencionado',
        message: '{{authorName}} le mencionó en {{entityType}} {{entityName}}'
      }
    },
    de: {
      'ticket-assigned': {
        title: 'Ticket zugewiesen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde Ihnen zugewiesen'
      },
      'ticket-created': {
        title: 'Neues Ticket erstellt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde für {{clientName}} erstellt'
      },
      'ticket-updated': {
        title: 'Ticket aktualisiert',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde aktualisiert'
      },
      'ticket-closed': {
        title: 'Ticket geschlossen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde geschlossen'
      },
      'ticket-comment-added': {
        title: 'Neuer Kommentar',
        message: '{{authorName}} hat einen Kommentar zum Ticket #{{ticketId}} hinzugefügt'
      },
      'project-assigned': {
        title: 'Projekt zugewiesen',
        message: 'Projekt "{{projectName}}" wurde Ihnen zugewiesen'
      },
      'project-created': {
        title: 'Neues Projekt erstellt',
        message: 'Projekt "{{projectName}}" wurde für {{clientName}} erstellt'
      },
      'task-assigned': {
        title: 'Aufgabe zugewiesen',
        message: 'Die Aufgabe "{{taskName}}" im Projekt "{{projectName}}" wurde Ihnen zugewiesen'
      },
      'milestone-completed': {
        title: 'Meilenstein abgeschlossen',
        message: 'Der Meilenstein "{{milestoneName}}" im Projekt "{{projectName}}" wurde abgeschlossen'
      },
      'invoice-generated': {
        title: 'Rechnung erstellt',
        message: 'Rechnung #{{invoiceNumber}} für {{clientName}} wurde erstellt'
      },
      'payment-received': {
        title: 'Zahlung eingegangen',
        message: 'Zahlung über {{amount}} für Rechnung #{{invoiceNumber}} ist eingegangen'
      },
      'payment-overdue': {
        title: 'Zahlung überfällig',
        message: 'Rechnung #{{invoiceNumber}} ist seit {{daysOverdue}} Tagen überfällig'
      },
      'system-announcement': {
        title: 'Systemankündigung',
        message: '{{announcementTitle}}'
      },
      'user-mentioned': {
        title: 'Sie wurden erwähnt',
        message: '{{authorName}} hat Sie in {{entityType}} {{entityName}} erwähnt'
      }
    },
    nl: {
      'ticket-assigned': {
        title: 'Ticket toegewezen',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is aan u toegewezen'
      },
      'ticket-created': {
        title: 'Nieuw ticket aangemaakt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is aangemaakt voor {{clientName}}'
      },
      'ticket-updated': {
        title: 'Ticket bijgewerkt',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is bijgewerkt'
      },
      'ticket-closed': {
        title: 'Ticket gesloten',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is gesloten'
      },
      'ticket-comment-added': {
        title: 'Nieuwe opmerking',
        message: '{{authorName}} heeft een opmerking toegevoegd aan ticket #{{ticketId}}'
      },
      'project-assigned': {
        title: 'Project toegewezen',
        message: 'Project "{{projectName}}" is aan u toegewezen'
      },
      'project-created': {
        title: 'Nieuw project aangemaakt',
        message: 'Project "{{projectName}}" is aangemaakt voor {{clientName}}'
      },
      'task-assigned': {
        title: 'Taak toegewezen',
        message: 'De taak "{{taskName}}" in project "{{projectName}}" is aan u toegewezen'
      },
      'milestone-completed': {
        title: 'Mijlpaal voltooid',
        message: 'De mijlpaal "{{milestoneName}}" in project "{{projectName}}" is voltooid'
      },
      'invoice-generated': {
        title: 'Factuur aangemaakt',
        message: 'Factuur #{{invoiceNumber}} voor {{clientName}} is aangemaakt'
      },
      'payment-received': {
        title: 'Betaling ontvangen',
        message: 'Betaling van {{amount}} voor factuur #{{invoiceNumber}} is ontvangen'
      },
      'payment-overdue': {
        title: 'Betaling te laat',
        message: 'Factuur #{{invoiceNumber}} is {{daysOverdue}} dagen te laat'
      },
      'system-announcement': {
        title: 'Systeemmededeling',
        message: '{{announcementTitle}}'
      },
      'user-mentioned': {
        title: 'U bent genoemd',
        message: '{{authorName}} heeft u genoemd in {{entityType}} {{entityName}}'
      }
    },
    it: {
      'ticket-assigned': {
        title: 'Ticket assegnato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" le è stato assegnato'
      },
      'ticket-created': {
        title: 'Nuovo ticket creato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato creato per {{clientName}}'
      },
      'ticket-updated': {
        title: 'Ticket aggiornato',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato aggiornato'
      },
      'ticket-closed': {
        title: 'Ticket chiuso',
        message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" è stato chiuso'
      },
      'ticket-comment-added': {
        title: 'Nuovo commento',
        message: '{{authorName}} ha aggiunto un commento al ticket #{{ticketId}}'
      },
      'project-assigned': {
        title: 'Progetto assegnato',
        message: 'Il progetto "{{projectName}}" le è stato assegnato'
      },
      'project-created': {
        title: 'Nuovo progetto creato',
        message: 'Il progetto "{{projectName}}" è stato creato per {{clientName}}'
      },
      'task-assigned': {
        title: 'Attività assegnata',
        message: 'L\'attività "{{taskName}}" del progetto "{{projectName}}" le è stata assegnata'
      },
      'milestone-completed': {
        title: 'Traguardo completato',
        message: 'La milestone "{{milestoneName}}" del progetto "{{projectName}}" è stata completata'
      },
      'invoice-generated': {
        title: 'Fattura generata',
        message: 'La fattura #{{invoiceNumber}} per {{clientName}} è stata generata'
      },
      'payment-received': {
        title: 'Pagamento ricevuto',
        message: 'Pagamento di {{amount}} ricevuto per la fattura #{{invoiceNumber}}'
      },
      'payment-overdue': {
        title: 'Pagamento in ritardo',
        message: 'La fattura #{{invoiceNumber}} è in ritardo di {{daysOverdue}} giorni'
      },
      'system-announcement': {
        title: 'Annuncio di sistema',
        message: '{{announcementTitle}}'
      },
      'user-mentioned': {
        title: 'È stato menzionato',
        message: '{{authorName}} l\'ha menzionato in {{entityType}} {{entityName}}'
      }
    }
  };

  const rows = [];
  for (const language of targetLanguages) {
    const languageTemplates = translations[language] || {};
    for (const [name, { title, message }] of Object.entries(languageTemplates)) {
      rows.push({
        name,
        language_code: language,
        title,
        message,
        subtype_id: getSubtypeId(name)
      });
    }
  }

  if (rows.length === 0) {
    console.warn('No translation rows prepared; skipping insert.');
    return;
  }

  await knex('internal_notification_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id')
    });

  console.log('✓ Internal notification template translations seeded');
};

exports.down = async function(knex) {
  const targetLanguages = ['fr', 'es', 'de', 'nl', 'it'];
  await knex('internal_notification_templates')
    .whereIn('language_code', targetLanguages)
    .del();

  console.log('Internal notification template translations removed');
};
