/** Source of truth: account-manager prepaid replenishment email. */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');

const TEMPLATE_NAME = 'prepaid-replenishment-created';
const SUBTYPE_NAME = 'prepaid-replenishment-created';
const LANGUAGES = {
  en: ['Prepaid replenishment {{replenishment.action}}: {{client.name}}', 'A prepaid replenishment invoice was {{replenishment.action}} for <strong>{{client.name}}</strong>. Invoice: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  fr: ['Réapprovisionnement prépayé {{replenishment.action}} : {{client.name}}', 'Une facture de réapprovisionnement prépayé a été {{replenishment.action}} pour <strong>{{client.name}}</strong>. Facture : {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  es: ['Reposición prepaga {{replenishment.action}}: {{client.name}}', 'Se {{replenishment.action}} una factura de reposición prepaga para <strong>{{client.name}}</strong>. Factura: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  de: ['Prepaid-Auffüllung {{replenishment.action}}: {{client.name}}', 'Für <strong>{{client.name}}</strong> wurde eine Prepaid-Auffüllungsrechnung {{replenishment.action}}. Rechnung: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  nl: ['Prepaid-aanvulling {{replenishment.action}}: {{client.name}}', 'Er is een prepaid-aanvullingsfactuur {{replenishment.action}} voor <strong>{{client.name}}</strong>. Factuur: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  it: ['Ricarica prepagata {{replenishment.action}}: {{client.name}}', 'Per <strong>{{client.name}}</strong> è stata {{replenishment.action}} una fattura di ricarica prepagata. Fattura: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  pl: ['Doładowanie przedpłacone {{replenishment.action}}: {{client.name}}', 'Dla <strong>{{client.name}}</strong> została {{replenishment.action}} faktura doładowania przedpłaconego. Faktura: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
  pt: ['Reabastecimento pré-pago {{replenishment.action}}: {{client.name}}', 'Uma fatura de reabastecimento pré-pago foi {{replenishment.action}} para <strong>{{client.name}}</strong>. Fatura: {{replenishment.invoiceNumber}} ({{replenishment.invoiceStatus}}).'],
};

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(LANGUAGES).map(([language, [subject, intro]]) => ({
      language,
      subject,
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: 'Prepaid Replenishment',
        headerTitle: '{{client.name}}',
        bodyHtml: `<p>${intro}</p><p><a href="{{replenishment.link}}">View client billing</a></p>`,
        footerText: 'Powered by AlgaPSA',
      }),
      textContent: `${intro.replace(/<[^>]+>/g, '')}\n\nView client billing: {{replenishment.link}}`,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
