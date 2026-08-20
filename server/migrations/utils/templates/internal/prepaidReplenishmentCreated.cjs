/** Source of truth for account-manager replenishment notifications. */

const TEMPLATES = {
  templateName: 'prepaid-replenishment-created',
  subtypeName: 'prepaid-replenishment-created',
  translations: {
    en: { title: 'Prepaid replenishment {{action}}: {{clientName}}', message: 'A prepaid replenishment invoice was {{action}} for {{clientName}}. Invoice: {{invoiceNumber}} ({{invoiceStatus}}).' },
    fr: { title: 'Réapprovisionnement prépayé {{action}} : {{clientName}}', message: 'Une facture de réapprovisionnement prépayé a été {{action}} pour {{clientName}}. Facture : {{invoiceNumber}} ({{invoiceStatus}}).' },
    es: { title: 'Reposición prepaga {{action}}: {{clientName}}', message: 'Se {{action}} una factura de reposición prepaga para {{clientName}}. Factura: {{invoiceNumber}} ({{invoiceStatus}}).' },
    de: { title: 'Prepaid-Auffüllung {{action}}: {{clientName}}', message: 'Für {{clientName}} wurde eine Prepaid-Auffüllungsrechnung {{action}}. Rechnung: {{invoiceNumber}} ({{invoiceStatus}}).' },
    nl: { title: 'Prepaid-aanvulling {{action}}: {{clientName}}', message: 'Er is een prepaid-aanvullingsfactuur {{action}} voor {{clientName}}. Factuur: {{invoiceNumber}} ({{invoiceStatus}}).' },
    it: { title: 'Ricarica prepagata {{action}}: {{clientName}}', message: 'Per {{clientName}} è stata {{action}} una fattura di ricarica prepagata. Fattura: {{invoiceNumber}} ({{invoiceStatus}}).' },
    pl: { title: 'Doładowanie przedpłacone {{action}}: {{clientName}}', message: 'Dla {{clientName}} została {{action}} faktura doładowania przedpłaconego. Faktura: {{invoiceNumber}} ({{invoiceStatus}}).' },
    pt: { title: 'Reabastecimento pré-pago {{action}}: {{clientName}}', message: 'Uma fatura de reabastecimento pré-pago foi {{action}} para {{clientName}}. Fatura: {{invoiceNumber}} ({{invoiceStatus}}).' },
  },
};

module.exports = { TEMPLATES };
