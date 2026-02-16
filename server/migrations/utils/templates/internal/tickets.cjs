/**
 * Source of truth for all ticket-related internal notification templates.
 *
 * Each entry has:
 *   - templateName:  unique template identifier
 *   - subtypeName:   the internal_notification_subtypes.name this template belongs to
 *   - translations:  object keyed by language code with { title, message }
 *
 * NOTE: Some template names differ from their subtype names (e.g. client-facing
 * variants like 'ticket-created-client' map to subtype 'ticket-created').
 *
 * Used by migrations and seeds via upsertInternalTemplates().
 */

const TEMPLATES = [
  // ── ticket-assigned ──────────────────────────────────────────────────
  {
    templateName: 'ticket-assigned',
    subtypeName: 'ticket-assigned',
    translations: {
      en: { title: 'Ticket Assigned', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) has been assigned to you by {{performedByName}}' },
      fr: { title: 'Ticket assign\u00e9', message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) vous a \u00e9t\u00e9 assign\u00e9 par {{performedByName}}' },
      es: { title: 'Ticket asignado', message: 'El ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) le ha sido asignado por {{performedByName}}' },
      de: { title: 'Ticket zugewiesen', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) wurde Ihnen von {{performedByName}} zugewiesen' },
      nl: { title: 'Ticket toegewezen', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) is aan u toegewezen door {{performedByName}}' },
      it: { title: 'Ticket assegnato', message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) le \u00e8 stato assegnato da {{performedByName}}' },
      pl: { title: 'Zg\u0142oszenie przypisane', message: 'Zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" ({{priority}}) zosta\u0142o do Ciebie przypisane przez {{performedByName}}' },
    },
  },

  // ── ticket-created ───────────────────────────────────────────────────
  {
    templateName: 'ticket-created',
    subtypeName: 'ticket-created',
    translations: {
      en: { title: 'New Ticket Created', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" was created for {{clientName}}' },
      fr: { title: 'Nouveau ticket cr\u00e9\u00e9', message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 cr\u00e9\u00e9 pour {{clientName}}' },
      es: { title: 'Nuevo ticket creado', message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se cre\u00f3 para {{clientName}}' },
      de: { title: 'Neues Ticket erstellt', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde f\u00fcr {{clientName}} erstellt' },
      nl: { title: 'Nieuw ticket aangemaakt', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is aangemaakt voor {{clientName}}' },
      it: { title: 'Nuovo ticket creato', message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato creato per {{clientName}}' },
      pl: { title: 'Nowe zg\u0142oszenie utworzone', message: 'Zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o utworzone dla {{clientName}}' },
    },
  },

  // ── ticket-created-client ────────────────────────────────────────────
  {
    templateName: 'ticket-created-client',
    subtypeName: 'ticket-created',
    translations: {
      en: { title: 'Your Support Ticket Has Been Created', message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been created and our team will respond shortly' },
      fr: { title: "Votre ticket d'assistance a \u00e9t\u00e9 cr\u00e9\u00e9", message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 cr\u00e9\u00e9 et notre \u00e9quipe vous r\u00e9pondra bient\u00f4t' },
      es: { title: 'Su ticket de soporte ha sido creado', message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido creado y nuestro equipo responder\u00e1 pronto' },
      de: { title: 'Ihr Support-Ticket wurde erstellt', message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde erstellt und unser Team wird sich in K\u00fcrze bei Ihnen melden' },
      nl: { title: 'Uw supportticket is aangemaakt', message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is aangemaakt en ons team reageert spoedig' },
      it: { title: 'Il suo ticket di supporto \u00e8 stato creato', message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato creato e il nostro team risponder\u00e0 a breve' },
      pl: { title: 'Twoje zg\u0142oszenie zosta\u0142o utworzone', message: 'Twoje zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o utworzone i nasz zesp\u00f3\u0142 wkr\u00f3tce odpowie' },
    },
  },

  // ── ticket-updated ───────────────────────────────────────────────────
  {
    templateName: 'ticket-updated',
    subtypeName: 'ticket-updated',
    translations: {
      en: { title: 'Ticket Updated', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been updated' },
      fr: { title: 'Ticket mis \u00e0 jour', message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 mis \u00e0 jour' },
      es: { title: 'Ticket actualizado', message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha actualizado' },
      de: { title: 'Ticket aktualisiert', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde aktualisiert' },
      nl: { title: 'Ticket bijgewerkt', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is bijgewerkt' },
      it: { title: 'Ticket aggiornato', message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato aggiornato' },
      pl: { title: 'Zg\u0142oszenie zaktualizowane', message: 'Zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o zaktualizowane' },
    },
  },

  // ── ticket-updated-client ────────────────────────────────────────────
  {
    templateName: 'ticket-updated-client',
    subtypeName: 'ticket-updated',
    translations: {
      en: { title: 'Your Ticket Has Been Updated', message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been updated' },
      fr: { title: 'Votre ticket a \u00e9t\u00e9 mis \u00e0 jour', message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 mis \u00e0 jour' },
      es: { title: 'Su ticket ha sido actualizado', message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido actualizado' },
      de: { title: 'Ihr Ticket wurde aktualisiert', message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde aktualisiert' },
      nl: { title: 'Uw ticket is bijgewerkt', message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is bijgewerkt' },
      it: { title: 'Il suo ticket \u00e8 stato aggiornato', message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato aggiornato' },
      pl: { title: 'Twoje zg\u0142oszenie zosta\u0142o zaktualizowane', message: 'Twoje zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o zaktualizowane' },
    },
  },

  // ── ticket-closed ────────────────────────────────────────────────────
  {
    templateName: 'ticket-closed',
    subtypeName: 'ticket-closed',
    translations: {
      en: { title: 'Ticket Closed', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been closed' },
      fr: { title: 'Ticket ferm\u00e9', message: 'Le ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 ferm\u00e9' },
      es: { title: 'Ticket cerrado', message: 'El ticket #{{ticketId}} "{{ticketTitle}}" se ha cerrado' },
      de: { title: 'Ticket geschlossen', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" wurde geschlossen' },
      nl: { title: 'Ticket gesloten', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" is gesloten' },
      it: { title: 'Ticket chiuso', message: 'Il ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato chiuso' },
      pl: { title: 'Zg\u0142oszenie zamkni\u0119te', message: 'Zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o zamkni\u0119te' },
    },
  },

  // ── ticket-closed-client ─────────────────────────────────────────────
  {
    templateName: 'ticket-closed-client',
    subtypeName: 'ticket-closed',
    translations: {
      en: { title: 'Your Ticket Has Been Closed', message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been closed' },
      fr: { title: 'Votre ticket a \u00e9t\u00e9 ferm\u00e9', message: 'Votre ticket #{{ticketId}} "{{ticketTitle}}" a \u00e9t\u00e9 ferm\u00e9' },
      es: { title: 'Su ticket ha sido cerrado', message: 'Su ticket #{{ticketId}} "{{ticketTitle}}" ha sido cerrado' },
      de: { title: 'Ihr Ticket wurde geschlossen', message: 'Ihr Ticket #{{ticketId}} "{{ticketTitle}}" wurde geschlossen' },
      nl: { title: 'Uw ticket is gesloten', message: 'Uw ticket #{{ticketId}} "{{ticketTitle}}" is gesloten' },
      it: { title: 'Il suo ticket \u00e8 stato chiuso', message: 'Il suo ticket #{{ticketId}} "{{ticketTitle}}" \u00e8 stato chiuso' },
      pl: { title: 'Twoje zg\u0142oszenie zosta\u0142o zamkni\u0119te', message: 'Twoje zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" zosta\u0142o zamkni\u0119te' },
    },
  },

  // ── ticket-comment-added ─────────────────────────────────────────────
  {
    templateName: 'ticket-comment-added',
    subtypeName: 'ticket-comment-added',
    translations: {
      en: { title: 'New Comment', message: '{{authorName}} commented on ticket #{{ticketId}}: "{{commentPreview}}"' },
      fr: { title: 'Nouveau commentaire', message: '{{authorName}} a ajout\u00e9 un commentaire au ticket #{{ticketId}}' },
      es: { title: 'Nuevo comentario', message: '{{authorName}} agreg\u00f3 un comentario al ticket #{{ticketId}}' },
      de: { title: 'Neuer Kommentar', message: '{{authorName}} hat einen Kommentar zum Ticket #{{ticketId}} hinzugef\u00fcgt' },
      nl: { title: 'Nieuwe opmerking', message: '{{authorName}} heeft een opmerking toegevoegd aan ticket #{{ticketId}}' },
      it: { title: 'Nuovo commento', message: '{{authorName}} ha aggiunto un commento al ticket #{{ticketId}}' },
      pl: { title: 'Nowy komentarz', message: '{{authorName}} doda\u0142(a) komentarz do zg\u0142oszenia #{{ticketId}}' },
    },
  },

  // ── ticket-comment-added-client ──────────────────────────────────────
  {
    templateName: 'ticket-comment-added-client',
    subtypeName: 'ticket-comment-added',
    translations: {
      en: { title: 'New Comment on Your Ticket', message: '{{authorName}} commented on your ticket #{{ticketId}}: "{{commentPreview}}"' },
      fr: { title: 'Nouveau commentaire sur votre ticket', message: '{{authorName}} a comment\u00e9 votre ticket #{{ticketId}}: "{{commentPreview}}"' },
      es: { title: 'Nuevo comentario en su ticket', message: '{{authorName}} coment\u00f3 su ticket #{{ticketId}}: "{{commentPreview}}"' },
      de: { title: 'Neuer Kommentar zu Ihrem Ticket', message: '{{authorName}} hat Ihr Ticket #{{ticketId}} kommentiert: "{{commentPreview}}"' },
      nl: { title: 'Nieuwe opmerking bij uw ticket', message: '{{authorName}} heeft commentaar gegeven op uw ticket #{{ticketId}}: "{{commentPreview}}"' },
      it: { title: 'Nuovo commento sul suo ticket', message: '{{authorName}} ha commentato il suo ticket #{{ticketId}}: "{{commentPreview}}"' },
      pl: { title: 'Nowy komentarz do Twojego zg\u0142oszenia', message: '{{authorName}} skomentowa\u0142(a) Twoje zg\u0142oszenie #{{ticketId}}: "{{commentPreview}}"' },
    },
  },

  // ── ticket-status-changed ────────────────────────────────────────────
  {
    templateName: 'ticket-status-changed',
    subtypeName: 'ticket-status-changed',
    translations: {
      en: { title: 'Ticket Status Changed', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" status changed: {{oldStatus}} \u2192 {{newStatus}} by {{performedByName}}' },
      fr: { title: 'Statut du ticket modifi\u00e9', message: 'Statut du ticket #{{ticketId}} "{{ticketTitle}}" modifi\u00e9: {{oldStatus}} \u2192 {{newStatus}} par {{performedByName}}' },
      es: { title: 'Estado del ticket cambiado', message: 'Estado del ticket #{{ticketId}} "{{ticketTitle}}" cambiado: {{oldStatus}} \u2192 {{newStatus}} por {{performedByName}}' },
      de: { title: 'Ticket-Status ge\u00e4ndert', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" Status ge\u00e4ndert: {{oldStatus}} \u2192 {{newStatus}} von {{performedByName}}' },
      nl: { title: 'Ticket status gewijzigd', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" status gewijzigd: {{oldStatus}} \u2192 {{newStatus}} door {{performedByName}}' },
      it: { title: 'Stato del ticket modificato', message: 'Stato del ticket #{{ticketId}} "{{ticketTitle}}" modificato: {{oldStatus}} \u2192 {{newStatus}} da {{performedByName}}' },
      pl: { title: 'Zmieniono status zg\u0142oszenia', message: 'Status zg\u0142oszenia #{{ticketId}} "{{ticketTitle}}" zmieniony: {{oldStatus}} \u2192 {{newStatus}} przez {{performedByName}}' },
    },
  },

  // ── ticket-priority-changed ──────────────────────────────────────────
  {
    templateName: 'ticket-priority-changed',
    subtypeName: 'ticket-priority-changed',
    translations: {
      en: { title: 'Ticket Priority Changed', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" priority changed: {{oldPriority}} \u2192 {{newPriority}} by {{performedByName}}' },
      fr: { title: 'Priorit\u00e9 du ticket modifi\u00e9e', message: 'Priorit\u00e9 du ticket #{{ticketId}} "{{ticketTitle}}" modifi\u00e9e: {{oldPriority}} \u2192 {{newPriority}} par {{performedByName}}' },
      es: { title: 'Prioridad del ticket cambiada', message: 'Prioridad del ticket #{{ticketId}} "{{ticketTitle}}" cambiada: {{oldPriority}} \u2192 {{newPriority}} por {{performedByName}}' },
      de: { title: 'Ticket-Priorit\u00e4t ge\u00e4ndert', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" Priorit\u00e4t ge\u00e4ndert: {{oldPriority}} \u2192 {{newPriority}} von {{performedByName}}' },
      nl: { title: 'Ticket prioriteit gewijzigd', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" prioriteit gewijzigd: {{oldPriority}} \u2192 {{newPriority}} door {{performedByName}}' },
      it: { title: 'Priorit\u00e0 del ticket modificata', message: 'Priorit\u00e0 del ticket #{{ticketId}} "{{ticketTitle}}" modificata: {{oldPriority}} \u2192 {{newPriority}} da {{performedByName}}' },
      pl: { title: 'Zmieniono priorytet zg\u0142oszenia', message: 'Priorytet zg\u0142oszenia #{{ticketId}} "{{ticketTitle}}" zmieniony: {{oldPriority}} \u2192 {{newPriority}} przez {{performedByName}}' },
    },
  },

  // ── ticket-reassigned ────────────────────────────────────────────────
  {
    templateName: 'ticket-reassigned',
    subtypeName: 'ticket-reassigned',
    translations: {
      en: { title: 'Ticket Reassigned', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" reassigned: {{oldAssignedTo}} \u2192 {{newAssignedTo}} by {{performedByName}}' },
      fr: { title: 'Ticket r\u00e9assign\u00e9', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" r\u00e9assign\u00e9: {{oldAssignedTo}} \u2192 {{newAssignedTo}} par {{performedByName}}' },
      es: { title: 'Ticket reasignado', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" reasignado: {{oldAssignedTo}} \u2192 {{newAssignedTo}} por {{performedByName}}' },
      de: { title: 'Ticket neu zugewiesen', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" neu zugewiesen: {{oldAssignedTo}} \u2192 {{newAssignedTo}} von {{performedByName}}' },
      nl: { title: 'Ticket opnieuw toegewezen', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" opnieuw toegewezen: {{oldAssignedTo}} \u2192 {{newAssignedTo}} door {{performedByName}}' },
      it: { title: 'Ticket riassegnato', message: 'Ticket #{{ticketId}} "{{ticketTitle}}" riassegnato: {{oldAssignedTo}} \u2192 {{newAssignedTo}} da {{performedByName}}' },
      pl: { title: 'Zg\u0142oszenie przypisane ponownie', message: 'Zg\u0142oszenie #{{ticketId}} "{{ticketTitle}}" przypisane ponownie: {{oldAssignedTo}} \u2192 {{newAssignedTo}} przez {{performedByName}}' },
    },
  },

  // ── ticket-additional-agent-assigned ─────────────────────────────────
  {
    templateName: 'ticket-additional-agent-assigned',
    subtypeName: 'ticket-additional-agent-assigned',
    translations: {
      en: { title: 'Added as Additional Agent', message: 'You have been added as an additional agent on ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
      fr: { title: 'Ajout\u00e9 comme agent suppl\u00e9mentaire', message: 'Vous avez \u00e9t\u00e9 ajout\u00e9 comme agent suppl\u00e9mentaire sur le ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
      es: { title: 'Agregado como agente adicional', message: 'Ha sido agregado como agente adicional en el ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
      de: { title: 'Als zus\u00e4tzlicher Agent hinzugef\u00fcgt', message: 'Sie wurden als zus\u00e4tzlicher Agent zum Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) hinzugef\u00fcgt' },
      nl: { title: 'Toegevoegd als extra agent', message: 'U bent toegevoegd als extra agent aan ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
      it: { title: 'Aggiunto come agente aggiuntivo', message: 'Sei stato aggiunto come agente aggiuntivo al ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
      pl: { title: 'Dodano jako dodatkowego agenta', message: 'Zosta\u0142e\u015b(a\u015b) dodany(a) jako dodatkowy agent do zg\u0142oszenia #{{ticketId}} "{{ticketTitle}}" ({{priority}})' },
    },
  },

  // ── ticket-additional-agent-added ────────────────────────────────────
  {
    templateName: 'ticket-additional-agent-added',
    subtypeName: 'ticket-additional-agent-added',
    translations: {
      en: { title: 'Additional Agent Added', message: '{{additionalAgentName}} has been added as an additional agent on your ticket #{{ticketId}} "{{ticketTitle}}"' },
      fr: { title: 'Agent suppl\u00e9mentaire ajout\u00e9', message: '{{additionalAgentName}} a \u00e9t\u00e9 ajout\u00e9 comme agent suppl\u00e9mentaire sur votre ticket #{{ticketId}} "{{ticketTitle}}"' },
      es: { title: 'Agente adicional agregado', message: '{{additionalAgentName}} ha sido agregado como agente adicional en su ticket #{{ticketId}} "{{ticketTitle}}"' },
      de: { title: 'Zus\u00e4tzlicher Agent hinzugef\u00fcgt', message: '{{additionalAgentName}} wurde als zus\u00e4tzlicher Agent zu Ihrem Ticket #{{ticketId}} "{{ticketTitle}}" hinzugef\u00fcgt' },
      nl: { title: 'Extra agent toegevoegd', message: '{{additionalAgentName}} is toegevoegd als extra agent aan uw ticket #{{ticketId}} "{{ticketTitle}}"' },
      it: { title: 'Agente aggiuntivo aggiunto', message: '{{additionalAgentName}} \u00e8 stato aggiunto come agente aggiuntivo al suo ticket #{{ticketId}} "{{ticketTitle}}"' },
      pl: { title: 'Dodano dodatkowego agenta', message: '{{additionalAgentName}} zosta\u0142(a) dodany(a) jako dodatkowy agent do Twojego zg\u0142oszenia #{{ticketId}} "{{ticketTitle}}"' },
    },
  },

  // ── ticket-additional-agent-added-client ─────────────────────────────
  {
    templateName: 'ticket-additional-agent-added-client',
    subtypeName: 'ticket-additional-agent-added',
    translations: {
      en: { title: 'Additional Support Agent Assigned', message: '{{additionalAgentName}} has been added to help with your ticket #{{ticketId}} "{{ticketTitle}}"' },
      fr: { title: 'Agent de support suppl\u00e9mentaire assign\u00e9', message: '{{additionalAgentName}} a \u00e9t\u00e9 ajout\u00e9 pour vous aider avec votre ticket #{{ticketId}} "{{ticketTitle}}"' },
      es: { title: 'Agente de soporte adicional asignado', message: '{{additionalAgentName}} ha sido agregado para ayudar con su ticket #{{ticketId}} "{{ticketTitle}}"' },
      de: { title: 'Zus\u00e4tzlicher Support-Mitarbeiter zugewiesen', message: '{{additionalAgentName}} wurde hinzugef\u00fcgt, um bei Ihrem Ticket #{{ticketId}} "{{ticketTitle}}" zu helfen' },
      nl: { title: 'Extra ondersteuningsagent toegewezen', message: '{{additionalAgentName}} is toegevoegd om te helpen met uw ticket #{{ticketId}} "{{ticketTitle}}"' },
      it: { title: 'Agente di supporto aggiuntivo assegnato', message: '{{additionalAgentName}} \u00e8 stato aggiunto per aiutare con il suo ticket #{{ticketId}} "{{ticketTitle}}"' },
      pl: { title: 'Przypisano dodatkowego agenta wsparcia', message: '{{additionalAgentName}} zosta\u0142(a) dodany(a) do pomocy przy Twoim zg\u0142oszeniu #{{ticketId}} "{{ticketTitle}}"' },
    },
  },
];

module.exports = { TEMPLATES };
