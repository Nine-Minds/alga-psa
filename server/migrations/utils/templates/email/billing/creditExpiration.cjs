/**
 * Source-of-truth: credit-expiring email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'credit-expiring';
const SUBTYPE_NAME = 'Credit Expiring';

const SUBJECTS = {
  en: 'Credits Expiring Soon: {{company.name}}',
  fr: 'Cr\u00e9dits expirant bient\u00f4t : {{company.name}}',
  es: 'Cr\u00e9ditos por vencer pronto: {{company.name}}',
  de: 'Guthaben l\u00e4uft bald ab: {{company.name}}',
  nl: 'Tegoed verloopt binnenkort: {{company.name}}',
  it: 'Crediti in scadenza a breve: {{company.name}}',
  pl: 'Kredyty wkr\u00f3tce wygasaj\u0105: {{company.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Credits Expiring Soon',
    intro: 'The following credits for <strong>{{company.name}}</strong> will expire soon.',
    company: 'Company',
    totalAmount: 'Total Expiring Amount',
    expirationDate: 'Expiration Date',
    daysRemaining: 'Days Until Expiration',
    tableHeaderCreditId: 'Credit ID',
    tableHeaderAmount: 'Amount',
    tableHeaderExpiration: 'Expiration Date',
    tableHeaderTransaction: 'Original Transaction',
    closingNote: 'Please use these credits before they expire to avoid losing them.',
    viewButton: 'View Credits',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Credits Expiring Soon',
    textIntro: 'The following credits for {{company.name}} will expire soon:',
    textCreditDetails: 'Credit Details',
    textClosingNote: 'Please use these credits before they expire to avoid losing them.',
    textView: 'View credits at',
  },
  fr: {
    headerLabel: 'Cr\u00e9dits expirant bient\u00f4t',
    intro: 'Les cr\u00e9dits suivants pour <strong>{{company.name}}</strong> expireront bient\u00f4t.',
    company: 'Soci\u00e9t\u00e9',
    totalAmount: 'Montant total expirant',
    expirationDate: 'Date d\'expiration',
    daysRemaining: 'Jours avant expiration',
    tableHeaderCreditId: 'ID du cr\u00e9dit',
    tableHeaderAmount: 'Montant',
    tableHeaderExpiration: 'Date d\'expiration',
    tableHeaderTransaction: 'Transaction d\'origine',
    closingNote: 'Veuillez utiliser ces cr\u00e9dits avant leur expiration pour \u00e9viter de les perdre.',
    viewButton: 'Voir les cr\u00e9dits',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Cr\u00e9dits expirant bient\u00f4t',
    textIntro: 'Les cr\u00e9dits suivants pour {{company.name}} expireront bient\u00f4t :',
    textCreditDetails: 'D\u00e9tails des cr\u00e9dits',
    textClosingNote: 'Veuillez utiliser ces cr\u00e9dits avant leur expiration pour \u00e9viter de les perdre.',
    textView: 'Voir les cr\u00e9dits sur',
  },
  es: {
    headerLabel: 'Cr\u00e9ditos por vencer pronto',
    intro: 'Los siguientes cr\u00e9ditos de <strong>{{company.name}}</strong> vencer\u00e1n pronto.',
    company: 'Empresa',
    totalAmount: 'Monto total por vencer',
    expirationDate: 'Fecha de vencimiento',
    daysRemaining: 'D\u00edas hasta el vencimiento',
    tableHeaderCreditId: 'ID del cr\u00e9dito',
    tableHeaderAmount: 'Monto',
    tableHeaderExpiration: 'Fecha de vencimiento',
    tableHeaderTransaction: 'Transacci\u00f3n original',
    closingNote: 'Utilice estos cr\u00e9ditos antes de que venzan para evitar perderlos.',
    viewButton: 'Ver cr\u00e9ditos',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Cr\u00e9ditos por vencer pronto',
    textIntro: 'Los siguientes cr\u00e9ditos de {{company.name}} vencer\u00e1n pronto:',
    textCreditDetails: 'Detalles del cr\u00e9dito',
    textClosingNote: 'Utilice estos cr\u00e9ditos antes de que venzan para evitar perderlos.',
    textView: 'Ver cr\u00e9ditos en',
  },
  de: {
    headerLabel: 'Guthaben l\u00e4uft bald ab',
    intro: 'Das folgende Guthaben f\u00fcr <strong>{{company.name}}</strong> l\u00e4uft bald ab.',
    company: 'Unternehmen',
    totalAmount: 'Ablaufender Gesamtbetrag',
    expirationDate: 'Ablaufdatum',
    daysRemaining: 'Tage bis zum Ablauf',
    tableHeaderCreditId: 'Guthaben-ID',
    tableHeaderAmount: 'Betrag',
    tableHeaderExpiration: 'Ablaufdatum',
    tableHeaderTransaction: 'Urspr\u00fcngliche Transaktion',
    closingNote: 'Bitte verwenden Sie dieses Guthaben vor dem Ablauf, damit es nicht verf\u00e4llt.',
    viewButton: 'Guthaben anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Guthaben l\u00e4uft bald ab',
    textIntro: 'Das folgende Guthaben f\u00fcr {{company.name}} l\u00e4uft bald ab:',
    textCreditDetails: 'Guthabendetails',
    textClosingNote: 'Bitte verwenden Sie dieses Guthaben vor dem Ablauf, damit es nicht verf\u00e4llt.',
    textView: 'Guthaben ansehen unter',
  },
  nl: {
    headerLabel: 'Tegoed verloopt binnenkort',
    intro: 'Het volgende tegoed voor <strong>{{company.name}}</strong> verloopt binnenkort.',
    company: 'Bedrijf',
    totalAmount: 'Totaal verlopend bedrag',
    expirationDate: 'Vervaldatum',
    daysRemaining: 'Dagen tot vervaldatum',
    tableHeaderCreditId: 'Tegoed-ID',
    tableHeaderAmount: 'Bedrag',
    tableHeaderExpiration: 'Vervaldatum',
    tableHeaderTransaction: 'Oorspronkelijke transactie',
    closingNote: 'Gebruik dit tegoed v\u00f3\u00f3r de vervaldatum om te voorkomen dat het verloopt.',
    viewButton: 'Tegoed bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Tegoed verloopt binnenkort',
    textIntro: 'Het volgende tegoed voor {{company.name}} verloopt binnenkort:',
    textCreditDetails: 'Tegoeddetails',
    textClosingNote: 'Gebruik dit tegoed v\u00f3\u00f3r de vervaldatum om te voorkomen dat het verloopt.',
    textView: 'Tegoed bekijken op',
  },
  it: {
    headerLabel: 'Crediti in scadenza a breve',
    intro: 'I seguenti crediti per <strong>{{company.name}}</strong> scadranno a breve.',
    company: 'Azienda',
    totalAmount: 'Importo totale in scadenza',
    expirationDate: 'Data di scadenza',
    daysRemaining: 'Giorni alla scadenza',
    tableHeaderCreditId: 'ID credito',
    tableHeaderAmount: 'Importo',
    tableHeaderExpiration: 'Data di scadenza',
    tableHeaderTransaction: 'Transazione originale',
    closingNote: 'La preghiamo di utilizzare questi crediti prima della scadenza per evitare di perderli.',
    viewButton: 'Visualizza crediti',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Crediti in scadenza a breve',
    textIntro: 'I seguenti crediti per {{company.name}} scadranno a breve:',
    textCreditDetails: 'Dettagli credito',
    textClosingNote: 'La preghiamo di utilizzare questi crediti prima della scadenza per evitare di perderli.',
    textView: 'Visualizza crediti su',
  },
  pl: {
    headerLabel: 'Kredyty wkr\u00f3tce wygasaj\u0105',
    intro: 'Poni\u017csze kredyty dla <strong>{{company.name}}</strong> wkr\u00f3tce wygasn\u0105.',
    company: 'Firma',
    totalAmount: 'Ca\u0142kowita kwota wygasaj\u0105ca',
    expirationDate: 'Data wyga\u015bni\u0119cia',
    daysRemaining: 'Dni do wyga\u015bni\u0119cia',
    tableHeaderCreditId: 'ID kredytu',
    tableHeaderAmount: 'Kwota',
    tableHeaderExpiration: 'Data wyga\u015bni\u0119cia',
    tableHeaderTransaction: 'Pierwotna transakcja',
    closingNote: 'Prosimy o wykorzystanie tych kredyt\u00f3w przed ich wyga\u015bni\u0119ciem, aby ich nie utraci\u0107.',
    viewButton: 'Zobacz kredyty',
    footer: 'Powered by Alga PSA',
    textHeader: 'Kredyty wkr\u00f3tce wygasaj\u0105',
    textIntro: 'Poni\u017csze kredyty dla {{company.name}} wkr\u00f3tce wygasn\u0105:',
    textCreditDetails: 'Szczeg\u00f3\u0142y kredytu',
    textClosingNote: 'Prosimy o wykorzystanie tych kredyt\u00f3w przed ich wyga\u015bni\u0119ciem, aby ich nie utraci\u0107.',
    textView: 'Zobacz kredyty pod adresem',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.company}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{company.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.totalAmount}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{credits.totalAmount}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.expirationDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{credits.expirationDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.daysRemaining}</td>
                    <td style="padding:12px 0;">{{credits.daysRemaining}}</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin-top:24px;">
                  <thead>
                    <tr style="background-color:#f8f5ff;">
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderCreditId}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderAmount}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderExpiration}</th>
                      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #eef2ff;font-weight:600;color:#475467;">${c.tableHeaderTransaction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {{#each credits.items}}
                    <tr>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.creditId}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.amount}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.expirationDate}}</td>
                      <td style="padding:10px 12px;border-bottom:1px solid #eef2ff;">{{this.transactionId}}</td>
                    </tr>
                    {{/each}}
                  </tbody>
                </table>
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{credits.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.company}: {{company.name}}
${c.totalAmount}: {{credits.totalAmount}}
${c.expirationDate}: {{credits.expirationDate}}
${c.daysRemaining}: {{credits.daysRemaining}}

${c.textCreditDetails}:
{{#each credits.items}}
- ${c.tableHeaderCreditId}: {{this.creditId}}
  ${c.tableHeaderAmount}: {{this.amount}}
  ${c.tableHeaderExpiration}: {{this.expirationDate}}
  ${c.tableHeaderTransaction}: {{this.transactionId}}
{{/each}}

${c.textClosingNote}

${c.textView}: {{credits.url}}`;
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
        headerTitle: '{{company.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
