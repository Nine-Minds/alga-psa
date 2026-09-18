const { COPY, buildBodyHtml, buildText } = require('./surveyTicketClosed.cjs');
const TEMPLATE_NAME = 'SURVEY_PROJECT_CLOSED';
const SUBTYPE_NAME = 'survey-project-closed';
const PROJECT_COPY = {
  en: ["We'd love your feedback on project {{project_number}}", 'Project'],
  fr: ['Votre avis sur le projet {{project_number}} nous intéresse', 'Projet'],
  es: ['Queremos conocer su opinión sobre el proyecto {{project_number}}', 'Proyecto'],
  de: ['Wir freuen uns über Ihr Feedback zu Projekt {{project_number}}', 'Projekt'],
  nl: ['We horen graag uw feedback over project {{project_number}}', 'Project'],
  it: ['Ci farebbe piacere il tuo feedback sul progetto {{project_number}}', 'Progetto'],
  pl: ['Chętnie poznamy Twoją opinię o projekcie {{project_number}}', 'Projekt'],
  pt: ['Queremos sua opinião sobre o projeto {{project_number}}', 'Projeto'],
};
function getTemplate() {
  return {
    templateName: TEMPLATE_NAME, subtypeName: SUBTYPE_NAME,
    translations: Object.entries(PROJECT_COPY).map(([language, [subject, label]]) => {
      const copy = { ...COPY[language],
        summary: `${label} #{{project_number}} · {{project_name}}`,
        ticketLabel: label, subjectNumber: '{{project_number}}', closedAt: '{{project_closed_at}}',
      };
      return { language, subject, htmlContent: buildBodyHtml(language, copy, subject), textContent: buildText(copy, subject) };
    }),
  };
}
module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
