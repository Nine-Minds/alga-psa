/**
 * Source-of-truth: prepaid balance alert email templates.
 *
 * Two templates (prepaid-credit-low-balance, prepaid-bucket-threshold-reached)
 * use the shared email layout wrapper. Only text differs between locales;
 * values are formatted by the delivery layer before rendering.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const CREDIT_TEMPLATE_NAME = 'prepaid-credit-low-balance';
const CREDIT_SUBTYPE_NAME = 'prepaid-credit-low-balance';
const BUCKET_TEMPLATE_NAME = 'prepaid-bucket-threshold-reached';
const BUCKET_SUBTYPE_NAME = 'prepaid-bucket-threshold-reached';

/* eslint-disable max-len */
const CREDIT_SUBJECTS = {
  en: 'Prepaid credit running low: {{client.name}}',
  fr: 'Cr\u00e9dit pr\u00e9pay\u00e9 faible : {{client.name}}',
  es: 'Cr\u00e9dito prepagado bajo: {{client.name}}',
  de: 'Prepaid-Guthaben niedrig: {{client.name}}',
  nl: 'Prepaid-tegoed bijna op: {{client.name}}',
  it: 'Credito prepagato basso: {{client.name}}',
  pl: 'Niski stan kredytu przedp\u0142aconego: {{client.name}}',
};

const CREDIT_COPY = {
  en: {
    headerLabel: 'Prepaid Credit Low',
    intro: 'Prepaid credit for <strong>{{client.name}}</strong> has dropped below the configured threshold.',
    available: 'Available credit',
    threshold: 'Configured threshold',
    currency: 'Currency',
    closingNote: 'Review the balance so work is not interrupted.',
    viewButton: 'View Client',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textHeader: 'Prepaid Credit Low',
    textIntro: 'Prepaid credit for {{client.name}} has dropped below the configured threshold.',
    textClosingNote: 'Review the balance so work is not interrupted.',
    textView: 'View client at',
  },
  fr: {
    headerLabel: 'Cr\u00e9dit pr\u00e9pay\u00e9 faible',
    intro: 'Le cr\u00e9dit pr\u00e9pay\u00e9 de <strong>{{client.name}}</strong> est pass\u00e9 sous le seuil configur\u00e9.',
    available: 'Cr\u00e9dit disponible',
    threshold: 'Seuil configur\u00e9',
    currency: 'Devise',
    closingNote: 'V\u00e9rifiez le solde afin d\u2019\u00e9viter toute interruption du travail.',
    viewButton: 'Voir le client',
    footer: 'Powered by AlgaPSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Cr\u00e9dit pr\u00e9pay\u00e9 faible',
    textIntro: 'Le cr\u00e9dit pr\u00e9pay\u00e9 de {{client.name}} est pass\u00e9 sous le seuil configur\u00e9.',
    textClosingNote: 'V\u00e9rifiez le solde afin d\u2019\u00e9viter toute interruption du travail.',
    textView: 'Voir le client sur',
  },
  es: {
    headerLabel: 'Cr\u00e9dito prepagado bajo',
    intro: 'El cr\u00e9dito prepagado de <strong>{{client.name}}</strong> ha ca\u00eddo por debajo del umbral configurado.',
    available: 'Cr\u00e9dito disponible',
    threshold: 'Umbral configurado',
    currency: 'Moneda',
    closingNote: 'Revise el saldo para evitar interrupciones en el trabajo.',
    viewButton: 'Ver cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Cr\u00e9dito prepagado bajo',
    textIntro: 'El cr\u00e9dito prepagado de {{client.name}} ha ca\u00eddo por debajo del umbral configurado.',
    textClosingNote: 'Revise el saldo para evitar interrupciones en el trabajo.',
    textView: 'Ver cliente en',
  },
  de: {
    headerLabel: 'Prepaid-Guthaben niedrig',
    intro: 'Das Prepaid-Guthaben von <strong>{{client.name}}</strong> liegt unter dem konfigurierten Schwellenwert.',
    available: 'Verf\u00fcgbares Guthaben',
    threshold: 'Konfigurierter Schwellenwert',
    currency: 'W\u00e4hrung',
    closingNote: 'Pr\u00fcfen Sie den Kontostand, um Unterbrechungen zu vermeiden.',
    viewButton: 'Kunde anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Prepaid-Guthaben niedrig',
    textIntro: 'Das Prepaid-Guthaben von {{client.name}} liegt unter dem konfigurierten Schwellenwert.',
    textClosingNote: 'Pr\u00fcfen Sie den Kontostand, um Unterbrechungen zu vermeiden.',
    textView: 'Kunde ansehen unter',
  },
  nl: {
    headerLabel: 'Prepaid-tegoed bijna op',
    intro: 'Het prepaid-tegoed van <strong>{{client.name}}</strong> is onder de geconfigureerde drempel gedaald.',
    available: 'Beschikbaar tegoed',
    threshold: 'Geconfigureerde drempel',
    currency: 'Valuta',
    closingNote: 'Controleer het saldo om onderbrekingen te voorkomen.',
    viewButton: 'Klant bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Prepaid-tegoed bijna op',
    textIntro: 'Het prepaid-tegoed van {{client.name}} is onder de geconfigureerde drempel gedaald.',
    textClosingNote: 'Controleer het saldo om onderbrekingen te voorkomen.',
    textView: 'Klant bekijken op',
  },
  it: {
    headerLabel: 'Credito prepagato basso',
    intro: 'Il credito prepagato di <strong>{{client.name}}</strong> \u00e8 sceso al di sotto della soglia configurata.',
    available: 'Credito disponibile',
    threshold: 'Soglia configurata',
    currency: 'Valuta',
    closingNote: 'Controllare il saldo per evitare interruzioni del lavoro.',
    viewButton: 'Visualizza cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Credito prepagato basso',
    textIntro: 'Il credito prepagato di {{client.name}} \u00e8 sceso al di sotto della soglia configurata.',
    textClosingNote: 'Controllare il saldo per evitare interruzioni del lavoro.',
    textView: 'Visualizza cliente su',
  },
  pl: {
    headerLabel: 'Niski stan kredytu przedp\u0142aconego',
    intro: 'Kredyt przedp\u0142acony dla <strong>{{client.name}}</strong> spad\u0142 poni\u017cej skonfigurowanego progu.',
    available: 'Dost\u0119pny kredyt',
    threshold: 'Skonfigurowany pr\u00f3g',
    currency: 'Waluta',
    closingNote: 'Sprawd\u017a saldo, aby unikn\u0105\u0107 przerw w pracy.',
    viewButton: 'Zobacz klienta',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Niski stan kredytu przedp\u0142aconego',
    textIntro: 'Kredyt przedp\u0142acony dla {{client.name}} spad\u0142 poni\u017cej skonfigurowanego progu.',
    textClosingNote: 'Sprawd\u017a saldo, aby unikn\u0105\u0107 przerw w pracy.',
    textView: 'Zobacz klienta pod adresem',
  },
};

const BUCKET_SUBJECTS = {
  en: 'Prepaid hour bucket threshold reached: {{client.name}}',
  fr: 'Seuil du bloc d\u2019heures pr\u00e9pay\u00e9es atteint : {{client.name}}',
  es: 'Umbral del paquete de horas prepagado alcanzado: {{client.name}}',
  de: 'Schwellenwert des Prepaid-Stundenpakets erreicht: {{client.name}}',
  nl: 'Drempel prepaid-urenpakket bereikt: {{client.name}}',
  it: 'Soglia del pacchetto ore prepagato raggiunta: {{client.name}}',
  pl: 'Osi\u0105gni\u0119to pr\u00f3g pakietu godzin przedp\u0142aconych: {{client.name}}',
};

const BUCKET_COPY = {
  en: {
    headerLabel: 'Prepaid Hour Bucket Threshold Reached',
    intro: 'A prepaid hour bucket for <strong>{{client.name}}</strong> has reached {{alert.usedPercent}}% of its capacity.',
    capacity: 'Capacity',
    used: 'Used',
    consumedPercent: 'Consumed',
    configuredPercent: 'Configured threshold',
    closingNote: 'Review the bucket so usage does not turn into overage.',
    viewButton: 'View Client',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textHeader: 'Prepaid Hour Bucket Threshold Reached',
    textIntro: 'A prepaid hour bucket for {{client.name}} has reached {{alert.usedPercent}}% of its capacity.',
    textClosingNote: 'Review the bucket so usage does not turn into overage.',
    textView: 'View client at',
  },
  fr: {
    headerLabel: 'Seuil du bloc d\u2019heures pr\u00e9pay\u00e9es atteint',
    intro: 'Un bloc d\u2019heures pr\u00e9pay\u00e9es de <strong>{{client.name}}</strong> a atteint {{alert.usedPercent}} % de sa capacit\u00e9.',
    capacity: 'Capacit\u00e9',
    used: 'Utilis\u00e9',
    consumedPercent: 'Consomm\u00e9',
    configuredPercent: 'Seuil configur\u00e9',
    closingNote: 'V\u00e9rifiez le bloc afin d\u2019\u00e9viter les d\u00e9passements.',
    viewButton: 'Voir le client',
    footer: 'Powered by AlgaPSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Seuil du bloc d\u2019heures pr\u00e9pay\u00e9es atteint',
    textIntro: 'Un bloc d\u2019heures pr\u00e9pay\u00e9es de {{client.name}} a atteint {{alert.usedPercent}} % de sa capacit\u00e9.',
    textClosingNote: 'V\u00e9rifiez le bloc afin d\u2019\u00e9viter les d\u00e9passements.',
    textView: 'Voir le client sur',
  },
  es: {
    headerLabel: 'Umbral del paquete de horas prepagado alcanzado',
    intro: 'Un paquete de horas prepagado de <strong>{{client.name}}</strong> ha alcanzado el {{alert.usedPercent}}% de su capacidad.',
    capacity: 'Capacidad',
    used: 'Usado',
    consumedPercent: 'Consumido',
    configuredPercent: 'Umbral configurado',
    closingNote: 'Revise el paquete para que el uso no se convierta en exceso.',
    viewButton: 'Ver cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Umbral del paquete de horas prepagado alcanzado',
    textIntro: 'Un paquete de horas prepagado de {{client.name}} ha alcanzado el {{alert.usedPercent}}% de su capacidad.',
    textClosingNote: 'Revise el paquete para que el uso no se convierta en exceso.',
    textView: 'Ver cliente en',
  },
  de: {
    headerLabel: 'Schwellenwert des Prepaid-Stundenpakets erreicht',
    intro: 'Ein Prepaid-Stundenpaket von <strong>{{client.name}}</strong> hat {{alert.usedPercent}}% seiner Kapazit\u00e4t erreicht.',
    capacity: 'Kapazit\u00e4t',
    used: 'Verbraucht',
    consumedPercent: 'Verbrauch',
    configuredPercent: 'Konfigurierter Schwellenwert',
    closingNote: 'Pr\u00fcfen Sie das Paket, damit \u00dcberstunden nicht zum \u00dcberhang werden.',
    viewButton: 'Kunde anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Schwellenwert des Prepaid-Stundenpakets erreicht',
    textIntro: 'Ein Prepaid-Stundenpaket von {{client.name}} hat {{alert.usedPercent}}% seiner Kapazit\u00e4t erreicht.',
    textClosingNote: 'Pr\u00fcfen Sie das Paket, damit \u00dcberstunden nicht zum \u00dcberhang werden.',
    textView: 'Kunde ansehen unter',
  },
  nl: {
    headerLabel: 'Drempel prepaid-urenpakket bereikt',
    intro: 'Een prepaid-urenpakket van <strong>{{client.name}}</strong> heeft {{alert.usedPercent}}% van de capaciteit bereikt.',
    capacity: 'Capaciteit',
    used: 'Verbruikt',
    consumedPercent: 'Verbruik',
    configuredPercent: 'Geconfigureerde drempel',
    closingNote: 'Controleer het pakket zodat verbruik geen overschrijding wordt.',
    viewButton: 'Klant bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Drempel prepaid-urenpakket bereikt',
    textIntro: 'Een prepaid-urenpakket van {{client.name}} heeft {{alert.usedPercent}}% van de capaciteit bereikt.',
    textClosingNote: 'Controleer het pakket zodat verbruik geen overschrijding wordt.',
    textView: 'Klant bekijken op',
  },
  it: {
    headerLabel: 'Soglia del pacchetto ore prepagato raggiunta',
    intro: 'Un pacchetto ore prepagato di <strong>{{client.name}}</strong> ha raggiunto il {{alert.usedPercent}}% della capacit\u00e0.',
    capacity: 'Capacit\u00e0',
    used: 'Utilizzato',
    consumedPercent: 'Consumato',
    configuredPercent: 'Soglia configurata',
    closingNote: 'Controllare il pacchetto affinch\u00e9 l\u2019uso non diventi un superamento.',
    viewButton: 'Visualizza cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Soglia del pacchetto ore prepagato raggiunta',
    textIntro: 'Un pacchetto ore prepagato di {{client.name}} ha raggiunto il {{alert.usedPercent}}% della capacit\u00e0.',
    textClosingNote: 'Controllare il pacchetto affinch\u00e9 l\u2019uso non diventi un superamento.',
    textView: 'Visualizza cliente su',
  },
  pl: {
    headerLabel: 'Osi\u0105gni\u0119to pr\u00f3g pakietu godzin przedp\u0142aconych',
    intro: 'Pakiet godzin przedp\u0142aconych dla <strong>{{client.name}}</strong> osi\u0105gn\u0105\u0142 {{alert.usedPercent}}% swojej pojemno\u015bci.',
    capacity: 'Pojemno\u015b\u0107',
    used: 'Wykorzystano',
    consumedPercent: 'Zu\u017cycie',
    configuredPercent: 'Skonfigurowany pr\u00f3g',
    closingNote: 'Sprawd\u017a pakiet, aby zu\u017cycie nie zamieni\u0142o si\u0119 w nadwy\u017ck\u0119.',
    viewButton: 'Zobacz klienta',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Osi\u0105gni\u0119to pr\u00f3g pakietu godzin przedp\u0142aconych',
    textIntro: 'Pakiet godzin przedp\u0142aconych dla {{client.name}} osi\u0105gn\u0105\u0142 {{alert.usedPercent}}% swojej pojemno\u015bci.',
    textClosingNote: 'Sprawd\u017a pakiet, aby zu\u017cycie nie zamieni\u0142o si\u0119 w nadwy\u017ck\u0119.',
    textView: 'Zobacz klienta pod adresem',
  },
};
/* eslint-enable max-len */

CREDIT_SUBJECTS.pt = 'Crédito pré-pago baixo: {{client.name}}';
CREDIT_COPY.pt = {
  headerLabel: 'Crédito pré-pago baixo',
  intro: 'O crédito pré-pago de <strong>{{client.name}}</strong> caiu abaixo do limite configurado.',
  available: 'Crédito disponível',
  threshold: 'Limite configurado',
  currency: 'Moeda',
  closingNote: 'Revise o saldo para que o trabalho não seja interrompido.',
  viewButton: 'Ver cliente',
  footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
  textHeader: 'Crédito pré-pago baixo',
  textIntro: 'O crédito pré-pago de {{client.name}} caiu abaixo do limite configurado.',
  textClosingNote: 'Revise o saldo para que o trabalho não seja interrompido.',
  textView: 'Ver cliente em',
};

BUCKET_SUBJECTS.pt = 'Limite do pacote de horas pré-pago atingido: {{client.name}}';
BUCKET_COPY.pt = {
  headerLabel: 'Limite do pacote de horas pré-pago atingido',
  intro: 'Um pacote de horas pré-pago de <strong>{{client.name}}</strong> atingiu {{alert.usedPercent}}% da capacidade.',
  capacity: 'Capacidade',
  used: 'Usado',
  consumedPercent: 'Consumido',
  configuredPercent: 'Limite configurado',
  closingNote: 'Revise o pacote para que o uso não vire excedente.',
  viewButton: 'Ver cliente',
  footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
  textHeader: 'Limite do pacote de horas pré-pago atingido',
  textIntro: 'Um pacote de horas pré-pago de {{client.name}} atingiu {{alert.usedPercent}}% da capacidade.',
  textClosingNote: 'Revise o pacote para que o uso não vire excedente.',
  textView: 'Ver cliente em',
};

function buildCreditBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:200px;font-weight:600;color:#475467;">${c.available}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.available}} {{alert.currency}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.threshold}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.threshold}} {{alert.currency}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.currency}</td>
                    <td style="padding:12px 0;">{{alert.currency}}</td>
                  </tr>
                </table>
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{alert.link}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildCreditText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.available}: {{alert.available}} {{alert.currency}}
${c.threshold}: {{alert.threshold}} {{alert.currency}}
${c.currency}: {{alert.currency}}

${c.textClosingNote}

${c.textView}: {{alert.link}}`;
}

function buildBucketBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:200px;font-weight:600;color:#475467;">${c.capacity}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.capacity}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.used}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.used}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.consumedPercent}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.usedPercent}}%</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.configuredPercent}</td>
                    <td style="padding:12px 0;">{{alert.percent}}%</td>
                  </tr>
                </table>
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{alert.link}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildBucketText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.capacity}: {{alert.capacity}}
${c.used}: {{alert.used}}
${c.consumedPercent}: {{alert.usedPercent}}%
${c.configuredPercent}: {{alert.percent}}%

${c.textClosingNote}

${c.textView}: {{alert.link}}`;
}

function getCreditTemplate() {
  return {
    templateName: CREDIT_TEMPLATE_NAME,
    subtypeName: CREDIT_SUBTYPE_NAME,
    translations: Object.entries(CREDIT_COPY).map(([language, copy]) => ({
      language,
      subject: CREDIT_SUBJECTS[language],
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: copy.headerLabel,
        headerTitle: '{{client.name}}',
        bodyHtml: buildCreditBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildCreditText(copy),
    })),
  };
}

function getBucketTemplate() {
  return {
    templateName: BUCKET_TEMPLATE_NAME,
    subtypeName: BUCKET_SUBTYPE_NAME,
    translations: Object.entries(BUCKET_COPY).map(([language, copy]) => ({
      language,
      subject: BUCKET_SUBJECTS[language],
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: copy.headerLabel,
        headerTitle: '{{client.name}}',
        bodyHtml: buildBucketBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildBucketText(copy),
    })),
  };
}

function getTemplates() {
  return [getCreditTemplate(), getBucketTemplate()];
}

module.exports = {
  CREDIT_TEMPLATE_NAME,
  CREDIT_SUBTYPE_NAME,
  BUCKET_TEMPLATE_NAME,
  BUCKET_SUBTYPE_NAME,
  getCreditTemplate,
  getBucketTemplate,
  getTemplates,
};
