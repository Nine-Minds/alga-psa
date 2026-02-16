/**
 * Source-of-truth: payment-received email template.
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

const TEMPLATE_NAME = 'payment-received';
const SUBTYPE_NAME = 'Payment Received';

const SUBJECTS = {
  en: 'Payment Received: Invoice #{{invoice.number}}',
  fr: 'Paiement re\u00e7u : Facture #{{invoice.number}}',
  es: 'Pago recibido: Factura #{{invoice.number}}',
  de: 'Zahlung erhalten: Rechnung #{{invoice.number}}',
  nl: 'Betaling ontvangen: Factuur #{{invoice.number}}',
  it: 'Pagamento ricevuto: Fattura #{{invoice.number}}',
  pl: 'P\u0142atno\u015b\u0107 otrzymana \u2022 {{invoice.number}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Payment Received',
    intro: 'Payment has been received for invoice #{{invoice.number}}.',
    invoiceNumberLabel: 'Invoice Number',
    amountPaidLabel: 'Amount Paid',
    paymentDateLabel: 'Payment Date',
    paymentMethodLabel: 'Payment Method',
    viewButton: 'View Invoice',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Payment Received',
    textIntro: 'Payment has been received for invoice #{{invoice.number}}:',
  },
  fr: {
    headerLabel: 'Paiement Re\u00e7u',
    intro: 'Le paiement a \u00e9t\u00e9 re\u00e7u pour la facture #{{invoice.number}}.',
    invoiceNumberLabel: 'Num\u00e9ro de facture',
    amountPaidLabel: 'Montant pay\u00e9',
    paymentDateLabel: 'Date de paiement',
    paymentMethodLabel: 'M\u00e9thode de paiement',
    viewButton: 'Voir la facture',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Paiement re\u00e7u',
    textIntro: 'Le paiement a \u00e9t\u00e9 re\u00e7u pour la facture #{{invoice.number}} :',
  },
  es: {
    headerLabel: 'Pago Recibido',
    intro: 'Se ha recibido el pago de la factura #{{invoice.number}}.',
    invoiceNumberLabel: 'N\u00famero de factura',
    amountPaidLabel: 'Monto pagado',
    paymentDateLabel: 'Fecha de pago',
    paymentMethodLabel: 'M\u00e9todo de pago',
    viewButton: 'Ver la factura',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Pago recibido',
    textIntro: 'Se ha recibido el pago de la factura #{{invoice.number}}:',
  },
  de: {
    headerLabel: 'Zahlung Erhalten',
    intro: 'Die Zahlung f\u00fcr Rechnung #{{invoice.number}} wurde erhalten.',
    invoiceNumberLabel: 'Rechnungsnummer',
    amountPaidLabel: 'Gezahlter Betrag',
    paymentDateLabel: 'Zahlungsdatum',
    paymentMethodLabel: 'Zahlungsmethode',
    viewButton: 'Rechnung anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Zahlung erhalten',
    textIntro: 'Die Zahlung f\u00fcr Rechnung #{{invoice.number}} wurde erhalten:',
  },
  nl: {
    headerLabel: 'Betaling Ontvangen',
    intro: 'Betaling is ontvangen voor factuur #{{invoice.number}}.',
    invoiceNumberLabel: 'Factuurnummer',
    amountPaidLabel: 'Betaald bedrag',
    paymentDateLabel: 'Betaaldatum',
    paymentMethodLabel: 'Betaalmethode',
    viewButton: 'Factuur bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Betaling ontvangen',
    textIntro: 'Betaling is ontvangen voor factuur #{{invoice.number}}:',
  },
  it: {
    headerLabel: 'Pagamento Ricevuto',
    intro: '\u00c8 stato ricevuto il pagamento della fattura #{{invoice.number}}.',
    invoiceNumberLabel: 'Numero fattura',
    amountPaidLabel: 'Importo pagato',
    paymentDateLabel: 'Data del pagamento',
    paymentMethodLabel: 'Metodo di pagamento',
    viewButton: 'Apri la fattura',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Pagamento ricevuto',
    textIntro: '\u00c8 stato ricevuto il pagamento della fattura #{{invoice.number}}:',
  },
  pl: {
    headerLabel: 'P\u0142atno\u015b\u0107 Otrzymana',
    intro: 'Otrzymali\u015bmy p\u0142atno\u015b\u0107 za faktur\u0119. Dzi\u0119kujemy!',
    invoiceNumberLabel: 'Numer faktury',
    amountPaidLabel: 'Kwota',
    paymentDateLabel: 'Data p\u0142atno\u015bci',
    paymentMethodLabel: 'Metoda p\u0142atno\u015bci',
    viewButton: 'Zobacz faktur\u0119',
    footer: 'Powered by Alga PSA',
    textHeader: 'P\u0142atno\u015b\u0107 otrzymana',
    textIntro: 'Otrzymali\u015bmy p\u0142atno\u015b\u0107 za faktur\u0119:',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.amountPaidLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.amountPaid}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.paymentDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.paymentDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.paymentMethodLabel}</td>
                    <td style="padding:12px 0;">{{invoice.paymentMethod}}</td>
                  </tr>
                </table>
                <a href="{{invoice.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-top:20px;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.invoiceNumberLabel}: {{invoice.number}}
${c.amountPaidLabel}: {{invoice.amountPaid}}
${c.paymentDateLabel}: {{invoice.paymentDate}}
${c.paymentMethodLabel}: {{invoice.paymentMethod}}

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
