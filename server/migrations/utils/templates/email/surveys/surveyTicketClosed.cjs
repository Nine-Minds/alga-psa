/**
 * Source-of-truth: survey-ticket-closed email template.
 *
 * This template has its own HTML structure (not using the shared emailLayout)
 * because the survey email has a unique layout with inline rating buttons and
 * a fallback survey link.
 *
 * Supports all 7 languages: en, fr, es, de, nl, it, pl.
 */

const TEMPLATE_NAME = 'SURVEY_TICKET_CLOSED';
const SUBTYPE_NAME = 'survey-ticket-closed';
const SURVEY_CATEGORY_NAME = 'Surveys';

const SUBJECTS = {
  en: "We'd love your feedback on ticket {{ticket_number}}",
  fr: 'Votre avis sur le ticket {{ticket_number}} nous int\u00e9resse',
  es: 'Queremos conocer tu opini\u00f3n sobre el ticket {{ticket_number}}',
  de: 'Wir freuen uns \u00fcber Ihr Feedback zu Ticket {{ticket_number}}',
  nl: 'We horen graag uw feedback over ticket {{ticket_number}}',
  it: 'Ci farebbe piacere il tuo feedback sul ticket {{ticket_number}}',
  pl: 'Ch\u0119tnie poznamy Twoj\u0105 opini\u0119 o zg\u0142oszeniu {{ticket_number}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    salutation: 'Hi {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Technician: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Choose a score below to let us know how we did:',
    fallback: 'If the buttons do not load, open this secure survey link:',
    thankYou: '{{thank_you_text}}',
  },
  fr: {
    salutation: 'Bonjour {{contact_name}},',
    summary: 'Ticket n\u00b0{{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Technicien : {{technicien_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'S\u00e9lectionnez une note ci-dessous pour nous donner votre avis :',
    fallback: "Si les boutons ne s'affichent pas correctement, utilisez ce lien s\u00e9curis\u00e9 :",
    thankYou: '{{thank_you_text}}',
  },
  es: {
    salutation: 'Hola {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'T\u00e9cnico: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Elige una calificaci\u00f3n para contarnos c\u00f3mo fue tu experiencia:',
    fallback: 'Si los botones no funcionan, abre este enlace seguro de la encuesta:',
    thankYou: '{{thank_you_text}}',
  },
  de: {
    salutation: 'Hallo {{contact_name}},',
    summary: 'Ticket Nr. {{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Techniker: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'W\u00e4hlen Sie unten eine Bewertung, um uns Ihr Erlebnis mitzuteilen:',
    fallback: 'Wenn die Schaltfl\u00e4chen nicht funktionieren, \u00f6ffnen Sie diesen sicheren Link:',
    thankYou: '{{thank_you_text}}',
  },
  nl: {
    salutation: 'Hallo {{contact_name}},',
    summary: 'Ticket #{{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Technicus: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Kies hieronder een score om te laten weten hoe wij het hebben gedaan:',
    fallback: 'Werken de knoppen niet? Gebruik dan deze beveiligde link:',
    thankYou: '{{thank_you_text}}',
  },
  it: {
    salutation: 'Ciao {{contact_name}},',
    summary: 'Ticket n. {{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Tecnico: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: "Scegli una valutazione qui sotto per dirci com\u2019\u00e8 andata:",
    fallback: 'Se i pulsanti non funzionano, apri questo link sicuro:',
    thankYou: '{{thank_you_text}}',
  },
  pl: {
    salutation: 'Cze\u015b\u0107 {{contact_name}},',
    summary: 'Zg\u0142oszenie #{{ticket_number}} \u00b7 {{ticket_subject}}',
    technicianLine: 'Technik: {{technician_name}}',
    ratingIntro: '{{prompt_text}}',
    buttonHelp: 'Wybierz ocen\u0119 poni\u017cej, aby da\u0107 nam zna\u0107, jak nam posz\u0142o:',
    fallback: 'Je\u015bli przyciski si\u0119 nie za\u0142aduj\u0105, otw\u00f3rz ten bezpieczny link do ankiety:',
    thankYou: '{{thank_you_text}}',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(lang, c, subject) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#8A4DEA,#40CFF9);padding:28px 32px;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;font-weight:600;">${subject}</h1>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">${c.summary}</p>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.85;">${c.technicianLine}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:16px;">${c.salutation}</p>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">${c.ratingIntro}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#475569;">${c.buttonHelp}</p>
              <div style="text-align:center;margin:24px 0;">
                {{rating_buttons_html}}
              </div>
              <div style="background-color:#f1f5f9;border-radius:10px;padding:16px 20px;margin:24px 0;">
                <p style="margin:0;font-size:14px;color:#475569;">${c.fallback}</p>
                <p style="margin:12px 0 0 0;font-size:14px;color:#2563eb;word-break:break-all;">
                  <a href="{{survey_url}}" style="color:#2563eb;text-decoration:none;">{{survey_url}}</a>
                </p>
              </div>
              <p style="margin:0 0 20px 0;font-size:14px;color:#475569;white-space:pre-line;">{{rating_links_text}}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;">${c.thankYou}</p>
              <p style="margin:20px 0 0 0;font-size:12px;color:#94a3b8;">
                {{tenant_name}} \u00b7 Ticket #{{ticket_number}} \u00b7 {{ticket_closed_at}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(c, subject) {
  return `${subject}

${c.salutation}
${c.summary}
${c.technicianLine}

${c.ratingIntro}
${c.buttonHelp}

${c.fallback}
{{rating_links_text}}

${c.thankYou}

{{tenant_name}} \u00b7 Ticket #{{ticket_number}} \u00b7 {{ticket_closed_at}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: SUBJECTS[lang],
      htmlContent: buildBodyHtml(lang, copy, SUBJECTS[lang]),
      textContent: buildText(copy, SUBJECTS[lang]),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, SURVEY_CATEGORY_NAME, getTemplate };
