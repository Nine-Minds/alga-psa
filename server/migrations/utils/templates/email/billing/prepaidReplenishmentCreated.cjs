/**
 * Source-of-truth: prepaid replenishment email template (task 29.8.19).
 *
 * Goes to the account manager when the scheduled scan acts on a prepaid
 * balance alert. `statusLabel` and `actionPhrase` arrive already translated
 * from prepaidBalanceAlertTemplates.ts, so every sentence here stays in one
 * language; the action phrase carries the verb and its agreement with the
 * invoice noun that opens the sentence. One template per file, matching the
 * convention the i18n parity tooling depends on.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');

const TEMPLATE_NAME = 'prepaid-replenishment-created';
const SUBTYPE_NAME = 'prepaid-replenishment-created';

const SUBJECTS = {
  en: 'Prepaid replenishment {{replenishment.statusLabel}}: {{client.name}}',
  fr: 'Réapprovisionnement prépayé {{replenishment.statusLabel}} : {{client.name}}',
  es: 'Reposición prepaga {{replenishment.statusLabel}}: {{client.name}}',
  de: 'Prepaid-Auffüllung {{replenishment.statusLabel}}: {{client.name}}',
  nl: 'Prepaid-aanvulling {{replenishment.statusLabel}}: {{client.name}}',
  it: 'Ricarica prepagata {{replenishment.statusLabel}}: {{client.name}}',
  pl: 'Doładowanie przedpłacone {{replenishment.statusLabel}}: {{client.name}}',
  pt: 'Reabastecimento pré-pago {{replenishment.statusLabel}}: {{client.name}}',
};

const COPY = {
  en: {
    headerLabel: 'Prepaid Replenishment',
    intro: 'Invoice {{replenishment.invoiceNumber}} for <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'Invoice {{replenishment.invoiceNumber}} for {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'View client billing',
    textView: 'View client billing at',
  },
  fr: {
    headerLabel: 'Réapprovisionnement prépayé',
    intro: 'La facture {{replenishment.invoiceNumber}} pour <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'La facture {{replenishment.invoiceNumber}} pour {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Voir la facturation du client',
    textView: 'Voir la facturation du client sur',
  },
  es: {
    headerLabel: 'Reposición prepaga',
    intro: 'La factura {{replenishment.invoiceNumber}} para <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'La factura {{replenishment.invoiceNumber}} para {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Ver la facturación del cliente',
    textView: 'Ver la facturación del cliente en',
  },
  de: {
    headerLabel: 'Prepaid-Auffüllung',
    intro: 'Rechnung {{replenishment.invoiceNumber}} für <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'Rechnung {{replenishment.invoiceNumber}} für {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Kundenabrechnung anzeigen',
    textView: 'Kundenabrechnung anzeigen unter',
  },
  nl: {
    headerLabel: 'Prepaid-aanvulling',
    intro: 'Factuur {{replenishment.invoiceNumber}} voor <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'Factuur {{replenishment.invoiceNumber}} voor {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Klantfacturatie bekijken',
    textView: 'Klantfacturatie bekijken op',
  },
  it: {
    headerLabel: 'Ricarica prepagata',
    intro: 'La fattura {{replenishment.invoiceNumber}} per <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'La fattura {{replenishment.invoiceNumber}} per {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Visualizza la fatturazione del cliente',
    textView: 'Visualizza la fatturazione del cliente su',
  },
  pl: {
    headerLabel: 'Doładowanie przedpłacone',
    intro: 'Faktura {{replenishment.invoiceNumber}} dla <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'Faktura {{replenishment.invoiceNumber}} dla {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Zobacz rozliczenia klienta',
    textView: 'Zobacz rozliczenia klienta na',
  },
  pt: {
    headerLabel: 'Reabastecimento pré-pago',
    intro: 'A fatura {{replenishment.invoiceNumber}} para <strong>{{client.name}}</strong> {{replenishment.actionPhrase}}.',
    textIntro: 'A fatura {{replenishment.invoiceNumber}} para {{client.name}} {{replenishment.actionPhrase}}.',
    viewButton: 'Ver o faturamento do cliente',
    textView: 'Ver o faturamento do cliente em',
  },
};

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([language, copy]) => ({
      language,
      subject: SUBJECTS[language],
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: copy.headerLabel,
        headerTitle: '{{client.name}}',
        bodyHtml: `<p>${copy.intro}</p><p><a href="{{replenishment.link}}">${copy.viewButton}</a></p>`,
        footerText: 'Powered by AlgaPSA',
      }),
      textContent: `${copy.textIntro}\n\n${copy.textView} {{replenishment.link}}`,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
