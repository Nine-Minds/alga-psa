'use strict';

const TEMPLATES = [
  {
    templateName: 'opportunity-stalled',
    subtypeName: 'opportunity-stalled',
    translations: {
      en: {
        title: 'Opportunity going quiet: {{opportunityTitle}}',
        message: '{{why}} Next action: {{nextAction}}',
      },
      fr: {
        title: 'Opportunité en perte de vitesse : {{opportunityTitle}}',
        message: '{{why}} Prochaine action : {{nextAction}}',
      },
      es: {
        title: 'Oportunidad enfriándose: {{opportunityTitle}}',
        message: '{{why}} Próxima acción: {{nextAction}}',
      },
      de: {
        title: 'Opportunity wird ruhig: {{opportunityTitle}}',
        message: '{{why}} Nächste Aktion: {{nextAction}}',
      },
      nl: {
        title: 'Opportunity wordt stil: {{opportunityTitle}}',
        message: '{{why}} Volgende actie: {{nextAction}}',
      },
      it: {
        title: 'Opportunità in calo: {{opportunityTitle}}',
        message: '{{why}} Prossima azione: {{nextAction}}',
      },
      pl: {
        title: 'Szansa przygasa: {{opportunityTitle}}',
        message: '{{why}} Następna akcja: {{nextAction}}',
      },
      pt: {
        title: 'Oportunidade esfriando: {{opportunityTitle}}',
        message: '{{why}} Próxima ação: {{nextAction}}',
      },
    },
  },
  {
    templateName: 'opportunity-escalated',
    subtypeName: 'opportunity-escalated',
    translations: {
      en: {
        title: 'Opportunity needs intervention: {{opportunityTitle}}',
        message: '{{ownerName}}\'s opportunity with {{clientName}} has been quiet for {{daysSinceActivity}} days.',
      },
      fr: {
        title: 'L\'opportunité nécessite une intervention : {{opportunityTitle}}',
        message: 'L\'opportunité de {{ownerName}} avec {{clientName}} est inactive depuis {{daysSinceActivity}} jours.',
      },
      es: {
        title: 'La oportunidad necesita intervención: {{opportunityTitle}}',
        message: 'La oportunidad de {{ownerName}} con {{clientName}} lleva {{daysSinceActivity}} días sin actividad.',
      },
      de: {
        title: 'Opportunity erfordert Eingreifen: {{opportunityTitle}}',
        message: 'Die Opportunity von {{ownerName}} mit {{clientName}} ist seit {{daysSinceActivity}} Tagen inaktiv.',
      },
      nl: {
        title: 'Opportunity vereist interventie: {{opportunityTitle}}',
        message: 'De opportunity van {{ownerName}} met {{clientName}} is al {{daysSinceActivity}} dagen inactief.',
      },
      it: {
        title: 'L\'opportunità richiede intervento: {{opportunityTitle}}',
        message: 'L\'opportunità di {{ownerName}} con {{clientName}} è inattiva da {{daysSinceActivity}} giorni.',
      },
      pl: {
        title: 'Szansa wymaga interwencji: {{opportunityTitle}}',
        message: 'Szansa użytkownika {{ownerName}} z klientem {{clientName}} jest nieaktywna od {{daysSinceActivity}} dni.',
      },
      pt: {
        title: 'A oportunidade precisa de intervenção: {{opportunityTitle}}',
        message: 'A oportunidade de {{ownerName}} com {{clientName}} está parada há {{daysSinceActivity}} dias.',
      },
    },
  },
  {
    templateName: 'opportunity-weekly-digest',
    subtypeName: 'opportunity-weekly-digest',
    translations: {
      en: {
        title: 'Your weekly opportunity brief',
        message: '{{actionsDue}} actions due this week, {{stalledDeals}} stalled deals, {{newSuggestions}} new suggestions, and {{winsLastWeek}} wins last week.',
      },
      fr: {
        title: 'Votre résumé hebdomadaire des opportunités',
        message: '{{actionsDue}} actions dues cette semaine, {{stalledDeals}} affaires en retard, {{newSuggestions}} nouvelles suggestions et {{winsLastWeek}} gains la semaine dernière.',
      },
      es: {
        title: 'Tu resumen semanal de oportunidades',
        message: '{{actionsDue}} acciones pendientes esta semana, {{stalledDeals}} tratos estancados, {{newSuggestions}} nuevas sugerencias y {{winsLastWeek}} ganados la semana pasada.',
      },
      de: {
        title: 'Ihre wöchentliche Opportunity-Übersicht',
        message: '{{actionsDue}} diese Woche fällige Aktionen, {{stalledDeals}} ins Stocken geratene Abschlüsse, {{newSuggestions}} neue Vorschläge und {{winsLastWeek}} Gewinne letzte Woche.',
      },
      nl: {
        title: 'Je wekelijkse opportunity-overzicht',
        message: '{{actionsDue}} acties deze week vervallen, {{stalledDeals}} vastgelopen deals, {{newSuggestions}} nieuwe suggesties en {{winsLastWeek}} winsten vorige week.',
      },
      it: {
        title: 'Il tuo riepilogo settimanale delle opportunità',
        message: '{{actionsDue}} azioni in scadenza questa settimana, {{stalledDeals}} affari bloccati, {{newSuggestions}} nuovi suggerimenti e {{winsLastWeek}} vittorie la settimana scorsa.',
      },
      pl: {
        title: 'Twoje tygodniowe podsumowanie szans',
        message: '{{actionsDue}} działania do wykonania w tym tygodniu, {{stalledDeals}} zatrzymane transakcje, {{newSuggestions}} nowe sugestie i {{winsLastWeek}} wygrane w zeszłym tygodniu.',
      },
      pt: {
        title: 'Seu resumo semanal de oportunidades',
        message: '{{actionsDue}} ações vencendo esta semana, {{stalledDeals}} negócios parados, {{newSuggestions}} novas sugestões e {{winsLastWeek}} vitórias na semana passada.',
      },
    },
  },
];

module.exports = { TEMPLATES };
