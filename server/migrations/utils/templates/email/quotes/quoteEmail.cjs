/**
 * Source-of-truth: quote-email template.
 *
 * Sent to a client when a quote is sent or resent, with the quote PDF
 * attached. Available in every supported locale; the send path looks the
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

const TEMPLATE_NAME = 'quote-email';
const SUBTYPE_NAME = 'Quote Email';

const SUBJECTS = {
  en: 'Quote {{quote.number}} from {{company.name}}',
  fr: 'Devis {{quote.number}} de {{company.name}}',
  es: 'Presupuesto {{quote.number}} de {{company.name}}',
  de: 'Angebot {{quote.number}} von {{company.name}}',
  nl: 'Offerte {{quote.number}} van {{company.name}}',
  it: 'Preventivo {{quote.number}} da {{company.name}}',
  pl: 'Oferta {{quote.number}} od {{company.name}}',
  pt: 'Orçamento {{quote.number}} de {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Quote',
    headerMeta: 'From {{company.name}}',
    greeting: 'Hello,',
    intro: 'Your quote is attached and ready for review from <strong>{{company.name}}</strong>.',
    textIntro: 'Your quote is attached and ready for review from {{company.name}}.',
    quoteNumberLabel: 'Quote Number',
    totalLabel: 'Total',
    validUntilLabel: 'Valid Until',
    customMessageLabel: 'Note from {{company.name}}',
    portalLinkLabel: 'Review this quote in the client portal',
    attachmentNote: 'The quote is attached to this email as a PDF. If you have any questions, please don\'t hesitate to contact us.',
    thankYou: 'Thank you,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Quote {{quote.number}} from {{company.name}}',
    textDetailsHeader: 'Quote Details:',
    textNoteLabel: 'Note',
  },
  fr: {
    headerLabel: 'Devis',
    headerMeta: 'De {{company.name}}',
    greeting: 'Bonjour,',
    intro: 'Votre devis de <strong>{{company.name}}</strong> est joint et prêt à être consulté.',
    textIntro: 'Votre devis de {{company.name}} est joint et prêt à être consulté.',
    quoteNumberLabel: 'Numéro de devis',
    totalLabel: 'Total',
    validUntilLabel: 'Valable jusqu\'au',
    customMessageLabel: 'Message de {{company.name}}',
    portalLinkLabel: 'Consulter ce devis dans le portail client',
    attachmentNote: 'Le devis est joint à cet e-mail au format PDF. Si vous avez des questions, n\'hésitez pas à nous contacter.',
    thankYou: 'Cordialement,',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Devis {{quote.number}} de {{company.name}}',
    textDetailsHeader: 'Détails du devis :',
    textNoteLabel: 'Remarque',
  },
  es: {
    headerLabel: 'Presupuesto',
    headerMeta: 'De {{company.name}}',
    greeting: 'Hola:',
    intro: 'Su presupuesto de <strong>{{company.name}}</strong> está adjunto y listo para su revisión.',
    textIntro: 'Su presupuesto de {{company.name}} está adjunto y listo para su revisión.',
    quoteNumberLabel: 'Número de presupuesto',
    totalLabel: 'Total',
    validUntilLabel: 'Válido hasta',
    customMessageLabel: 'Mensaje de {{company.name}}',
    portalLinkLabel: 'Revisar este presupuesto en el portal de clientes',
    attachmentNote: 'El presupuesto está adjunto a este correo en formato PDF. Si tiene alguna pregunta, no dude en contactarnos.',
    thankYou: 'Atentamente,',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Presupuesto {{quote.number}} de {{company.name}}',
    textDetailsHeader: 'Detalles del presupuesto:',
    textNoteLabel: 'Nota',
  },
  de: {
    headerLabel: 'Angebot',
    headerMeta: 'Von {{company.name}}',
    greeting: 'Guten Tag,',
    intro: 'Ihr Angebot von <strong>{{company.name}}</strong> ist beigefügt und steht zur Prüfung bereit.',
    textIntro: 'Ihr Angebot von {{company.name}} ist beigefügt und steht zur Prüfung bereit.',
    quoteNumberLabel: 'Angebotsnummer',
    totalLabel: 'Gesamtbetrag',
    validUntilLabel: 'Gültig bis',
    customMessageLabel: 'Nachricht von {{company.name}}',
    portalLinkLabel: 'Dieses Angebot im Kundenportal ansehen',
    attachmentNote: 'Das Angebot ist dieser E-Mail als PDF beigefügt. Bei Fragen können Sie uns gerne kontaktieren.',
    thankYou: 'Mit freundlichen Grüßen,',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Angebot {{quote.number}} von {{company.name}}',
    textDetailsHeader: 'Angebotsdetails:',
    textNoteLabel: 'Hinweis',
  },
  nl: {
    headerLabel: 'Offerte',
    headerMeta: 'Van {{company.name}}',
    greeting: 'Hallo,',
    intro: 'Uw offerte van <strong>{{company.name}}</strong> is bijgevoegd en klaar om te bekijken.',
    textIntro: 'Uw offerte van {{company.name}} is bijgevoegd en klaar om te bekijken.',
    quoteNumberLabel: 'Offertenummer',
    totalLabel: 'Totaal',
    validUntilLabel: 'Geldig tot',
    customMessageLabel: 'Bericht van {{company.name}}',
    portalLinkLabel: 'Bekijk deze offerte in het klantenportaal',
    attachmentNote: 'De offerte is als PDF bij deze e-mail gevoegd. Mocht u vragen hebben, aarzel dan niet om contact met ons op te nemen.',
    thankYou: 'Met vriendelijke groet,',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Offerte {{quote.number}} van {{company.name}}',
    textDetailsHeader: 'Offertegegevens:',
    textNoteLabel: 'Opmerking',
  },
  it: {
    headerLabel: 'Preventivo',
    headerMeta: 'Da {{company.name}}',
    greeting: 'Salve,',
    intro: 'Il suo preventivo da parte di <strong>{{company.name}}</strong> è in allegato e pronto per la revisione.',
    textIntro: 'Il suo preventivo da parte di {{company.name}} è in allegato e pronto per la revisione.',
    quoteNumberLabel: 'Numero preventivo',
    totalLabel: 'Totale',
    validUntilLabel: 'Valido fino al',
    customMessageLabel: 'Messaggio da {{company.name}}',
    portalLinkLabel: 'Consulta questo preventivo nel portale clienti',
    attachmentNote: 'Il preventivo è allegato a questa email in formato PDF. Per qualsiasi domanda, non esiti a contattarci.',
    thankYou: 'Cordiali saluti,',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Preventivo {{quote.number}} da {{company.name}}',
    textDetailsHeader: 'Dettagli del preventivo:',
    textNoteLabel: 'Nota',
  },
  pl: {
    headerLabel: 'Oferta',
    headerMeta: 'Od {{company.name}}',
    greeting: 'Dzień dobry,',
    intro: 'W załączeniu przesyłamy Państwa ofertę od <strong>{{company.name}}</strong> do zapoznania się.',
    textIntro: 'W załączeniu przesyłamy Państwa ofertę od {{company.name}} do zapoznania się.',
    quoteNumberLabel: 'Numer oferty',
    totalLabel: 'Razem',
    validUntilLabel: 'Ważna do',
    customMessageLabel: 'Wiadomość od {{company.name}}',
    portalLinkLabel: 'Zobacz tę ofertę w portalu klienta',
    attachmentNote: 'Oferta jest załączona do tej wiadomości w formacie PDF. W razie pytań prosimy o kontakt.',
    thankYou: 'Z poważaniem,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Oferta {{quote.number}} od {{company.name}}',
    textDetailsHeader: 'Szczegóły oferty:',
    textNoteLabel: 'Uwaga',
  },
  pt: {
    headerLabel: 'Orçamento',
    headerMeta: 'De {{company.name}}',
    greeting: 'Olá,',
    intro: 'Segue em anexo o seu orçamento de <strong>{{company.name}}</strong>, pronto para análise.',
    textIntro: 'Segue em anexo o seu orçamento de {{company.name}}, pronto para análise.',
    quoteNumberLabel: 'Número do orçamento',
    totalLabel: 'Total',
    validUntilLabel: 'Válido até',
    customMessageLabel: 'Observação de {{company.name}}',
    portalLinkLabel: 'Consultar este orçamento no portal do cliente',
    attachmentNote: 'O orçamento está anexado a este email como PDF. Se tiver alguma dúvida, entre em contato conosco.',
    thankYou: 'Atenciosamente,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Orçamento {{quote.number}} de {{company.name}}',
    textDetailsHeader: 'Detalhes do orçamento:',
    textNoteLabel: 'Observação',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
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
                {{#if portalLink}}
                <p style="margin:24px 0 0 0;font-size:15px;line-height:1.5;"><a href="{{portalLink}}" style="color:${BRAND_PRIMARY};font-weight:600;">${c.portalLinkLabel}</a></p>
                {{/if}}
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.attachmentNote}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}<br><strong>{{company.name}}</strong></p>`;
}

function buildText(c) {
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
{{#if portalLink}}
${c.portalLinkLabel}: {{portalLink}}
{{/if}}

${c.attachmentNote}

${c.thankYou}
{{company.name}}`;
}

function getTemplate() {
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
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
