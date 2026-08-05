'use strict';

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');

const TEMPLATE_NAME = 'opportunity-weekly-digest';
const SUBTYPE_NAME = 'Opportunity Weekly Digest';

const COPY = {
  en: {
    subject: 'Your weekly opportunity brief',
    headerLabel: 'Weekly opportunity brief',
    heading: 'Your weekly opportunity brief',
    intro: 'Here is what needs your attention this week.',
    actionsDue: 'Actions due this week',
    stalledDeals: 'Stalled deals',
    newSuggestions: 'New suggestions',
    winsLastWeek: 'Wins last week',
    cta: 'Open your opportunity queue',
    footer: 'Powered by Alga PSA &middot; Keep the next action moving',
    textOpenQueue: 'Open your queue',
  },
  fr: {
    subject: 'Votre résumé hebdomadaire des opportunités',
    headerLabel: 'Résumé hebdomadaire des opportunités',
    heading: 'Votre résumé hebdomadaire des opportunités',
    intro: 'Voici ce qui demande votre attention cette semaine.',
    actionsDue: 'Actions dues cette semaine',
    stalledDeals: 'Affaires en retard',
    newSuggestions: 'Nouvelles suggestions',
    winsLastWeek: 'Gains la semaine dernière',
    cta: 'Ouvrez votre file d\'opportunités',
    footer: 'Powered by Alga PSA &middot; Faites avancer la prochaine action',
    textOpenQueue: 'Ouvrez votre file',
  },
  es: {
    subject: 'Su resumen semanal de oportunidades',
    headerLabel: 'Resumen semanal de oportunidades',
    heading: 'Su resumen semanal de oportunidades',
    intro: 'Esto es lo que requiere su atención esta semana.',
    actionsDue: 'Acciones pendientes esta semana',
    stalledDeals: 'Oportunidades estancadas',
    newSuggestions: 'Nuevas sugerencias',
    winsLastWeek: 'Oportunidades ganadas la semana pasada',
    cta: 'Abra su cola de oportunidades',
    footer: 'Powered by Alga PSA &middot; Mantenga la próxima acción en marcha',
    textOpenQueue: 'Abra su cola',
  },
  de: {
    subject: 'Ihre wöchentliche Opportunity-Übersicht',
    headerLabel: 'Wöchentliche Opportunity-Übersicht',
    heading: 'Ihre wöchentliche Opportunity-Übersicht',
    intro: 'Das erfordert diese Woche Ihre Aufmerksamkeit.',
    actionsDue: 'Diese Woche fällige Aktionen',
    stalledDeals: 'Ins Stocken geratene Abschlüsse',
    newSuggestions: 'Neue Vorschläge',
    winsLastWeek: 'Gewinne letzte Woche',
    cta: 'Öffnen Sie Ihre Opportunity-Warteschlange',
    footer: 'Powered by Alga PSA &middot; Halten Sie die nächste Aktion in Gang',
    textOpenQueue: 'Öffnen Sie Ihre Warteschlange',
  },
  nl: {
    subject: 'Uw wekelijkse opportunity-overzicht',
    headerLabel: 'Wekelijks opportunity-overzicht',
    heading: 'Uw wekelijkse opportunity-overzicht',
    intro: 'Dit vraagt deze week uw aandacht.',
    actionsDue: 'Acties deze week vervallen',
    stalledDeals: 'Vastgelopen deals',
    newSuggestions: 'Nieuwe suggesties',
    winsLastWeek: 'Winsten vorige week',
    cta: 'Open uw opportunity-wachtrij',
    footer: 'Powered by Alga PSA &middot; Houd de volgende actie in beweging',
    textOpenQueue: 'Open uw wachtrij',
  },
  it: {
    subject: 'Il tuo riepilogo settimanale delle opportunità',
    headerLabel: 'Riepilogo settimanale delle opportunità',
    heading: 'Il tuo riepilogo settimanale delle opportunità',
    intro: 'Ecco cosa richiede la tua attenzione questa settimana.',
    actionsDue: 'Azioni in scadenza questa settimana',
    stalledDeals: 'Affari bloccati',
    newSuggestions: 'Nuovi suggerimenti',
    winsLastWeek: 'Vittorie la settimana scorsa',
    cta: 'Apri la tua coda di opportunità',
    footer: 'Powered by Alga PSA &middot; Mantieni in movimento la prossima azione',
    textOpenQueue: 'Apri la tua coda',
  },
  pl: {
    subject: 'Twoje tygodniowe podsumowanie szans',
    headerLabel: 'Tygodniowe podsumowanie szans',
    heading: 'Twoje tygodniowe podsumowanie szans',
    intro: 'Oto, co wymaga Twojej uwagi w tym tygodniu.',
    actionsDue: 'Działania do wykonania w tym tygodniu',
    stalledDeals: 'Zatrzymane transakcje',
    newSuggestions: 'Nowe sugestie',
    winsLastWeek: 'Wygrane w zeszłym tygodniu',
    cta: 'Otwórz swoją kolejkę szans',
    footer: 'Powered by Alga PSA &middot; Utrzymuj następną akcję w ruchu',
    textOpenQueue: 'Otwórz swoją kolejkę',
  },
  pt: {
    subject: 'Seu resumo semanal de oportunidades',
    headerLabel: 'Resumo semanal de oportunidades',
    heading: 'Seu resumo semanal de oportunidades',
    intro: 'Aqui está o que precisa da sua atenção esta semana.',
    actionsDue: 'Ações vencendo esta semana',
    stalledDeals: 'Negócios parados',
    newSuggestions: 'Novas sugestões',
    winsLastWeek: 'Vitórias na semana passada',
    cta: 'Abra sua fila de oportunidades',
    footer: 'Powered by Alga PSA &middot; Mantenha a próxima ação em movimento',
    textOpenQueue: 'Abra sua fila',
  },
};

function buildBodyHtml(c) {
  return `
    <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;">${c.heading}</h1>
    <p style="margin:0 0 16px;">${c.intro}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;">
      <tr><td>${c.actionsDue}</td><td align="right"><strong>{{digest.actionsDue}}</strong></td></tr>
      <tr><td>${c.stalledDeals}</td><td align="right"><strong>{{digest.stalledDeals}}</strong></td></tr>
      <tr><td>${c.newSuggestions}</td><td align="right"><strong>{{digest.newSuggestions}}</strong></td></tr>
      <tr><td>${c.winsLastWeek}</td><td align="right"><strong>{{digest.winsLastWeek}}</strong></td></tr>
    </table>
    <p style="margin:20px 0 0;"><a href="{{digest.url}}">${c.cta}</a></p>
  `;
}

function buildText(c) {
  return [
    c.heading,
    '',
    `${c.actionsDue}: {{digest.actionsDue}}`,
    `${c.stalledDeals}: {{digest.stalledDeals}}`,
    `${c.newSuggestions}: {{digest.newSuggestions}}`,
    `${c.winsLastWeek}: {{digest.winsLastWeek}}`,
    '',
    `${c.textOpenQueue}: {{digest.url}}`,
  ].join('\n');
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: copy.subject,
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
