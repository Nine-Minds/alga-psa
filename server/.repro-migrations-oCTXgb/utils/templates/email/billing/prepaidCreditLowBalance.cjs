/**
 * Source-of-truth: prepaid credit low-balance email template (task 29.8.20).
 *
 * Uses the shared email layout wrapper. Only text differs between locales;
 * values are formatted by the delivery layer before rendering. One template
 * per file, matching the convention the i18n parity tooling depends on.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'prepaid-credit-low-balance';
const SUBTYPE_NAME = 'prepaid-credit-low-balance';

const SUBJECTS = {
  en: 'Prepaid credit running low: {{client.name}}',
  fr: 'Crédit prépayé faible : {{client.name}}',
  es: 'Crédito prepagado bajo: {{client.name}}',
  de: 'Prepaid-Guthaben niedrig: {{client.name}}',
  nl: 'Prepaid-tegoed bijna op: {{client.name}}',
  it: 'Credito prepagato basso: {{client.name}}',
  pl: 'Niski stan kredytu przedpłaconego: {{client.name}}',
};

const COPY = {
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
    headerLabel: 'Crédit prépayé faible',
    intro: 'Le crédit prépayé de <strong>{{client.name}}</strong> est passé sous le seuil configuré.',
    available: 'Crédit disponible',
    threshold: 'Seuil configuré',
    currency: 'Devise',
    closingNote: 'Vérifiez le solde afin d’éviter toute interruption du travail.',
    viewButton: 'Voir le client',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Crédit prépayé faible',
    textIntro: 'Le crédit prépayé de {{client.name}} est passé sous le seuil configuré.',
    textClosingNote: 'Vérifiez le solde afin d’éviter toute interruption du travail.',
    textView: 'Voir le client sur',
  },
  es: {
    headerLabel: 'Crédito prepagado bajo',
    intro: 'El crédito prepagado de <strong>{{client.name}}</strong> ha caído por debajo del umbral configurado.',
    available: 'Crédito disponible',
    threshold: 'Umbral configurado',
    currency: 'Moneda',
    closingNote: 'Revise el saldo para evitar interrupciones en el trabajo.',
    viewButton: 'Ver cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Crédito prepagado bajo',
    textIntro: 'El crédito prepagado de {{client.name}} ha caído por debajo del umbral configurado.',
    textClosingNote: 'Revise el saldo para evitar interrupciones en el trabajo.',
    textView: 'Ver cliente en',
  },
  de: {
    headerLabel: 'Prepaid-Guthaben niedrig',
    intro: 'Das Prepaid-Guthaben von <strong>{{client.name}}</strong> liegt unter dem konfigurierten Schwellenwert.',
    available: 'Verfügbares Guthaben',
    threshold: 'Konfigurierter Schwellenwert',
    currency: 'Währung',
    closingNote: 'Prüfen Sie den Kontostand, um Unterbrechungen zu vermeiden.',
    viewButton: 'Kunde anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Prepaid-Guthaben niedrig',
    textIntro: 'Das Prepaid-Guthaben von {{client.name}} liegt unter dem konfigurierten Schwellenwert.',
    textClosingNote: 'Prüfen Sie den Kontostand, um Unterbrechungen zu vermeiden.',
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
    footer: 'Powered by AlgaPSA &middot; Teams op één lijn houden',
    textHeader: 'Prepaid-tegoed bijna op',
    textIntro: 'Het prepaid-tegoed van {{client.name}} is onder de geconfigureerde drempel gedaald.',
    textClosingNote: 'Controleer het saldo om onderbrekingen te voorkomen.',
    textView: 'Klant bekijken op',
  },
  it: {
    headerLabel: 'Credito prepagato basso',
    intro: 'Il credito prepagato di <strong>{{client.name}}</strong> è sceso al di sotto della soglia configurata.',
    available: 'Credito disponibile',
    threshold: 'Soglia configurata',
    currency: 'Valuta',
    closingNote: 'Controllare il saldo per evitare interruzioni del lavoro.',
    viewButton: 'Visualizza cliente',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Credito prepagato basso',
    textIntro: 'Il credito prepagato di {{client.name}} è sceso al di sotto della soglia configurata.',
    textClosingNote: 'Controllare il saldo per evitare interruzioni del lavoro.',
    textView: 'Visualizza cliente su',
  },
  pl: {
    headerLabel: 'Niski stan kredytu przedpłaconego',
    intro: 'Kredyt przedpłacony dla <strong>{{client.name}}</strong> spadł poniżej skonfigurowanego progu.',
    available: 'Dostępny kredyt',
    threshold: 'Skonfigurowany próg',
    currency: 'Waluta',
    closingNote: 'Sprawdź saldo, aby uniknąć przerw w pracy.',
    viewButton: 'Zobacz klienta',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Niski stan kredytu przedpłaconego',
    textIntro: 'Kredyt przedpłacony dla {{client.name}} spadł poniżej skonfigurowanego progu.',
    textClosingNote: 'Sprawdź saldo, aby uniknąć przerw w pracy.',
    textView: 'Zobacz klienta pod adresem',
  },
};

SUBJECTS.pt = 'Crédito pré-pago baixo: {{client.name}}';
COPY.pt = {
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

function buildBodyHtml(c) {
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

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.available}: {{alert.available}} {{alert.currency}}
${c.threshold}: {{alert.threshold}} {{alert.currency}}
${c.currency}: {{alert.currency}}

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
