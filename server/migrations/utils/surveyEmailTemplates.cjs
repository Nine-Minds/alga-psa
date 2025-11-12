const SURVEY_TEMPLATE_NAME = 'SURVEY_TICKET_CLOSED';
const SURVEY_SUBTYPE_NAME = 'survey-ticket-closed';
const SURVEY_CATEGORY_NAME = 'Surveys';

const SURVEY_TEMPLATE_TRANSLATIONS = [
  {
    language: 'en',
    subject: "We'd love your feedback on ticket {{ticket_number}}",
    salutation: 'Hi {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Technician: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Choose a score below to let us know how we did:',
    fallback: 'If the buttons do not load, open this secure survey link:',
    thankYou: '{{thank_you_text}}',
  },
  {
    language: 'fr',
    subject: 'Votre avis sur le ticket {{ticket_number}} nous intéresse',
    salutation: 'Bonjour {{contact_name}},',
    summary: 'Ticket n°{{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Technicien : {{technicien_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Sélectionnez une note ci-dessous pour nous donner votre avis :',
    fallback: "Si les boutons ne s'affichent pas correctement, utilisez ce lien sécurisé :",
    thankYou: '{{thank_you_text}}',
  },
  {
    language: 'es',
    subject: 'Queremos conocer tu opinión sobre el ticket {{ticket_number}}',
    salutation: 'Hola {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Técnico: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Elige una calificación para contarnos cómo fue tu experiencia:',
    fallback: 'Si los botones no funcionan, abre este enlace seguro de la encuesta:',
    thankYou: '{{thank_you_text}}',
  },
  {
    language: 'de',
    subject: 'Wir freuen uns über Ihr Feedback zu Ticket {{ticket_number}}',
    salutation: 'Hallo {{contact_name}},',
    summary: 'Ticket Nr. {{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Techniker: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Wählen Sie unten eine Bewertung, um uns Ihr Erlebnis mitzuteilen:',
    fallback: 'Wenn die Schaltflächen nicht funktionieren, öffnen Sie diesen sicheren Link:',
    thankYou: '{{thank_you_text}}',
  },
  {
    language: 'nl',
    subject: 'We horen graag uw feedback over ticket {{ticket_number}}',
    salutation: 'Hallo {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Technicus: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Kies hieronder een score om te laten weten hoe wij het hebben gedaan:',
    fallback: 'Werken de knoppen niet? Gebruik dan deze beveiligde link:',
    thankYou: '{{thank_you_text}}',
  },
  {
    language: 'it',
    subject: 'Ci farebbe piacere il tuo feedback sul ticket {{ticket_number}}',
    salutation: 'Ciao {{contact_name}},',
    summary: 'Ticket n. {{ticket_number}} · {{ticket_subject}}',
    technicianLine: 'Tecnico: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Scegli una valutazione qui sotto per dirci com’è andata:',
    fallback: 'Se i pulsanti non funzionano, apri questo link sicuro:',
    thankYou: '{{thank_you_text}}',
  },
];

function buildSurveyHtmlTemplate(copy) {
  return `
<!DOCTYPE html>
<html lang="${copy.language}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${copy.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;font-weight:600;">${copy.subject}</h1>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">${copy.summary}</p>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">${copy.technicianLine}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:16px;">${copy.salutation}</p>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">${copy.ratingIntro}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#475569;">${copy.buttonHelp}</p>
              <div style="text-align:center;margin:24px 0;">
                {{rating_buttons_html}}
              </div>
              <div style="background-color:#f1f5f9;border-radius:10px;padding:16px 20px;margin:24px 0;">
                <p style="margin:0;font-size:14px;color:#475569;">${copy.fallback}</p>
                <p style="margin:12px 0 0 0;font-size:14px;color:#2563eb;word-break:break-all;">
                  <a href="{{survey_url}}" style="color:#2563eb;text-decoration:none;">{{survey_url}}</a>
                </p>
              </div>
              <p style="margin:0 0 20px 0;font-size:14px;color:#475569;white-space:pre-line;">{{rating_links_text}}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;">${copy.thankYou}</p>
              <p style="margin:20px 0 0 0;font-size:12px;color:#94a3b8;">
                {{tenant_name}} · Ticket #{{ticket_number}} · {{ticket_closed_at}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

function buildSurveyTextTemplate(copy) {
  return `
${copy.subject}

${copy.salutation}
${copy.summary}
${copy.technicianLine}

${copy.ratingIntro}
${copy.buttonHelp}

${copy.fallback}
{{rating_links_text}}

${copy.thankYou}

{{tenant_name}} · Ticket #{{ticket_number}} · {{ticket_closed_at}}
`.trim();
}

module.exports = {
  SURVEY_TEMPLATE_NAME,
  SURVEY_SUBTYPE_NAME,
  SURVEY_CATEGORY_NAME,
  SURVEY_TEMPLATE_TRANSLATIONS,
  buildSurveyHtmlTemplate,
  buildSurveyTextTemplate,
};
