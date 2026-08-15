/**
 * Source-of-truth: prepaid hour bucket threshold-reached email template
 * (task 29.8.20).
 *
 * Uses the shared email layout wrapper. Only text differs between locales;
 * values are formatted by the delivery layer before rendering. One template
 * per file, matching the convention the i18n parity tooling depends on.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'prepaid-bucket-threshold-reached';
const SUBTYPE_NAME = 'prepaid-bucket-threshold-reached';

const SUBJECTS = {
  en: 'Prepaid hour bucket threshold reached: {{client.name}}',
  fr: 'Seuil du bloc d’heures prépayées atteint : {{client.name}}',
  es: 'Umbral del paquete de horas prepagado alcanzado: {{client.name}}',
  de: 'Schwellenwert des Prepaid-Stundenpakets erreicht: {{client.name}}',
  nl: 'Drempel prepaid-urenpakket bereikt: {{client.name}}',
  it: 'Soglia del pacchetto ore prepagato raggiunta: {{client.name}}',
  pl: 'Osiągnięto próg pakietu godzin przedpłaconych: {{client.name}}',
};

const COPY = {
  en: {
    headerLabel: 'Prepaid Hour Bucket Threshold Reached',
    intro: 'A prepaid hour bucket for <strong>{{client.name}}</strong> has reached {{alert.usedPercent}}% of its capacity.',
    capacity: 'Capacity',
    used: 'Used',
    consumedPercent: 'Consumed',
    configuredPercent: 'Configured threshold',
    period: 'Usage period',
    closingNote: 'Review the bucket so usage does not turn into overage.',
    viewButton: 'View Client',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textHeader: 'Prepaid Hour Bucket Threshold Reached',
    textIntro: 'A prepaid hour bucket for {{client.name}} has reached {{alert.usedPercent}}% of its capacity.',
    textClosingNote: 'Review the bucket so usage does not turn into overage.',
    textView: 'View client at',
  },
  fr: {
    headerLabel: 'Seuil du bloc d’heures prépayées atteint',
    intro: 'Un bloc d’heures prépayées de <strong>{{client.name}}</strong> a atteint {{alert.usedPercent}} % de sa capacité.',
    capacity: 'Capacité',
    used: 'Utilisé',
    consumedPercent: 'Consommé',
    configuredPercent: 'Seuil configuré',
    period: 'Période d’utilisation',
    closingNote: 'Vérifiez le bloc afin d’éviter les dépassements.',
    viewButton: 'Voir le client',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Seuil du bloc d’heures prépayées atteint',
    textIntro: 'Un bloc d’heures prépayées de {{client.name}} a atteint {{alert.usedPercent}} % de sa capacité.',
    textClosingNote: 'Vérifiez le bloc afin d’éviter les dépassements.',
    textView: 'Voir le client sur',
  },
  es: {
    headerLabel: 'Umbral del paquete de horas prepagado alcanzado',
    intro: 'Un paquete de horas prepagado de <strong>{{client.name}}</strong> ha alcanzado el {{alert.usedPercent}}% de su capacidad.',
    capacity: 'Capacidad',
    used: 'Usado',
    consumedPercent: 'Consumido',
    configuredPercent: 'Umbral configurado',
    period: 'Período de uso',
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
    intro: 'Ein Prepaid-Stundenpaket von <strong>{{client.name}}</strong> hat {{alert.usedPercent}}% seiner Kapazität erreicht.',
    capacity: 'Kapazität',
    used: 'Verbraucht',
    consumedPercent: 'Verbrauch',
    configuredPercent: 'Konfigurierter Schwellenwert',
    period: 'Nutzungszeitraum',
    closingNote: 'Prüfen Sie das Paket, damit Überstunden nicht zum Überhang werden.',
    viewButton: 'Kunde anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Schwellenwert des Prepaid-Stundenpakets erreicht',
    textIntro: 'Ein Prepaid-Stundenpaket von {{client.name}} hat {{alert.usedPercent}}% seiner Kapazität erreicht.',
    textClosingNote: 'Prüfen Sie das Paket, damit Überstunden nicht zum Überhang werden.',
    textView: 'Kunde ansehen unter',
  },
  nl: {
    headerLabel: 'Drempel prepaid-urenpakket bereikt',
    intro: 'Een prepaid-urenpakket van <strong>{{client.name}}</strong> heeft {{alert.usedPercent}}% van de capaciteit bereikt.',
    capacity: 'Capaciteit',
    used: 'Verbruikt',
    consumedPercent: 'Verbruik',
    configuredPercent: 'Geconfigureerde drempel',
    period: 'Gebruiksperiode',
    closingNote: 'Controleer het pakket zodat verbruik geen overschrijding wordt.',
    viewButton: 'Klant bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op één lijn houden',
    textHeader: 'Drempel prepaid-urenpakket bereikt',
    textIntro: 'Een prepaid-urenpakket van {{client.name}} heeft {{alert.usedPercent}}% van de capaciteit bereikt.',
    textClosingNote: 'Controleer het pakket zodat verbruik geen overschrijding wordt.',
    textView: 'Klant bekijken op',
  },
  it: {
    headerLabel: 'Soglia del pacchetto ore prepagato raggiunta',
    intro: 'Un pacchetto ore prepagato di <strong>{{client.name}}</strong> ha raggiunto il {{alert.usedPercent}}% della capacità.',
    capacity: 'Capacità',
    used: 'Utilizzato',
    consumedPercent: 'Consumato',
    configuredPercent: 'Soglia configurata',
    period: 'Periodo di utilizzo',
    closingNote: 'Controllare il pacchetto affinché l’uso non diventi un superamento.',
    viewButton: 'Visualizza cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Soglia del pacchetto ore prepagato raggiunta',
    textIntro: 'Un pacchetto ore prepagato di {{client.name}} ha raggiunto il {{alert.usedPercent}}% della capacità.',
    textClosingNote: 'Controllare il pacchetto affinché l’uso non diventi un superamento.',
    textView: 'Visualizza cliente su',
  },
  pl: {
    headerLabel: 'Osiągnięto próg pakietu godzin przedpłaconych',
    intro: 'Pakiet godzin przedpłaconych dla <strong>{{client.name}}</strong> osiągnął {{alert.usedPercent}}% swojej pojemności.',
    capacity: 'Pojemność',
    used: 'Wykorzystano',
    consumedPercent: 'Zużycie',
    configuredPercent: 'Skonfigurowany próg',
    period: 'Okres użytkowania',
    closingNote: 'Sprawdź pakiet, aby zużycie nie zamieniło się w nadwyżkę.',
    viewButton: 'Zobacz klienta',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Osiągnięto próg pakietu godzin przedpłaconych',
    textIntro: 'Pakiet godzin przedpłaconych dla {{client.name}} osiągnął {{alert.usedPercent}}% swojej pojemności.',
    textClosingNote: 'Sprawdź pakiet, aby zużycie nie zamieniło się w nadwyżkę.',
    textView: 'Zobacz klienta pod adresem',
  },
};

SUBJECTS.pt = 'Limite do pacote de horas pré-pago atingido: {{client.name}}';
COPY.pt = {
  headerLabel: 'Limite do pacote de horas pré-pago atingido',
  intro: 'Um pacote de horas pré-pago de <strong>{{client.name}}</strong> atingiu {{alert.usedPercent}}% da capacidade.',
  capacity: 'Capacidade',
  used: 'Usado',
  consumedPercent: 'Consumido',
  configuredPercent: 'Limite configurado',
  period: 'Período de uso',
  closingNote: 'Revise o pacote para que o uso não vire excedente.',
  viewButton: 'Ver cliente',
  footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
  textHeader: 'Limite do pacote de horas pré-pago atingido',
  textIntro: 'Um pacote de horas pré-pago de {{client.name}} atingiu {{alert.usedPercent}}% da capacidade.',
  textClosingNote: 'Revise o pacote para que o uso não vire excedente.',
  textView: 'Ver cliente em',
};

function buildBodyHtml(c) {
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.configuredPercent}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{alert.percent}}%</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.period}</td>
                    <td style="padding:12px 0;">{{alert.periodStart}} &ndash; {{alert.periodEnd}}</td>
                  </tr>
                </table>
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{alert.link}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.capacity}: {{alert.capacity}}
${c.used}: {{alert.used}}
${c.consumedPercent}: {{alert.usedPercent}}%
${c.configuredPercent}: {{alert.percent}}%
${c.period}: {{alert.periodStart}} - {{alert.periodEnd}}

${c.textClosingNote}

${c.textView}: {{alert.link}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([language, copy]) => ({
      language,
      subject: SUBJECTS[language],
      htmlContent: wrapEmailLayout({
        language,
        headerLabel: copy.headerLabel,
        headerTitle: '{{client.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
