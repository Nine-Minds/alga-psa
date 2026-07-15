const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-milestone-ready';
const SUBTYPE_NAME = 'Project Milestone Ready';

const COPY = {
  en: { subject: 'Ready to bill: {{entry.description}}', label: 'Milestone Ready', intro: 'A project schedule entry is ready for billing.', entry: 'Schedule entry', amount: 'Amount', trigger: 'Trigger', button: 'Review project', footer: 'Powered by Alga PSA' },
  fr: { subject: 'Prêt à facturer : {{entry.description}}', label: 'Jalon prêt', intro: 'Une entrée du calendrier du projet est prête à être facturée.', entry: 'Entrée du calendrier', amount: 'Montant', trigger: 'Déclencheur', button: 'Examiner le projet', footer: 'Propulsé par Alga PSA' },
  es: { subject: 'Listo para facturar: {{entry.description}}', label: 'Hito listo', intro: 'Una entrada del calendario del proyecto está lista para facturarse.', entry: 'Entrada del calendario', amount: 'Importe', trigger: 'Desencadenador', button: 'Revisar proyecto', footer: 'Desarrollado por Alga PSA' },
  de: { subject: 'Bereit zur Abrechnung: {{entry.description}}', label: 'Meilenstein bereit', intro: 'Ein Eintrag im Projektzahlungsplan ist zur Abrechnung bereit.', entry: 'Planeintrag', amount: 'Betrag', trigger: 'Auslöser', button: 'Projekt prüfen', footer: 'Bereitgestellt von Alga PSA' },
  nl: { subject: 'Klaar om te factureren: {{entry.description}}', label: 'Mijlpaal klaar', intro: 'Een item in het projectfacturatieschema is klaar voor facturering.', entry: 'Schema-item', amount: 'Bedrag', trigger: 'Trigger', button: 'Project bekijken', footer: 'Mogelijk gemaakt door Alga PSA' },
  it: { subject: 'Pronto per la fatturazione: {{entry.description}}', label: 'Milestone pronta', intro: 'Una voce del piano di fatturazione del progetto è pronta.', entry: 'Voce del piano', amount: 'Importo', trigger: 'Attivazione', button: 'Rivedi progetto', footer: 'Powered by Alga PSA' },
  pl: { subject: 'Gotowe do rozliczenia: {{entry.description}}', label: 'Kamień milowy gotowy', intro: 'Pozycja harmonogramu projektu jest gotowa do rozliczenia.', entry: 'Pozycja harmonogramu', amount: 'Kwota', trigger: 'Wyzwalacz', button: 'Sprawdź projekt', footer: 'Powered by Alga PSA' },
  pt: { subject: 'Pronto para faturar: {{entry.description}}', label: 'Marco pronto', intro: 'Uma entrada do cronograma do projeto está pronta para faturamento.', entry: 'Entrada do cronograma', amount: 'Valor', trigger: 'Gatilho', button: 'Revisar projeto', footer: 'Desenvolvido por Alga PSA' },
};

function body(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.entry}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{entry.description}}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amount}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{entry.amount}}</td></tr>
      <tr><td style="padding:10px 0;font-weight:600;color:#475467;">${c.trigger}</td><td style="padding:10px 0;">{{entry.trigger}}</td></tr>
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
      htmlContent: wrapEmailLayout({ language, headerLabel: c.label, headerTitle: '{{entry.description}}', headerMeta: '{{project.name}} {{project.number}}', bodyHtml: body(c), footerText: c.footer }),
      textContent: `${c.label}\n\n${c.intro}\n\n${c.entry}: {{entry.description}}\n${c.amount}: {{entry.amount}}\n${c.trigger}: {{entry.trigger}}\n\n${c.button}: {{project.url}}`,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
