'use strict';

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-budget-exceeded';
const SUBTYPE_NAME = 'Project Budget Exceeded';

const COPY = {
  en: { subject: 'Project budget exceeded: {{project.name}}', label: 'Project Budget Exceeded', intro: 'New billable work exceeded this project’s hard budget cap. The excess was written down.', billed: 'Billed', cap: 'Budget cap', writtenDown: 'Written down', button: 'Review project', footer: 'Powered by Alga PSA' },
  fr: { subject: 'Budget du projet dépassé : {{project.name}}', label: 'Budget du projet dépassé', intro: 'De nouveaux travaux facturables ont dépassé le plafond budgétaire ferme de ce projet. L’excédent a été déprécié.', billed: 'Facturé', cap: 'Plafond budgétaire', writtenDown: 'Déprécié', button: 'Examiner le projet', footer: 'Propulsé par Alga PSA' },
  es: { subject: 'Presupuesto del proyecto superado: {{project.name}}', label: 'Presupuesto del proyecto superado', intro: 'El nuevo trabajo facturable superó el límite presupuestario estricto de este proyecto. El exceso se dio de baja.', billed: 'Facturado', cap: 'Límite presupuestario', writtenDown: 'Dado de baja', button: 'Revisar proyecto', footer: 'Desarrollado por Alga PSA' },
  de: { subject: 'Projektbudget überschritten: {{project.name}}', label: 'Projektbudget überschritten', intro: 'Neue abrechenbare Arbeit hat die feste Budgetobergrenze dieses Projekts überschritten. Der Überschuss wurde abgeschrieben.', billed: 'Abgerechnet', cap: 'Budgetobergrenze', writtenDown: 'Abgeschrieben', button: 'Projekt prüfen', footer: 'Bereitgestellt von Alga PSA' },
  nl: { subject: 'Projectbudget overschreden: {{project.name}}', label: 'Projectbudget overschreden', intro: 'Nieuw factureerbaar werk heeft de harde budgetlimiet van dit project overschreden. Het meerdere is afgeschreven.', billed: 'Gefactureerd', cap: 'Budgetlimiet', writtenDown: 'Afgeschreven', button: 'Project bekijken', footer: 'Mogelijk gemaakt door Alga PSA' },
  it: { subject: 'Budget del progetto superato: {{project.name}}', label: 'Budget del progetto superato', intro: 'Il nuovo lavoro fatturabile ha superato il limite rigido di budget del progetto. L’eccedenza è stata svalutata.', billed: 'Fatturato', cap: 'Limite di budget', writtenDown: 'Svalutato', button: 'Rivedi progetto', footer: 'Powered by Alga PSA' },
  pl: { subject: 'Przekroczono budżet projektu: {{project.name}}', label: 'Przekroczono budżet projektu', intro: 'Nowa praca podlegająca rozliczeniu przekroczyła twardy limit budżetu projektu. Nadwyżka została odpisana.', billed: 'Zafakturowano', cap: 'Limit budżetu', writtenDown: 'Odpisano', button: 'Sprawdź projekt', footer: 'Powered by Alga PSA' },
  pt: { subject: 'Orçamento do projeto excedido: {{project.name}}', label: 'Orçamento do projeto excedido', intro: 'Novo trabalho faturável excedeu o limite rígido de orçamento deste projeto. O excesso foi baixado.', billed: 'Faturado', cap: 'Limite do orçamento', writtenDown: 'Baixado', button: 'Revisar projeto', footer: 'Desenvolvido por Alga PSA' },
};

function body(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.billed}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{budget.billed}}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.cap}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{budget.cap}}</td></tr>
      <tr><td style="padding:10px 0;font-weight:600;color:#475467;">${c.writtenDown}</td><td style="padding:10px 0;">{{budget.writtenDown}}</td></tr>
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
      textContent: `${c.label}\n\n${c.intro}\n\n${c.billed}: {{budget.billed}}\n${c.cap}: {{budget.cap}}\n${c.writtenDown}: {{budget.writtenDown}}\n\n${c.button}: {{project.url}}`,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
