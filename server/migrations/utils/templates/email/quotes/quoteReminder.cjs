/**
 * Source-of-truth: quote-reminder-email template.
 *
 * Sent to a client to remind them that an outstanding quote is about to
 * expire. Available in every supported locale; the send path looks the
 * template up in the recipient's resolved locale and falls back to English.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'quote-reminder-email';
const SUBTYPE_NAME = 'Quote Reminder';

const SUBJECTS = {
  en: 'Reminder: Quote {{quote.number}} expires on {{quote.validUntil}}',
  fr: 'Rappel : le devis {{quote.number}} expire le {{quote.validUntil}}',
  es: 'Recordatorio: la cotización {{quote.number}} vence el {{quote.validUntil}}',
  de: 'Erinnerung: Angebot {{quote.number}} läuft am {{quote.validUntil}} ab',
  nl: 'Herinnering: offerte {{quote.number}} verloopt op {{quote.validUntil}}',
  it: 'Promemoria: il preventivo {{quote.number}} scade il {{quote.validUntil}}',
  pl: 'Przypomnienie: wycena {{quote.number}} wygasa {{quote.validUntil}}',
  pt: 'Lembrete: a cotação {{quote.number}} expira em {{quote.validUntil}}',
  sv: 'Påminnelse: Offert {{quote.number}} går ut {{quote.validUntil}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Quote Reminder',
    headerMeta: 'From {{company.name}}',
    greeting: 'Hello,',
    intro: 'This is a reminder that your quote from <strong>{{company.name}}</strong> expires on <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'This is a reminder that your quote from {{company.name}} expires on {{quote.validUntil}}.',
    quoteNumberLabel: 'Quote Number',
    totalLabel: 'Total',
    validUntilLabel: 'Valid Until',
    customMessageLabel: 'Note from {{company.name}}',
    portalLinkLabel: 'Review this quote in the client portal',
    reviewCta: 'Review and approve quote',
    closingNote: 'If you have any questions about this quote, please don\'t hesitate to contact us.',
    thankYou: 'Thank you,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Reminder: Quote {{quote.number}} expires on {{quote.validUntil}}',
    textDetailsHeader: 'Quote Details:',
    textNoteLabel: 'Note',
  },
  fr: {
    headerLabel: 'Rappel de devis',
    headerMeta: 'De {{company.name}}',
    greeting: 'Bonjour,',
    intro: 'Nous vous rappelons que votre devis de <strong>{{company.name}}</strong> expire le <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Nous vous rappelons que votre devis de {{company.name}} expire le {{quote.validUntil}}.',
    quoteNumberLabel: 'Numéro de devis',
    totalLabel: 'Total',
    validUntilLabel: 'Valable jusqu\'au',
    customMessageLabel: 'Message de {{company.name}}',
    portalLinkLabel: 'Consulter ce devis dans le portail client',
    reviewCta: 'Examiner et approuver le devis',
    closingNote: 'Si vous avez des questions concernant ce devis, n\'hésitez pas à nous contacter.',
    thankYou: 'Cordialement,',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Rappel : le devis {{quote.number}} expire le {{quote.validUntil}}',
    textDetailsHeader: 'Détails du devis :',
    textNoteLabel: 'Remarque',
  },
  es: {
    headerLabel: 'Recordatorio de cotización',
    headerMeta: 'De {{company.name}}',
    greeting: 'Hola:',
    intro: 'Le recordamos que su cotización de <strong>{{company.name}}</strong> vence el <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Le recordamos que su cotización de {{company.name}} vence el {{quote.validUntil}}.',
    quoteNumberLabel: 'Número de cotización',
    totalLabel: 'Total',
    validUntilLabel: 'Válida hasta',
    customMessageLabel: 'Mensaje de {{company.name}}',
    portalLinkLabel: 'Revisar esta cotización en el portal de clientes',
    reviewCta: 'Revisar y aprobar la cotización',
    closingNote: 'Si tiene alguna pregunta sobre esta cotización, no dude en contactarnos.',
    thankYou: 'Atentamente,',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Recordatorio: la cotización {{quote.number}} vence el {{quote.validUntil}}',
    textDetailsHeader: 'Detalles de la cotización:',
    textNoteLabel: 'Nota',
  },
  de: {
    headerLabel: 'Angebotserinnerung',
    headerMeta: 'Von {{company.name}}',
    greeting: 'Guten Tag,',
    intro: 'Wir möchten Sie daran erinnern, dass Ihr Angebot von <strong>{{company.name}}</strong> am <strong>{{quote.validUntil}}</strong> abläuft.',
    textIntro: 'Wir möchten Sie daran erinnern, dass Ihr Angebot von {{company.name}} am {{quote.validUntil}} abläuft.',
    quoteNumberLabel: 'Angebotsnummer',
    totalLabel: 'Gesamtbetrag',
    validUntilLabel: 'Gültig bis',
    customMessageLabel: 'Nachricht von {{company.name}}',
    portalLinkLabel: 'Dieses Angebot im Kundenportal ansehen',
    reviewCta: 'Angebot prüfen und genehmigen',
    closingNote: 'Bei Fragen zu diesem Angebot können Sie uns gerne kontaktieren.',
    thankYou: 'Mit freundlichen Grüßen,',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Erinnerung: Angebot {{quote.number}} läuft am {{quote.validUntil}} ab',
    textDetailsHeader: 'Angebotsdetails:',
    textNoteLabel: 'Hinweis',
  },
  nl: {
    headerLabel: 'Offerteherinnering',
    headerMeta: 'Van {{company.name}}',
    greeting: 'Hallo,',
    intro: 'Dit is een herinnering dat uw offerte van <strong>{{company.name}}</strong> verloopt op <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Dit is een herinnering dat uw offerte van {{company.name}} verloopt op {{quote.validUntil}}.',
    quoteNumberLabel: 'Offertenummer',
    totalLabel: 'Totaal',
    validUntilLabel: 'Geldig tot',
    customMessageLabel: 'Bericht van {{company.name}}',
    portalLinkLabel: 'Bekijk deze offerte in het klantenportaal',
    reviewCta: 'Offerte bekijken en goedkeuren',
    closingNote: 'Als u vragen heeft over deze offerte, aarzel dan niet om contact met ons op te nemen.',
    thankYou: 'Met vriendelijke groet,',
    footer: 'Powered by AlgaPSA &middot; Teams op één lijn houden',
    textHeader: 'Herinnering: offerte {{quote.number}} verloopt op {{quote.validUntil}}',
    textDetailsHeader: 'Offertegegevens:',
    textNoteLabel: 'Opmerking',
  },
  it: {
    headerLabel: 'Promemoria preventivo',
    headerMeta: 'Da {{company.name}}',
    greeting: 'Salve,',
    intro: 'Le ricordiamo che il suo preventivo da parte di <strong>{{company.name}}</strong> scade il <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Le ricordiamo che il suo preventivo da parte di {{company.name}} scade il {{quote.validUntil}}.',
    quoteNumberLabel: 'Numero preventivo',
    totalLabel: 'Totale',
    validUntilLabel: 'Valido fino al',
    customMessageLabel: 'Messaggio da {{company.name}}',
    portalLinkLabel: 'Consulta questo preventivo nel portale clienti',
    reviewCta: 'Rivedi e approva il preventivo',
    closingNote: 'Per qualsiasi domanda su questo preventivo, non esiti a contattarci.',
    thankYou: 'Cordiali saluti,',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Promemoria: il preventivo {{quote.number}} scade il {{quote.validUntil}}',
    textDetailsHeader: 'Dettagli del preventivo:',
    textNoteLabel: 'Nota',
  },
  pl: {
    headerLabel: 'Przypomnienie o wycenie',
    headerMeta: 'Od {{company.name}}',
    greeting: 'Dzień dobry,',
    intro: 'Przypominamy, że Państwa wycena od <strong>{{company.name}}</strong> wygasa {{quote.validUntil}}.',
    textIntro: 'Przypominamy, że Państwa wycena od {{company.name}} wygasa {{quote.validUntil}}.',
    quoteNumberLabel: 'Numer wyceny',
    totalLabel: 'Razem',
    validUntilLabel: 'Ważna do',
    customMessageLabel: 'Wiadomość od {{company.name}}',
    portalLinkLabel: 'Zobacz tę wycenę w portalu klienta',
    reviewCta: 'Przejrzyj i zatwierdź wycenę',
    closingNote: 'W razie pytań dotyczących tej wyceny prosimy o kontakt.',
    thankYou: 'Z poważaniem,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Przypomnienie: wycena {{quote.number}} wygasa {{quote.validUntil}}',
    textDetailsHeader: 'Szczegóły wyceny:',
    textNoteLabel: 'Uwaga',
  },
  pt: {
    headerLabel: 'Lembrete de cotação',
    headerMeta: 'De {{company.name}}',
    greeting: 'Olá,',
    intro: 'Este é um lembrete de que a sua cotação de <strong>{{company.name}}</strong> expira em <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Este é um lembrete de que a sua cotação de {{company.name}} expira em {{quote.validUntil}}.',
    quoteNumberLabel: 'Número da cotação',
    totalLabel: 'Total',
    validUntilLabel: 'Válida até',
    customMessageLabel: 'Observação de {{company.name}}',
    portalLinkLabel: 'Consultar esta cotação no portal do cliente',
    reviewCta: 'Revisar e aprovar a cotação',
    closingNote: 'Se tiver alguma dúvida sobre esta cotação, entre em contato conosco.',
    thankYou: 'Atenciosamente,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Lembrete: a cotação {{quote.number}} expira em {{quote.validUntil}}',
    textDetailsHeader: 'Detalhes da cotação:',
    textNoteLabel: 'Observação',
  },
  sv: {
    headerLabel: 'Offertpåminnelse',
    headerMeta: 'Från {{company.name}}',
    greeting: 'Hej,',
    intro: 'Vi påminner dig om att din offert från <strong>{{company.name}}</strong> går ut <strong>{{quote.validUntil}}</strong>.',
    textIntro: 'Vi påminner dig om att din offert från {{company.name}} går ut {{quote.validUntil}}.',
    quoteNumberLabel: 'Offertnummer',
    totalLabel: 'Totalt',
    validUntilLabel: 'Giltig till',
    customMessageLabel: 'Meddelande från {{company.name}}',
    portalLinkLabel: 'Granska denna offert i kundportalen',
    reviewCta: 'Granska och godkänn offert',
    closingNote: 'Kontakta oss om du har några frågor om denna offert.',
    thankYou: 'Med vänliga hälsningar,',
    footer: 'Drivs av AlgaPSA',
    textHeader: 'Påminnelse: Offert {{quote.number}} går ut {{quote.validUntil}}',
    textDetailsHeader: 'Offertdetaljer:',
    textNoteLabel: 'Meddelande',
  },
};
/* eslint-enable max-len */

function linkBlockHtml(c, withReviewLink) {
  const portalBlock = `{{#if portalLink}}
                <p style="margin:24px 0 0 0;font-size:15px;line-height:1.5;"><a href="{{portalLink}}" style="color:${BRAND_PRIMARY};font-weight:600;">${c.portalLinkLabel}</a></p>
                {{/if}}`;
  if (!withReviewLink) {
    return portalBlock;
  }
  // The per-recipient review link is the primary call to action; the portal
  // link is secondary and only present when the recipient has portal access.
  return `{{#if quoteReviewLink}}
                <p style="margin:24px 0 0 0;font-size:15px;line-height:1.5;"><a href="{{quoteReviewLink}}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${BRAND_PRIMARY};color:#ffffff;font-weight:600;text-decoration:none;">${c.reviewCta}</a></p>
                {{#if portalLink}}
                <p style="margin:16px 0 0 0;font-size:14px;line-height:1.5;"><a href="{{portalLink}}" style="color:${BRAND_PRIMARY};">${c.portalLinkLabel}</a></p>
                {{/if}}
                {{else}}
                ${portalBlock}
                {{/if}}`;
}

function buildBodyHtml(c, withReviewLink) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.quoteNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{quote.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.totalLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{quote.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.validUntilLabel}</td>
                    <td style="padding:12px 0;">{{quote.validUntil}}</td>
                  </tr>
                </table>
                {{#if customMessage}}
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.customMessageLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
                </div>
                {{/if}}
                ${linkBlockHtml(c, withReviewLink)}
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.closingNote}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}<br><strong>{{company.name}}</strong></p>`;
}

function linkBlockText(c, withReviewLink) {
  const portalBlock = `{{#if portalLink}}
${c.portalLinkLabel}: {{portalLink}}
{{/if}}`;
  if (!withReviewLink) {
    return portalBlock;
  }
  return `{{#if quoteReviewLink}}
${c.reviewCta}: {{quoteReviewLink}}
{{#if portalLink}}
${c.portalLinkLabel}: {{portalLink}}
{{/if}}
{{else}}
${portalBlock}
{{/if}}`;
}

function buildText(c, withReviewLink) {
  return `${c.textHeader}

${c.greeting}

${c.textIntro}

${c.textDetailsHeader}
- ${c.quoteNumberLabel}: {{quote.number}}
- ${c.totalLabel}: {{quote.amount}}
- ${c.validUntilLabel}: {{quote.validUntil}}

{{#if customMessage}}
${c.textNoteLabel}: {{customMessage}}
{{/if}}
${linkBlockText(c, withReviewLink)}

${c.closingNote}

${c.thankYou}
{{company.name}}`;
}

/**
 * @param {{ reviewLink?: boolean }} [options] reviewLink (default true) adds the
 *   per-recipient `quoteReviewLink` call to action. `false` reproduces the
 *   pre-review-link bodies exactly (used by the migration's down()).
 */
function getTemplate({ reviewLink = true } = {}) {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: SUBJECTS[lang],
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        headerTitle: '{{quote.number}}',
        headerMeta: copy.headerMeta,
        bodyHtml: buildBodyHtml(copy, reviewLink),
        footerText: copy.footer,
      }),
      textContent: buildText(copy, reviewLink),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
