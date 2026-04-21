/**
 * Source-of-truth: invoice-email template.
 *
 * Uses the shared email layout wrapper. This template is used for sending
 * invoices directly to clients with the invoice PDF attached.
 * Currently only English is available.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'invoice-email';
const SUBTYPE_NAME = 'Invoice Email';

const SUBJECTS = {
  en: 'Invoice {{invoice.number}} from {{company.name}}',
  fr: 'Facture {{invoice.number}} de {{company.name}}',
  es: 'Factura {{invoice.number}} de {{company.name}}',
  de: 'Rechnung {{invoice.number}} von {{company.name}}',
  nl: 'Factuur {{invoice.number}} van {{company.name}}',
  it: 'Fattura {{invoice.number}} da {{company.name}}',
  pl: 'Faktura {{invoice.number}} od {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Invoice',
    greeting: 'Dear {{recipient.name}},',
    intro: 'Please find attached your invoice from <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Invoice Number',
    amountDueLabel: 'Amount Due',
    invoiceDateLabel: 'Invoice Date',
    dueDateLabel: 'Due Date',
    customMessageLabel: 'Note from {{company.name}}',
    attachmentNote: 'The invoice is attached to this email as a PDF. If you have any questions, please don\'t hesitate to contact us.',
    thankYou: 'Thank you for your business!',
    bestRegards: 'Best regards,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Invoice {{invoice.number}} from {{company.name}}',
    textGreeting: 'Dear {{recipient.name}},',
    textIntro: 'Please find attached your invoice from {{company.name}}.',
    textDetailsHeader: 'Invoice Details:',
  },
  fr: {
    headerLabel: 'Facture',
    greeting: 'Cher/Ch\u00e8re {{recipient.name}},',
    intro: 'Veuillez trouver ci-joint votre facture de <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Num\u00e9ro de facture',
    amountDueLabel: 'Montant d\u00fb',
    invoiceDateLabel: 'Date de facturation',
    dueDateLabel: 'Date d\'\u00e9ch\u00e9ance',
    customMessageLabel: 'Message de {{company.name}}',
    attachmentNote: 'La facture est jointe \u00e0 cet e-mail au format PDF. Si vous avez des questions, n\'h\u00e9sitez pas \u00e0 nous contacter.',
    thankYou: 'Merci pour votre confiance\u00a0!',
    bestRegards: 'Cordialement,',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Facture {{invoice.number}} de {{company.name}}',
    textGreeting: 'Cher/Ch\u00e8re {{recipient.name}},',
    textIntro: 'Veuillez trouver ci-joint votre facture de {{company.name}}.',
    textDetailsHeader: 'D\u00e9tails de la facture :',
  },
  es: {
    headerLabel: 'Factura',
    greeting: 'Estimado/a {{recipient.name}}:',
    intro: 'Adjunto encontrar\u00e1 su factura de <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'N\u00famero de factura',
    amountDueLabel: 'Importe a pagar',
    invoiceDateLabel: 'Fecha de factura',
    dueDateLabel: 'Fecha de vencimiento',
    customMessageLabel: 'Mensaje de {{company.name}}',
    attachmentNote: 'La factura est\u00e1 adjunta a este correo en formato PDF. Si tiene alguna pregunta, no dude en contactarnos.',
    thankYou: '\u00a1Gracias por su confianza!',
    bestRegards: 'Atentamente,',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Factura {{invoice.number}} de {{company.name}}',
    textGreeting: 'Estimado/a {{recipient.name}}:',
    textIntro: 'Adjunto encontrar\u00e1 su factura de {{company.name}}.',
    textDetailsHeader: 'Detalles de la factura:',
  },
  de: {
    headerLabel: 'Rechnung',
    greeting: 'Sehr geehrte/r {{recipient.name}},',
    intro: 'Anbei finden Sie Ihre Rechnung von <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Rechnungsnummer',
    amountDueLabel: 'F\u00e4lliger Betrag',
    invoiceDateLabel: 'Rechnungsdatum',
    dueDateLabel: 'F\u00e4lligkeitsdatum',
    customMessageLabel: 'Nachricht von {{company.name}}',
    attachmentNote: 'Die Rechnung ist dieser E-Mail als PDF beigef\u00fcgt. Bei Fragen k\u00f6nnen Sie uns gerne kontaktieren.',
    thankYou: 'Vielen Dank f\u00fcr Ihr Vertrauen!',
    bestRegards: 'Mit freundlichen Gr\u00fc\u00dfen,',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Rechnung {{invoice.number}} von {{company.name}}',
    textGreeting: 'Sehr geehrte/r {{recipient.name}},',
    textIntro: 'Anbei finden Sie Ihre Rechnung von {{company.name}}.',
    textDetailsHeader: 'Rechnungsdetails:',
  },
  nl: {
    headerLabel: 'Factuur',
    greeting: 'Geachte {{recipient.name}},',
    intro: 'Bijgaand vindt u uw factuur van <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Factuurnummer',
    amountDueLabel: 'Te betalen bedrag',
    invoiceDateLabel: 'Factuurdatum',
    dueDateLabel: 'Vervaldatum',
    customMessageLabel: 'Bericht van {{company.name}}',
    attachmentNote: 'De factuur is als PDF bij deze e-mail gevoegd. Mocht u vragen hebben, aarzel dan niet om contact met ons op te nemen.',
    thankYou: 'Hartelijk dank voor uw vertrouwen!',
    bestRegards: 'Met vriendelijke groet,',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Factuur {{invoice.number}} van {{company.name}}',
    textGreeting: 'Geachte {{recipient.name}},',
    textIntro: 'Bijgaand vindt u uw factuur van {{company.name}}.',
    textDetailsHeader: 'Factuurgegevens:',
  },
  it: {
    headerLabel: 'Fattura',
    greeting: 'Gentile {{recipient.name}},',
    intro: 'In allegato trova la sua fattura da parte di <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Numero fattura',
    amountDueLabel: 'Importo dovuto',
    invoiceDateLabel: 'Data fattura',
    dueDateLabel: 'Data di scadenza',
    customMessageLabel: 'Messaggio da {{company.name}}',
    attachmentNote: 'La fattura \u00e8 allegata a questa email in formato PDF. Per qualsiasi domanda, non esiti a contattarci.',
    thankYou: 'Grazie per la sua fiducia!',
    bestRegards: 'Cordiali saluti,',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Fattura {{invoice.number}} da {{company.name}}',
    textGreeting: 'Gentile {{recipient.name}},',
    textIntro: 'In allegato trova la sua fattura da parte di {{company.name}}.',
    textDetailsHeader: 'Dettagli della fattura:',
  },
  pl: {
    headerLabel: 'Faktura',
    greeting: 'Szanowny/a {{recipient.name}},',
    intro: 'W za\u0142\u0105czeniu przesy\u0142amy Pa\u0144stwa faktur\u0119 od <strong>{{company.name}}</strong>.',
    invoiceNumberLabel: 'Numer faktury',
    amountDueLabel: 'Kwota do zap\u0142aty',
    invoiceDateLabel: 'Data wystawienia',
    dueDateLabel: 'Termin p\u0142atno\u015bci',
    customMessageLabel: 'Wiadomo\u015b\u0107 od {{company.name}}',
    attachmentNote: 'Faktura jest za\u0142\u0105czona do tej wiadomo\u015bci w formacie PDF. W razie pyta\u0144 prosimy o kontakt.',
    thankYou: 'Dzi\u0119kujemy za wsp\u00f3\u0142prac\u0119!',
    bestRegards: 'Z powa\u017caniem,',
    footer: 'Powered by Alga PSA',
    textHeader: 'Faktura {{invoice.number}} od {{company.name}}',
    textGreeting: 'Szanowny/a {{recipient.name}},',
    textIntro: 'W za\u0142\u0105czeniu przesy\u0142amy Pa\u0144stwa faktur\u0119 od {{company.name}}.',
    textDetailsHeader: 'Szczeg\u00f3\u0142y faktury:',
  },
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountDueLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="font-size:18px;font-weight:700;color:#1f2933;">{{invoice.amount}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.invoiceDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.invoiceDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.dueDateLabel}</td>
                    <td style="padding:12px 0;">{{invoice.dueDate}}</td>
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

${c.textGreeting}

${c.textIntro}

${c.textDetailsHeader}
- ${c.invoiceNumberLabel}: {{invoice.number}}
- ${c.amountDueLabel}: {{invoice.amount}}
- ${c.invoiceDateLabel}: {{invoice.invoiceDate}}
- ${c.dueDateLabel}: {{invoice.dueDate}}

{{#if customMessage}}
Note: {{customMessage}}
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
        headerMeta: 'From {{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
