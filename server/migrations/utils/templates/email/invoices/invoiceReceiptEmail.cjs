/**
 * Source-of-truth: invoice-receipt-email template.
 *
 * Sent instead of invoice-email when the MSP emails an invoice that is already
 * paid: the message says so and carries no payment call to action. Same locales
 * and layout as invoice-email.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'invoice-receipt-email';
// Shares the invoice-email notification subtype; no new subtype is created.
const SUBTYPE_NAME = 'Invoice Email';

const SUBJECTS = {
  en: 'Receipt for paid invoice {{invoice.number}} from {{company.name}}',
  fr: 'Reçu pour la facture payée {{invoice.number}} de {{company.name}}',
  es: 'Recibo de la factura pagada {{invoice.number}} de {{company.name}}',
  de: 'Zahlungsbeleg für die bezahlte Rechnung {{invoice.number}} von {{company.name}}',
  nl: 'Betalingsbewijs voor betaalde factuur {{invoice.number}} van {{company.name}}',
  it: 'Ricevuta per la fattura pagata {{invoice.number}} da {{company.name}}',
  pl: 'Potwierdzenie zapłaty faktury {{invoice.number}} od {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Receipt',
    greeting: 'Dear {{recipient.name}},',
    intro: 'Invoice {{invoice.number}} from <strong>{{company.name}}</strong> has been paid. Thank you! Your receipt is attached.',
    textIntro: 'Invoice {{invoice.number}} from {{company.name}} has been paid. Thank you! Your receipt is attached.',
    invoiceNumberLabel: 'Invoice Number',
    amountLabel: 'Amount Paid',
    invoiceDateLabel: 'Invoice Date',
    customMessageLabel: 'Note from {{company.name}}',
    attachmentNote: 'The invoice marked as paid is attached to this email as a PDF. If you have any questions, please don\'t hesitate to contact us.',
    thankYou: 'Thank you for your business!',
    bestRegards: 'Best regards,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Receipt for invoice {{invoice.number}} from {{company.name}}',
    textDetailsHeader: 'Invoice Details:',
    headerMeta: 'From {{company.name}}',
    textNoteLabel: 'Note',
  },
  fr: {
    headerLabel: 'Reçu',
    greeting: 'Cher/Chère {{recipient.name}},',
    intro: 'La facture {{invoice.number}} de <strong>{{company.name}}</strong> a été payée. Merci ! Votre reçu est joint.',
    textIntro: 'La facture {{invoice.number}} de {{company.name}} a été payée. Merci ! Votre reçu est joint.',
    invoiceNumberLabel: 'Numéro de facture',
    amountLabel: 'Montant payé',
    invoiceDateLabel: 'Date de facturation',
    customMessageLabel: 'Message de {{company.name}}',
    attachmentNote: 'La facture acquittée est jointe à cet e-mail au format PDF. Si vous avez des questions, n\'hésitez pas à nous contacter.',
    thankYou: 'Merci pour votre confiance !',
    bestRegards: 'Cordialement,',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Reçu pour la facture {{invoice.number}} de {{company.name}}',
    textDetailsHeader: 'Détails de la facture :',
    headerMeta: 'De {{company.name}}',
    textNoteLabel: 'Note',
  },
  es: {
    headerLabel: 'Recibo',
    greeting: 'Estimado/a {{recipient.name}}:',
    intro: 'La factura {{invoice.number}} de <strong>{{company.name}}</strong> ha sido pagada. ¡Gracias! Adjuntamos su recibo.',
    textIntro: 'La factura {{invoice.number}} de {{company.name}} ha sido pagada. ¡Gracias! Adjuntamos su recibo.',
    invoiceNumberLabel: 'Número de factura',
    amountLabel: 'Importe pagado',
    invoiceDateLabel: 'Fecha de factura',
    customMessageLabel: 'Nota de {{company.name}}',
    attachmentNote: 'La factura marcada como pagada se adjunta a este correo en formato PDF. Si tiene alguna pregunta, no dude en contactarnos.',
    thankYou: '¡Gracias por su confianza!',
    bestRegards: 'Saludos cordiales,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Recibo de la factura {{invoice.number}} de {{company.name}}',
    textDetailsHeader: 'Detalles de la factura:',
    headerMeta: 'De {{company.name}}',
    textNoteLabel: 'Nota',
  },
  de: {
    headerLabel: 'Zahlungsbeleg',
    greeting: 'Sehr geehrte/r {{recipient.name}},',
    intro: 'Die Rechnung {{invoice.number}} von <strong>{{company.name}}</strong> wurde bezahlt. Vielen Dank! Ihr Zahlungsbeleg ist angehängt.',
    textIntro: 'Die Rechnung {{invoice.number}} von {{company.name}} wurde bezahlt. Vielen Dank! Ihr Zahlungsbeleg ist angehängt.',
    invoiceNumberLabel: 'Rechnungsnummer',
    amountLabel: 'Bezahlter Betrag',
    invoiceDateLabel: 'Rechnungsdatum',
    customMessageLabel: 'Nachricht von {{company.name}}',
    attachmentNote: 'Die als bezahlt gekennzeichnete Rechnung ist dieser E-Mail als PDF beigefügt. Bei Fragen melden Sie sich gerne bei uns.',
    thankYou: 'Vielen Dank für Ihr Vertrauen!',
    bestRegards: 'Mit freundlichen Grüßen,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Zahlungsbeleg für Rechnung {{invoice.number}} von {{company.name}}',
    textDetailsHeader: 'Rechnungsdetails:',
    headerMeta: 'Von {{company.name}}',
    textNoteLabel: 'Hinweis',
  },
  nl: {
    headerLabel: 'Betalingsbewijs',
    greeting: 'Geachte {{recipient.name}},',
    intro: 'Factuur {{invoice.number}} van <strong>{{company.name}}</strong> is betaald. Bedankt! Uw betalingsbewijs is bijgevoegd.',
    textIntro: 'Factuur {{invoice.number}} van {{company.name}} is betaald. Bedankt! Uw betalingsbewijs is bijgevoegd.',
    invoiceNumberLabel: 'Factuurnummer',
    amountLabel: 'Betaald bedrag',
    invoiceDateLabel: 'Factuurdatum',
    customMessageLabel: 'Bericht van {{company.name}}',
    attachmentNote: 'De als betaald gemarkeerde factuur is als pdf bij deze e-mail gevoegd. Heeft u vragen, neem dan gerust contact met ons op.',
    thankYou: 'Bedankt voor uw vertrouwen!',
    bestRegards: 'Met vriendelijke groet,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Betalingsbewijs voor factuur {{invoice.number}} van {{company.name}}',
    textDetailsHeader: 'Factuurgegevens:',
    headerMeta: 'Van {{company.name}}',
    textNoteLabel: 'Opmerking',
  },
  it: {
    headerLabel: 'Ricevuta',
    greeting: 'Gentile {{recipient.name}},',
    intro: 'La fattura {{invoice.number}} di <strong>{{company.name}}</strong> è stata pagata. Grazie! In allegato trova la ricevuta.',
    textIntro: 'La fattura {{invoice.number}} di {{company.name}} è stata pagata. Grazie! In allegato trova la ricevuta.',
    invoiceNumberLabel: 'Numero fattura',
    amountLabel: 'Importo pagato',
    invoiceDateLabel: 'Data fattura',
    customMessageLabel: 'Nota di {{company.name}}',
    attachmentNote: 'La fattura contrassegnata come pagata è allegata a questa e-mail in formato PDF. Per qualsiasi domanda, non esiti a contattarci.',
    thankYou: 'Grazie per la fiducia!',
    bestRegards: 'Cordiali saluti,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Ricevuta per la fattura {{invoice.number}} di {{company.name}}',
    textDetailsHeader: 'Dettagli della fattura:',
    headerMeta: 'Da {{company.name}}',
    textNoteLabel: 'Nota',
  },
  pl: {
    headerLabel: 'Potwierdzenie zapłaty',
    greeting: 'Szanowni Państwo, {{recipient.name}},',
    intro: 'Faktura {{invoice.number}} od <strong>{{company.name}}</strong> została opłacona. Dziękujemy! Potwierdzenie w załączeniu.',
    textIntro: 'Faktura {{invoice.number}} od {{company.name}} została opłacona. Dziękujemy! Potwierdzenie w załączeniu.',
    invoiceNumberLabel: 'Numer faktury',
    amountLabel: 'Zapłacona kwota',
    invoiceDateLabel: 'Data faktury',
    customMessageLabel: 'Wiadomość od {{company.name}}',
    attachmentNote: 'Faktura oznaczona jako opłacona jest dołączona do tej wiadomości w formacie PDF. W razie pytań prosimy o kontakt.',
    thankYou: 'Dziękujemy za współpracę!',
    bestRegards: 'Z poważaniem,',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Potwierdzenie zapłaty faktury {{invoice.number}} od {{company.name}}',
    textDetailsHeader: 'Szczegóły faktury:',
    headerMeta: 'Od {{company.name}}',
    textNoteLabel: 'Uwaga',
  },
};
SUBJECTS.pt = 'Recibo da fatura paga {{invoice.number}} de {{company.name}}';
SUBJECTS.sv = 'Kvitto för betald faktura {{invoice.number}} från {{company.name}}';
COPY.pt = {
  headerLabel: 'Recibo',
  greeting: 'Olá {{recipient.name}},',
  intro: 'A fatura {{invoice.number}} de <strong>{{company.name}}</strong> foi paga. Obrigado! Segue em anexo o seu recibo.',
  textIntro: 'A fatura {{invoice.number}} de {{company.name}} foi paga. Obrigado! Segue em anexo o seu recibo.',
  invoiceNumberLabel: 'Número da fatura',
  amountLabel: 'Valor pago',
  invoiceDateLabel: 'Data da fatura',
  customMessageLabel: 'Observação de {{company.name}}',
  attachmentNote: 'A fatura marcada como paga está anexada a este email como PDF. Se tiver alguma dúvida, entre em contato conosco.',
  thankYou: 'Agradecemos pela preferência!',
  bestRegards: 'Atenciosamente,',
  footer: 'Powered by AlgaPSA',
  textHeader: 'Recibo da fatura {{invoice.number}} de {{company.name}}',
  textDetailsHeader: 'Detalhes da fatura:',
  headerMeta: 'De {{company.name}}',
  textNoteLabel: 'Observação',
};
COPY.sv = {
  headerLabel: 'Kvitto',
  greeting: 'Hej {{recipient.name}},',
  intro: 'Faktura {{invoice.number}} från <strong>{{company.name}}</strong> är betald. Tack! Ditt kvitto är bifogat.',
  textIntro: 'Faktura {{invoice.number}} från {{company.name}} är betald. Tack! Ditt kvitto är bifogat.',
  invoiceNumberLabel: 'Fakturanummer',
  amountLabel: 'Betalt belopp',
  invoiceDateLabel: 'Fakturadatum',
  customMessageLabel: 'Meddelande från {{company.name}}',
  attachmentNote: 'Den betalda fakturan bifogas som PDF-fil i detta e-postmeddelande. Kontakta oss om du har några frågor.',
  thankYou: 'Tack för ditt förtroende.',
  bestRegards: 'Med vänliga hälsningar,',
  footer: 'Drivs av AlgaPSA',
  textHeader: 'Kvitto för faktura {{invoice.number}} från {{company.name}}',
  textDetailsHeader: 'Fakturauppgifter:',
  headerMeta: 'Från {{company.name}}',
  textNoteLabel: 'Meddelande',
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.invoiceNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{invoice.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{invoice.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.invoiceDateLabel}</td>
                    <td style="padding:12px 0;">{{invoice.invoiceDate}}</td>
                  </tr>
                </table>
                {{#if customMessage}}
                <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.customMessageLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
                </div>
                {{/if}}
                <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.attachmentNote}</p>
                <p style="margin:16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.thankYou}</p>
                <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.bestRegards}<br><strong>{{company.name}}</strong></p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

${c.textIntro}

${c.textDetailsHeader}
- ${c.invoiceNumberLabel}: {{invoice.number}}
- ${c.amountLabel}: {{invoice.amount}}
- ${c.invoiceDateLabel}: {{invoice.invoiceDate}}

{{#if customMessage}}
${c.textNoteLabel}: {{customMessage}}
{{/if}}

${c.attachmentNote}

${c.thankYou}

${c.bestRegards}
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
        headerTitle: '{{invoice.number}}',
        headerMeta: copy.headerMeta,
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
