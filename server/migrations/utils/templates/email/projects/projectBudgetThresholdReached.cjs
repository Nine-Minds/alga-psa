const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-budget-threshold-reached';
const SUBTYPE_NAME = 'Project Budget Threshold Reached';

const COPY = {
  en: { subject: 'Project budget threshold reached: {{project.name}}', label: 'Budget Threshold Reached', intro: 'This project has crossed a configured budget notification threshold.', threshold: 'Threshold', billed: 'Billed', cap: 'Budget cap', button: 'Review project', footer: 'Powered by Alga PSA' },
  fr: { subject: 'Seuil budgétaire atteint : {{project.name}}', label: 'Seuil budgétaire atteint', intro: 'Ce projet a franchi un seuil de notification budgétaire configuré.', threshold: 'Seuil', billed: 'Facturé', cap: 'Plafond budgétaire', button: 'Examiner le projet', footer: 'Propulsé par Alga PSA' },
  es: { subject: 'Umbral de presupuesto alcanzado: {{project.name}}', label: 'Umbral de presupuesto alcanzado', intro: 'Este proyecto ha superado un umbral de notificación de presupuesto configurado.', threshold: 'Umbral', billed: 'Facturado', cap: 'Tope de presupuesto', button: 'Revisar proyecto', footer: 'Desarrollado por Alga PSA' },
  de: { subject: 'Projektbudget-Schwellenwert erreicht: {{project.name}}', label: 'Budget-Schwellenwert erreicht', intro: 'Dieses Projekt hat einen konfigurierten Budget-Schwellenwert überschritten.', threshold: 'Schwellenwert', billed: 'Abgerechnet', cap: 'Budgetobergrenze', button: 'Projekt prüfen', footer: 'Bereitgestellt von Alga PSA' },
  nl: { subject: 'Projectbudgetdrempel bereikt: {{project.name}}', label: 'Budgetdrempel bereikt', intro: 'Dit project heeft een ingestelde budgetmeldingsdrempel overschreden.', threshold: 'Drempel', billed: 'Gefactureerd', cap: 'Budgetlimiet', button: 'Project bekijken', footer: 'Mogelijk gemaakt door Alga PSA' },
  it: { subject: 'Soglia budget del progetto raggiunta: {{project.name}}', label: 'Soglia budget raggiunta', intro: 'Questo progetto ha superato una soglia di notifica del budget configurata.', threshold: 'Soglia', billed: 'Fatturato', cap: 'Limite budget', button: 'Rivedi progetto', footer: 'Powered by Alga PSA' },
  pl: { subject: 'Osiągnięto próg budżetu projektu: {{project.name}}', label: 'Osiągnięto próg budżetu', intro: 'Projekt przekroczył skonfigurowany próg powiadomienia o budżecie.', threshold: 'Próg', billed: 'Zafakturowano', cap: 'Limit budżetu', button: 'Sprawdź projekt', footer: 'Powered by Alga PSA' },
  pt: { subject: 'Limite de orçamento do projeto atingido: {{project.name}}', label: 'Limite de orçamento atingido', intro: 'Este projeto ultrapassou um limite configurado de notificação de orçamento.', threshold: 'Limite', billed: 'Faturado', cap: 'Teto do orçamento', button: 'Revisar projeto', footer: 'Desenvolvido por Alga PSA' },
};

function body(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.threshold}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{budget.threshold}}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.billed}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{budget.billed}}</td></tr>
      <tr><td style="padding:10px 0;font-weight:600;color:#475467;">${c.cap}</td><td style="padding:10px 0;">{{budget.cap}}</td></tr>
    </table>
    <div style="margin-top:24px;"><a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.button}</a></div>`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([language, c]) => ({
      language,
      subject: c.subject,
      htmlContent: wrapEmailLayout({ language, headerLabel: c.label, headerTitle: '{{project.name}}', headerMeta: '{{project.number}}', bodyHtml: body(c), footerText: c.footer }),
      textContent: `${c.label}\n\n${c.intro}\n\n${c.threshold}: {{budget.threshold}}\n${c.billed}: {{budget.billed}}\n${c.cap}: {{budget.cap}}\n\n${c.button}: {{project.url}}`,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
