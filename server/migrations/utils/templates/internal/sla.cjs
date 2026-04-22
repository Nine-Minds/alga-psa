/**
 * Source of truth for all SLA-related internal notification templates.
 *
 * Each entry has:
 *   - templateName:  unique template identifier
 *   - subtypeName:   the internal_notification_subtypes.name this template belongs to
 *   - translations:  object keyed by language code with { title, message }
 *
 * SLA notifications are internal-only (sent to MSP technicians/managers).
 *
 * Used by migrations and seeds via upsertInternalTemplates().
 */

const TEMPLATES = [
  // -- sla-warning (any threshold < 100%) -------------------------------------
  {
    templateName: 'sla-warning',
    subtypeName: 'sla-warning',
    translations: {
      en: {
        title: 'SLA Warning: {{thresholdPercent}}% Time Elapsed',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is at {{thresholdPercent}}% of its {{slaType}} SLA. Time remaining: {{remainingTime}}.',
      },
      fr: {
        title: 'Alerte SLA\u00a0: {{thresholdPercent}}\u00a0% du temps \u00e9coul\u00e9',
        message: 'Le ticket #{{ticketNumber}} "{{ticketTitle}}" a atteint {{thresholdPercent}}\u00a0% de son SLA {{slaType}}. Temps restant\u00a0: {{remainingTime}}.',
      },
      es: {
        title: 'Alerta de SLA: {{thresholdPercent}}% de tiempo transcurrido',
        message: 'El ticket #{{ticketNumber}} "{{ticketTitle}}" est\u00e1 al {{thresholdPercent}}% de su SLA {{slaType}}. Tiempo restante: {{remainingTime}}.',
      },
      de: {
        title: 'SLA-Warnung: {{thresholdPercent}}% der Zeit verstrichen',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" hat {{thresholdPercent}}% seines {{slaType}}-SLA erreicht. Verbleibende Zeit: {{remainingTime}}.',
      },
      nl: {
        title: 'SLA-waarschuwing: {{thresholdPercent}}% van de tijd verstreken',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" heeft {{thresholdPercent}}% van zijn {{slaType}}-SLA bereikt. Resterende tijd: {{remainingTime}}.',
      },
      it: {
        title: 'Avviso SLA: {{thresholdPercent}}% del tempo trascorso',
        message: 'Il ticket #{{ticketNumber}} "{{ticketTitle}}" \u00e8 al {{thresholdPercent}}% del suo SLA {{slaType}}. Tempo rimanente: {{remainingTime}}.',
      },
      pl: {
        title: 'Ostrze\u017cenie SLA: up\u0142yn\u0119\u0142o {{thresholdPercent}}% czasu',
        message: 'Zg\u0142oszenie #{{ticketNumber}} "{{ticketTitle}}" osi\u0105gn\u0119\u0142o {{thresholdPercent}}% limitu SLA {{slaType}}. Pozosta\u0142y czas: {{remainingTime}}.',
      },
    },
  },

  // -- sla-breach -------------------------------------------------------------
  {
    templateName: 'sla-breach',
    subtypeName: 'sla-breach',
    translations: {
      en: {
        title: 'SLA Breached',
        message: 'SLA BREACH: Ticket #{{ticketNumber}} "{{ticketTitle}}" has exceeded its {{slaType}} SLA target. Policy: {{policyName}}. Client: {{clientName}}.',
      },
      fr: {
        title: 'SLA non respect\u00e9',
        message: 'VIOLATION DE SLA\u00a0: le ticket #{{ticketNumber}} "{{ticketTitle}}" a d\u00e9pass\u00e9 l\'objectif de son SLA {{slaType}}. Politique\u00a0: {{policyName}}. Client\u00a0: {{clientName}}.',
      },
      es: {
        title: 'SLA incumplido',
        message: 'INCUMPLIMIENTO DE SLA: el ticket #{{ticketNumber}} "{{ticketTitle}}" ha superado el objetivo de su SLA {{slaType}}. Pol\u00edtica: {{policyName}}. Cliente: {{clientName}}.',
      },
      de: {
        title: 'SLA verletzt',
        message: 'SLA-VERLETZUNG: Ticket #{{ticketNumber}} "{{ticketTitle}}" hat das Ziel seines {{slaType}}-SLA \u00fcberschritten. Richtlinie: {{policyName}}. Kunde: {{clientName}}.',
      },
      nl: {
        title: 'SLA overschreden',
        message: 'SLA-OVERSCHRIJDING: ticket #{{ticketNumber}} "{{ticketTitle}}" heeft de doelstelling van zijn {{slaType}}-SLA overschreden. Beleid: {{policyName}}. Klant: {{clientName}}.',
      },
      it: {
        title: 'SLA non rispettato',
        message: 'VIOLAZIONE SLA: il ticket #{{ticketNumber}} "{{ticketTitle}}" ha superato l\'obiettivo del suo SLA {{slaType}}. Criterio: {{policyName}}. Cliente: {{clientName}}.',
      },
      pl: {
        title: 'Naruszenie SLA',
        message: 'NARUSZENIE SLA: zg\u0142oszenie #{{ticketNumber}} "{{ticketTitle}}" przekroczy\u0142o cel SLA {{slaType}}. Zasada: {{policyName}}. Klient: {{clientName}}.',
      },
    },
  },

  // -- sla-response-met -------------------------------------------------------
  {
    templateName: 'sla-response-met',
    subtypeName: 'sla-response-met',
    translations: {
      en: {
        title: 'Response SLA Met',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" response SLA was met. First response provided within target time.',
      },
      fr: {
        title: 'SLA de r\u00e9ponse respect\u00e9',
        message: 'Le SLA de r\u00e9ponse du ticket #{{ticketNumber}} "{{ticketTitle}}" a \u00e9t\u00e9 respect\u00e9. La premi\u00e8re r\u00e9ponse a \u00e9t\u00e9 fournie dans le d\u00e9lai cible.',
      },
      es: {
        title: 'SLA de respuesta cumplido',
        message: 'Se cumpli\u00f3 el SLA de respuesta del ticket #{{ticketNumber}} "{{ticketTitle}}". La primera respuesta se proporcion\u00f3 dentro del tiempo objetivo.',
      },
      de: {
        title: 'Reaktions-SLA erf\u00fcllt',
        message: 'Das Reaktions-SLA f\u00fcr Ticket #{{ticketNumber}} "{{ticketTitle}}" wurde erf\u00fcllt. Die erste Antwort wurde innerhalb der Zielzeit bereitgestellt.',
      },
      nl: {
        title: 'Reactie-SLA behaald',
        message: 'De reactie-SLA voor ticket #{{ticketNumber}} "{{ticketTitle}}" is behaald. De eerste reactie is binnen de streeftijd gegeven.',
      },
      it: {
        title: 'SLA di risposta rispettato',
        message: 'Lo SLA di risposta del ticket #{{ticketNumber}} "{{ticketTitle}}" \u00e8 stato rispettato. La prima risposta \u00e8 stata fornita entro il tempo previsto.',
      },
      pl: {
        title: 'SLA odpowiedzi dotrzymane',
        message: 'SLA odpowiedzi dla zg\u0142oszenia #{{ticketNumber}} "{{ticketTitle}}" zosta\u0142o dotrzymane. Pierwsza odpowied\u017a zosta\u0142a udzielona w docelowym czasie.',
      },
    },
  },

  // -- sla-resolution-met -----------------------------------------------------
  {
    templateName: 'sla-resolution-met',
    subtypeName: 'sla-resolution-met',
    translations: {
      en: {
        title: 'Resolution SLA Met',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" was resolved within SLA target. Great job!',
      },
      fr: {
        title: 'SLA de r\u00e9solution respect\u00e9',
        message: 'Le ticket #{{ticketNumber}} "{{ticketTitle}}" a \u00e9t\u00e9 r\u00e9solu dans le d\u00e9lai SLA. Excellent travail\u00a0!',
      },
      es: {
        title: 'SLA de resoluci\u00f3n cumplido',
        message: 'El ticket #{{ticketNumber}} "{{ticketTitle}}" se resolvi\u00f3 dentro del objetivo del SLA. \u00a1Excelente trabajo!',
      },
      de: {
        title: 'L\u00f6sungs-SLA erf\u00fcllt',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" wurde innerhalb des SLA-Ziels gel\u00f6st. Gute Arbeit!',
      },
      nl: {
        title: 'Oplossings-SLA behaald',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is binnen de SLA-doelstelling opgelost. Goed gedaan!',
      },
      it: {
        title: 'SLA di risoluzione rispettato',
        message: 'Il ticket #{{ticketNumber}} "{{ticketTitle}}" \u00e8 stato risolto entro l\'obiettivo SLA. Ottimo lavoro!',
      },
      pl: {
        title: 'SLA rozwi\u0105zania dotrzymane',
        message: 'Zg\u0142oszenie #{{ticketNumber}} "{{ticketTitle}}" zosta\u0142o rozwi\u0105zane w ramach celu SLA. \u015awietna robota!',
      },
    },
  },

  // -- sla-escalation ---------------------------------------------------------
  {
    templateName: 'sla-escalation',
    subtypeName: 'sla-escalation',
    translations: {
      en: {
        title: 'Ticket Escalated (SLA)',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" has been escalated to level {{escalationLevel}} due to SLA. You have been added as an escalation manager.',
      },
      fr: {
        title: 'Ticket escalad\u00e9 (SLA)',
        message: 'Le ticket #{{ticketNumber}} "{{ticketTitle}}" a \u00e9t\u00e9 escalad\u00e9 au niveau {{escalationLevel}} en raison du SLA. Vous avez \u00e9t\u00e9 ajout\u00e9 comme responsable d\'escalade.',
      },
      es: {
        title: 'Ticket escalado (SLA)',
        message: 'El ticket #{{ticketNumber}} "{{ticketTitle}}" se ha escalado al nivel {{escalationLevel}} debido al SLA. Ha sido agregado como gestor de escalada.',
      },
      de: {
        title: 'Ticket eskaliert (SLA)',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" wurde aufgrund des SLA auf Stufe {{escalationLevel}} eskaliert. Sie wurden als Eskalationsmanager hinzugef\u00fcgt.',
      },
      nl: {
        title: 'Ticket ge\u00ebscaleerd (SLA)',
        message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is vanwege de SLA ge\u00ebscaleerd naar niveau {{escalationLevel}}. U bent toegevoegd als escalatiemanager.',
      },
      it: {
        title: 'Ticket scalato (SLA)',
        message: 'Il ticket #{{ticketNumber}} "{{ticketTitle}}" \u00e8 stato scalato al livello {{escalationLevel}} a causa dello SLA. Sei stato aggiunto come responsabile dell\'escalation.',
      },
      pl: {
        title: 'Zg\u0142oszenie eskalowane (SLA)',
        message: 'Zg\u0142oszenie #{{ticketNumber}} "{{ticketTitle}}" zosta\u0142o eskalowane do poziomu {{escalationLevel}} z powodu SLA. Zosta\u0142e\u015b(a\u015b) dodany(a) jako mened\u017cer eskalacji.',
      },
    },
  },
];

module.exports = { TEMPLATES };
