#!/usr/bin/env node
/**
 * One-off script: applies the new sender-display-name / configuration-label
 * keys to every email-providers locale file. Idempotent — re-running just
 * overwrites the same keys with the same values. Delete after merging.
 *
 *     node scripts/patch-email-provider-locales.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.resolve(
  __dirname,
  '..',
  'server',
  'public',
  'locales'
);

const REAL = {
  en: {
    configLabel: 'Configuration Name',
    configLabelStar: 'Configuration Name *',
    msPlaceholder: 'e.g., Support Mailbox (internal)',
    gmailPlaceholder: 'e.g., Support Gmail (internal)',
    imapPlaceholder: 'e.g., Support IMAP (internal)',
    providerNameHelp:
      'Internal name used to identify this configuration. Not shown in outbound emails.',
    senderLabel: 'Sender Display Name',
    senderPlaceholder: 'e.g., Acme Support',
    senderHelp:
      "Display name shown in the From header on outbound ticket emails (replies, closures). Applied only when this mailbox matches the tenant's outbound ticketing-from address. Leave blank to fall back to the ticket's board name.",
    configLabelRequired: 'Configuration name is required',
  },
  es: {
    configLabel: 'Nombre de configuración',
    configLabelStar: 'Nombre de configuración *',
    msPlaceholder: 'p. ej., Buzón de soporte (interno)',
    gmailPlaceholder: 'p. ej., Gmail de soporte (interno)',
    imapPlaceholder: 'p. ej., IMAP de soporte (interno)',
    providerNameHelp:
      'Nombre interno utilizado para identificar esta configuración. No se muestra en los correos salientes.',
    senderLabel: 'Nombre del remitente',
    senderPlaceholder: 'p. ej., Soporte Acme',
    senderHelp:
      'Nombre que se muestra en el encabezado De de los correos salientes de tickets (respuestas, cierres). Solo se aplica cuando este buzón coincide con la dirección de envío saliente del inquilino. Déjalo en blanco para usar el nombre del tablero del ticket.',
    configLabelRequired: 'El nombre de configuración es obligatorio',
  },
  fr: {
    configLabel: 'Nom de configuration',
    configLabelStar: 'Nom de configuration *',
    msPlaceholder: 'ex. : Boîte support (interne)',
    gmailPlaceholder: 'ex. : Gmail support (interne)',
    imapPlaceholder: 'ex. : IMAP support (interne)',
    providerNameHelp:
      "Nom interne utilisé pour identifier cette configuration. N'apparaît pas dans les e-mails sortants.",
    senderLabel: "Nom de l'expéditeur",
    senderPlaceholder: 'ex. : Acme Support',
    senderHelp:
      'Nom affiché dans l\'en-tête « De » des e-mails de tickets sortants (réponses, clôtures). Appliqué uniquement lorsque cette boîte correspond à l\'adresse d\'envoi sortante du locataire. Laissez vide pour utiliser le nom du tableau du ticket.',
    configLabelRequired: 'Le nom de configuration est obligatoire',
  },
  de: {
    configLabel: 'Konfigurationsname',
    configLabelStar: 'Konfigurationsname *',
    msPlaceholder: 'z. B. Support-Postfach (intern)',
    gmailPlaceholder: 'z. B. Support-Gmail (intern)',
    imapPlaceholder: 'z. B. Support-IMAP (intern)',
    providerNameHelp:
      'Interner Name zur Identifikation dieser Konfiguration. Wird in ausgehenden E-Mails nicht angezeigt.',
    senderLabel: 'Anzeigename des Absenders',
    senderPlaceholder: 'z. B. Acme Support',
    senderHelp:
      'Anzeigename, der im Absenderfeld ausgehender Ticket-E-Mails (Antworten, Abschlüsse) erscheint. Wird nur angewendet, wenn dieses Postfach der ausgehenden Ticketing-Adresse des Mandanten entspricht. Leer lassen, um den Boardnamen des Tickets zu verwenden.',
    configLabelRequired: 'Konfigurationsname ist erforderlich',
  },
  it: {
    configLabel: 'Nome configurazione',
    configLabelStar: 'Nome configurazione *',
    msPlaceholder: 'es. Mailbox di supporto (interna)',
    gmailPlaceholder: 'es. Gmail di supporto (interno)',
    imapPlaceholder: 'es. IMAP di supporto (interno)',
    providerNameHelp:
      'Nome interno usato per identificare questa configurazione. Non viene mostrato nelle email in uscita.',
    senderLabel: 'Nome visualizzato del mittente',
    senderPlaceholder: 'es. Acme Support',
    senderHelp:
      "Nome visualizzato nel campo Da delle email di ticket in uscita (risposte, chiusure). Applicato solo quando questa casella corrisponde all'indirizzo di invio in uscita del tenant. Lascia vuoto per usare il nome della board del ticket.",
    configLabelRequired: 'Il nome della configurazione è obbligatorio',
  },
  nl: {
    configLabel: 'Configuratienaam',
    configLabelStar: 'Configuratienaam *',
    msPlaceholder: 'bv. Support-postvak (intern)',
    gmailPlaceholder: 'bv. Support-Gmail (intern)',
    imapPlaceholder: 'bv. Support-IMAP (intern)',
    providerNameHelp:
      'Interne naam gebruikt om deze configuratie te identificeren. Niet zichtbaar in uitgaande e-mails.',
    senderLabel: 'Weergavenaam afzender',
    senderPlaceholder: 'bv. Acme Support',
    senderHelp:
      'Weergavenaam in het Van-veld van uitgaande ticket-e-mails (antwoorden, sluitingen). Alleen toegepast wanneer deze mailbox overeenkomt met het uitgaande ticket-verzendadres van de tenant. Laat leeg om de boardnaam van het ticket te gebruiken.',
    configLabelRequired: 'Configuratienaam is verplicht',
  },
  pl: {
    configLabel: 'Nazwa konfiguracji',
    configLabelStar: 'Nazwa konfiguracji *',
    msPlaceholder: 'np. Skrzynka wsparcia (wewnętrzna)',
    gmailPlaceholder: 'np. Gmail wsparcia (wewnętrzny)',
    imapPlaceholder: 'np. IMAP wsparcia (wewnętrzny)',
    providerNameHelp:
      'Wewnętrzna nazwa służąca do identyfikacji tej konfiguracji. Nie jest pokazywana w wiadomościach wychodzących.',
    senderLabel: 'Wyświetlana nazwa nadawcy',
    senderPlaceholder: 'np. Acme Support',
    senderHelp:
      'Wyświetlana nazwa w nagłówku Od w wychodzących wiadomościach zgłoszenia (odpowiedzi, zamknięcia). Stosowana tylko, gdy ta skrzynka odpowiada wychodzącemu adresowi zgłoszeń najemcy. Zostaw puste, aby użyć nazwy tablicy zgłoszenia.',
    configLabelRequired: 'Nazwa konfiguracji jest wymagana',
  },
  pt: {
    configLabel: 'Nome da configuração',
    configLabelStar: 'Nome da configuração *',
    msPlaceholder: 'ex.: Caixa de suporte (interna)',
    gmailPlaceholder: 'ex.: Gmail de suporte (interno)',
    imapPlaceholder: 'ex.: IMAP de suporte (interno)',
    providerNameHelp:
      'Nome interno usado para identificar esta configuração. Não é exibido em e-mails enviados.',
    senderLabel: 'Nome de exibição do remetente',
    senderPlaceholder: 'ex.: Acme Support',
    senderHelp:
      'Nome de exibição no cabeçalho De dos e-mails de tickets enviados (respostas, encerramentos). Aplicado apenas quando esta caixa de e-mail corresponde ao endereço de envio do locatário. Deixe em branco para usar o nome do quadro do ticket.',
    configLabelRequired: 'O nome da configuração é obrigatório',
  },
};

const PSEUDO = {
  xx: '11111',
  yy: '55555',
};

function patchForLocale(locale) {
  if (PSEUDO[locale]) {
    const v = PSEUDO[locale];
    return {
      configLabel: v,
      configLabelStar: v,
      msPlaceholder: v,
      gmailPlaceholder: v,
      imapPlaceholder: v,
      providerNameHelp: v,
      senderLabel: v,
      senderPlaceholder: v,
      senderHelp: v,
      configLabelRequired: v,
    };
  }
  return REAL[locale];
}

function setNested(obj, dottedPath, value) {
  const segments = dottedPath.split('.');
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof cur[seg] !== 'object' || cur[seg] === null) {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  cur[segments[segments.length - 1]] = value;
}

function buildPatch(t) {
  return {
    // CE Microsoft basic
    'forms.microsoft.basic.providerNameLabel': t.configLabelStar,
    'forms.microsoft.basic.providerNamePlaceholder': t.msPlaceholder,
    'forms.microsoft.basic.providerNameHelp': t.providerNameHelp,
    'forms.microsoft.basic.senderDisplayNameLabel': t.senderLabel,
    'forms.microsoft.basic.senderDisplayNamePlaceholder': t.senderPlaceholder,
    'forms.microsoft.basic.senderDisplayNameHelp': t.senderHelp,
    'forms.microsoft.validation.providerNameRequired': t.configLabelRequired,
    'forms.microsoft.requiredFields.providerName': t.configLabel,

    // CE Gmail basic
    'forms.gmail.basic.providerNameLabel': t.configLabelStar,
    'forms.gmail.basic.providerNamePlaceholder': t.gmailPlaceholder,
    'forms.gmail.basic.providerNameHelp': t.providerNameHelp,
    'forms.gmail.basic.senderDisplayNameLabel': t.senderLabel,
    'forms.gmail.basic.senderDisplayNamePlaceholder': t.senderPlaceholder,
    'forms.gmail.basic.senderDisplayNameHelp': t.senderHelp,
    'forms.gmail.validation.providerNameRequired': t.configLabelRequired,
    'forms.gmail.requiredFields.providerName': t.configLabel,

    // CE IMAP basic
    'forms.imap.basic.providerName': t.configLabel,
    'forms.imap.basic.providerNamePlaceholder': t.imapPlaceholder,
    'forms.imap.basic.providerNameHelp': t.providerNameHelp,
    'forms.imap.basic.senderDisplayName': t.senderLabel,
    'forms.imap.basic.senderDisplayNamePlaceholder': t.senderPlaceholder,
    'forms.imap.basic.senderDisplayNameHelp': t.senderHelp,
    'forms.imap.validation.providerNameRequired': t.configLabelRequired,

    // EE Microsoft (microsoftForm.*)
    'microsoftForm.fields.providerNameLabel': t.configLabelStar,
    'microsoftForm.fields.providerNamePlaceholder': t.msPlaceholder,
    'microsoftForm.fields.providerNameHelp': t.providerNameHelp,
    'microsoftForm.fields.senderDisplayNameLabel': t.senderLabel,
    'microsoftForm.fields.senderDisplayNamePlaceholder': t.senderPlaceholder,
    'microsoftForm.fields.senderDisplayNameHelp': t.senderHelp,
    'microsoftForm.validation.providerName': t.configLabel,

    // EE IMAP (imapForm.*)
    'imapForm.fields.providerName': t.configLabel,
    'imapForm.fields.providerNamePlaceholder': t.imapPlaceholder,
    'imapForm.fields.providerNameHelp': t.providerNameHelp,
    'imapForm.fields.senderDisplayName': t.senderLabel,
    'imapForm.fields.senderDisplayNamePlaceholder': t.senderPlaceholder,
    'imapForm.fields.senderDisplayNameHelp': t.senderHelp,
  };
}

function main() {
  const localeDirs = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const targets = localeDirs.filter((l) => REAL[l] || PSEUDO[l]);

  for (const locale of targets) {
    const file = path.join(
      LOCALES_DIR,
      locale,
      'msp',
      'email-providers.json'
    );
    if (!fs.existsSync(file)) {
      console.log(`skip ${locale}: file missing`);
      continue;
    }
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    const patch = buildPatch(patchForLocale(locale));
    let changed = 0;
    for (const [keyPath, value] of Object.entries(patch)) {
      setNested(json, keyPath, value);
      changed += 1;
    }
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`${locale}: patched ${changed} keys`);
  }
}

main();
