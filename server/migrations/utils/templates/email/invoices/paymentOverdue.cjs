/**
 * Source-of-truth: payment-overdue email template.
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

const TEMPLATE_NAME = 'payment-overdue';
const SUBTYPE_NAME = 'Payment Overdue';

const SUBJECTS = {
  en: 'Payment Overdue: Invoice #{{invoice.number}}',
  fr: 'Paiement en retard : Facture #{{invoice.number}}',
  es: 'Pago vencido: Factura #{{invoice.number}}',
  de: 'Zahlung \u00fcberf\u00e4llig: Rechnung #{{invoice.number}}',
  nl: 'Betaling achterstallig: Factuur #{{invoice.number}}',
  it: 'Pagamento in ritardo: Fattura #{{invoice.number}}',
  pl: 'P\u0142atno\u015b\u0107 po terminie \u2022 {{invoice.number}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Payment Overdue',
    intro: 'The payment for invoice #{{invoice.number}} is overdue.',
    invoiceNumberLabel: 'Invoice Number',
    amountDueLabel: 'Amount Due',
    dueDateLabel: 'Due Date',
    daysOverdueLabel: 'Days Overdue',
    viewButton: 'View Invoice',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Payment Overdue',
    textIntro: 'The payment for invoice #{{invoice.number}} is overdue:',
  },
  fr: {
    headerLabel: 'Paiement en Retard',
    intro: 'Le paiement de la facture #{{invoice.number}} est en retard.',
    invoiceNumberLabel: 'Num\u00e9ro de facture',
    amountDueLabel: 'Montant d\u00fb',
    dueDateLabel: "Date d'\u00e9ch\u00e9ance",
    daysOverdueLabel: 'Jours de retard',
    viewButton: 'Voir la facture',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Paiement en retard',
    textIntro: 'Le paiement de la facture #{{invoice.number}} est en retard :',
  },
  es: {
    headerLabel: 'Pago Vencido',
    intro: 'El pago de la factura #{{invoice.number}} est\u00e1 vencido.',
    invoiceNumberLabel: 'N\u00famero de factura',
    amountDueLabel: 'Monto adeudado',
    dueDateLabel: 'Fecha de vencimiento',
    daysOverdueLabel: 'D\u00edas de retraso',
    viewButton: 'Ver la factura',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Pago vencido',
    textIntro: 'El pago de la factura #{{invoice.number}} est\u00e1 vencido:',
  },
  de: {
    headerLabel: 'Zahlung \u00dcberf\u00e4llig',
    intro: 'Die Zahlung f\u00fcr Rechnung #{{invoice.number}} ist \u00fcberf\u00e4llig.',
    invoiceNumberLabel: 'Rechnungsnummer',
    amountDueLabel: 'F\u00e4lliger Betrag',
    dueDateLabel: 'F\u00e4lligkeitsdatum',
    daysOverdueLabel: 'Tage \u00fcberf\u00e4llig',
    viewButton: 'Rechnung anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Zahlung \u00fcberf\u00e4llig',
    textIntro: 'Die Zahlung f\u00fcr Rechnung #{{invoice.number}} ist \u00fcberf\u00e4llig:',
  },
  nl: {
    headerLabel: 'Betaling Achterstallig',
    intro: 'De betaling voor factuur #{{invoice.number}} is achterstallig.',
    invoiceNumberLabel: 'Factuurnummer',
    amountDueLabel: 'Verschuldigd bedrag',
    dueDateLabel: 'Vervaldatum',
    daysOverdueLabel: 'Dagen achterstallig',
    viewButton: 'Factuur bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Betaling achterstallig',
    textIntro: 'De betaling voor factuur #{{invoice.number}} is achterstallig:',
  },
  it: {
    headerLabel: 'Pagamento in Ritardo',
    intro: 'Il pagamento della fattura #{{invoice.number}} \u00e8 in ritardo.',
    invoiceNumberLabel: 'Numero fattura',
    amountDueLabel: 'Importo dovuto',
    dueDateLabel: 'Data di scadenza',
    daysOverdueLabel: 'Giorni di ritardo',
    viewButton: 'Apri la fattura',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Pagamento in ritardo',
    textIntro: 'Il pagamento della fattura #{{invoice.number}} \u00e8 in ritardo:',
  },
  pl: {
    headerLabel: 'P\u0142atno\u015b\u0107 po Terminie',
    intro: 'P\u0142atno\u015b\u0107 za poni\u017csz\u0105 faktur\u0119 jest po terminie. Prosimy o uregulowanie nale\u017cno\u015bci.',
    invoiceNumberLabel: 'Numer faktury',
    amountDueLabel: 'Kwota do zap\u0142aty',
    dueDateLabel: 'Termin p\u0142atno\u015bci',
    daysOverdueLabel: 'Dni po terminie',
    viewButton: 'Zobacz faktur\u0119',
    footer: 'Powered by Alga PSA',
    textHeader: 'P\u0142atno\u015b\u0107 po terminie',
    textIntro: 'P\u0142atno\u015b\u0107 za faktur\u0119 jest po terminie:',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountDueLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amountDue}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.dueDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.dueDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.daysOverdueLabel}</td>
                    <td style="padding:12px 0;">{{invoice.daysOverdue}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.invoiceNumberLabel}: {{invoice.number}}
${c.amountDueLabel}: {{invoice.amountDue}}
${c.dueDateLabel}: {{invoice.dueDate}}
${c.daysOverdueLabel}: {{invoice.daysOverdue}}

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
