/**
 * Source of truth for account-manager replenishment notifications.
 *
 * `statusLabel` and `actionPhrase` arrive already translated from
 * prepaidBalanceAlertTemplates.ts, so each sentence stays in one language.
 */

const TEMPLATES = {
  templateName: 'prepaid-replenishment-created',
  subtypeName: 'prepaid-replenishment-created',
  translations: {
    en: {
      title: 'Prepaid replenishment {{statusLabel}}: {{clientName}}',
      message: 'Invoice {{invoiceNumber}} for {{clientName}} {{actionPhrase}}.',
    },
    fr: {
      title: 'Réapprovisionnement prépayé {{statusLabel}} : {{clientName}}',
      message: 'La facture {{invoiceNumber}} pour {{clientName}} {{actionPhrase}}.',
    },
    es: {
      title: 'Reposición prepaga {{statusLabel}}: {{clientName}}',
      message: 'La factura {{invoiceNumber}} para {{clientName}} {{actionPhrase}}.',
    },
    de: {
      title: 'Prepaid-Auffüllung {{statusLabel}}: {{clientName}}',
      message: 'Rechnung {{invoiceNumber}} für {{clientName}} {{actionPhrase}}.',
    },
    nl: {
      title: 'Prepaid-aanvulling {{statusLabel}}: {{clientName}}',
      message: 'Factuur {{invoiceNumber}} voor {{clientName}} {{actionPhrase}}.',
    },
    it: {
      title: 'Ricarica prepagata {{statusLabel}}: {{clientName}}',
      message: 'La fattura {{invoiceNumber}} per {{clientName}} {{actionPhrase}}.',
    },
    pl: {
      title: 'Doładowanie przedpłacone {{statusLabel}}: {{clientName}}',
      message: 'Faktura {{invoiceNumber}} dla {{clientName}} {{actionPhrase}}.',
    },
    pt: {
      title: 'Reabastecimento pré-pago {{statusLabel}}: {{clientName}}',
      message: 'A fatura {{invoiceNumber}} para {{clientName}} {{actionPhrase}}.',
    },
  },
};

module.exports = { TEMPLATES };
