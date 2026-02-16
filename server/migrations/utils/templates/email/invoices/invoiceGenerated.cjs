/**
 * Source-of-truth: invoice-generated email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'invoice-generated';
const SUBTYPE_NAME = 'Invoice Generated';

const SUBJECTS = {
  en: 'New Invoice #{{invoice.number}}',
  fr: 'Nouvelle facture #{{invoice.number}}',
  es: 'Nueva factura #{{invoice.number}}',
  de: 'Neue Rechnung #{{invoice.number}}',
  nl: 'Nieuwe factuur #{{invoice.number}}',
  it: 'Nuova fattura #{{invoice.number}}',
  pl: 'Nowa faktura \u2022 {{invoice.number}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Invoice',
    intro: 'A new invoice has been generated for your review.',
    invoiceNumberLabel: 'Invoice Number',
    amountLabel: 'Amount',
    dueDateLabel: 'Due Date',
    clientLabel: 'Client',
    viewButton: 'View Invoice',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Invoice {{invoice.number}}',
    textIntro: 'A new invoice has been generated for your review:',
  },
  fr: {
    headerLabel: 'Nouvelle Facture',
    intro: 'Une nouvelle facture a \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e pour votre examen.',
    invoiceNumberLabel: 'Num\u00e9ro de facture',
    amountLabel: 'Montant',
    dueDateLabel: "Date d'\u00e9ch\u00e9ance",
    clientLabel: 'Client',
    viewButton: 'Voir la facture',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Facture {{invoice.number}}',
    textIntro: 'Une nouvelle facture a \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e pour votre examen :',
  },
  es: {
    headerLabel: 'Nueva Factura',
    intro: 'Se ha generado una nueva factura para tu revisi\u00f3n.',
    invoiceNumberLabel: 'N\u00famero de factura',
    amountLabel: 'Monto',
    dueDateLabel: 'Fecha de vencimiento',
    clientLabel: 'Cliente',
    viewButton: 'Ver la factura',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Factura {{invoice.number}}',
    textIntro: 'Se ha generado una nueva factura para tu revisi\u00f3n:',
  },
  de: {
    headerLabel: 'Neue Rechnung',
    intro: 'Eine neue Rechnung wurde zur \u00dcberpr\u00fcfung erstellt.',
    invoiceNumberLabel: 'Rechnungsnummer',
    amountLabel: 'Betrag',
    dueDateLabel: 'F\u00e4lligkeitsdatum',
    clientLabel: 'Kunde',
    viewButton: 'Rechnung anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Rechnung {{invoice.number}}',
    textIntro: 'Eine neue Rechnung wurde zur \u00dcberpr\u00fcfung erstellt:',
  },
  nl: {
    headerLabel: 'Nieuwe Factuur',
    intro: 'Een nieuwe factuur is aangemaakt voor uw controle.',
    invoiceNumberLabel: 'Factuurnummer',
    amountLabel: 'Bedrag',
    dueDateLabel: 'Vervaldatum',
    clientLabel: 'Klant',
    viewButton: 'Factuur bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Factuur {{invoice.number}}',
    textIntro: 'Een nieuwe factuur is aangemaakt voor uw controle:',
  },
  it: {
    headerLabel: 'Nuova Fattura',
    intro: '\u00c8 stata generata una nuova fattura da esaminare.',
    invoiceNumberLabel: 'Numero fattura',
    amountLabel: 'Importo',
    dueDateLabel: 'Data di scadenza',
    clientLabel: 'Cliente',
    viewButton: 'Apri la fattura',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Fattura {{invoice.number}}',
    textIntro: '\u00c8 stata generata una nuova fattura da esaminare:',
  },
  pl: {
    headerLabel: 'Nowa Faktura',
    intro: 'Nowa faktura zosta\u0142a wystawiona. Sprawd\u017a szczeg\u00f3\u0142y poni\u017cej.',
    invoiceNumberLabel: 'Numer faktury',
    amountLabel: 'Kwota',
    dueDateLabel: 'Termin p\u0142atno\u015bci',
    clientLabel: 'Klient',
    viewButton: 'Zobacz faktur\u0119',
    footer: 'Powered by Alga PSA',
    textHeader: 'Nowa faktura',
    textIntro: 'Nowa faktura zosta\u0142a wystawiona:',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.invoiceNumberLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">{{invoice.number}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amount}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.dueDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.dueDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.clientLabel}</td>
                    <td style="padding:12px 0;">{{invoice.clientName}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.invoiceNumberLabel}: {{invoice.number}}
${c.amountLabel}: {{invoice.amount}}
${c.dueDateLabel}: {{invoice.dueDate}}
${c.clientLabel}: {{invoice.clientName}}

${c.viewButton}: {{invoice.url}}`;
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
        headerMeta: '{{invoice.clientName}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
