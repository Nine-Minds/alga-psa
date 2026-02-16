/**
 * Source-of-truth: email-verification email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * English has full styled CSS-class-based HTML; fr/es/de/nl/it from seed 86
 * use simple inline styles; Polish has its own styled version.
 */

const TEMPLATE_NAME = 'email-verification';
const SUBTYPE_NAME = 'email-verification';

/* ------------------------------------------------------------------ */
/*  Shared CSS for the styled email-verification template (en/fr/es/  */
/*  de/nl/it styled versions from migration 20251029100000)           */
/* ------------------------------------------------------------------ */
const EMAIL_VERIFICATION_CSS = `
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .verification-box {
      background: #eff6ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #bfdbfe;
      border-left: 4px solid #3b82f6;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .verification-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .verification-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #3b82f6;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #2563eb;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #78350f;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #78350f;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #3b82f6;
      text-decoration: underline;
    }
    a:hover {
      color: #2563eb;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }`;

/* eslint-disable max-len */

/* ------------------------------------------------------------------ */
/*  Styled email-verification copy (en + fr/es/de/nl/it from          */
/*  migration 20251029100000)                                         */
/* ------------------------------------------------------------------ */
const STYLED_COPY = {
  en: {
    subject: 'Verify your email{{#if registrationClientName}} for {{registrationClientName}}{{/if}}',
    headerTitle: 'Email Verification',
    headerSubtitle: 'Confirm your email address to get started',
    greeting: 'Hello,',
    intro: 'Welcome! Please verify your email address to activate your account{{#if registrationClientName}} for <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f Why verify your email?',
    why1: '\u2713 Ensures account security and recovery options',
    why2: '\u2713 Enables important notifications and updates',
    why3: '\u2713 Confirms you\'re the account owner',
    buttonText: 'Verify Email Address',
    linkInstructions: 'Or copy and paste this link into your browser:',
    warningTitle: '\u23f0 Time-Sensitive Verification',
    warningText: 'This verification link will expire in <strong>{{expirationTime}}</strong>. Please complete verification before then.',
    didntRequest: '<strong>Didn\'t request this email?</strong> You can safely ignore it. Your email address won\'t be added to our system unless you click the verification link above.',
    footer1: 'This is an automated security email.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. All rights reserved.',
    textWhy: '\u2709\ufe0f Why verify your email?\n\u2713 Ensures account security and recovery options\n\u2713 Enables important notifications and updates\n\u2713 Confirms you\'re the account owner',
    textButton: 'Verify Email Address: {{verificationUrl}}',
    textWarning: '\u23f0 Time-Sensitive Verification\nThis verification link will expire in {{expirationTime}}. Please complete verification before then.',
    textDidntRequest: 'Didn\'t request this email? You can safely ignore it. Your email address won\'t be added to our system unless you click the verification link above.',
    textFooter: 'This is an automated security email.\n\u00a9 {{currentYear}} {{tenantClientName}}. All rights reserved.',
  },
  fr: {
    subject: 'V\u00e9rifiez votre email{{#if registrationClientName}} pour {{registrationClientName}}{{/if}}',
    headerTitle: 'V\u00e9rification d\'email',
    headerSubtitle: 'Confirmez votre adresse email pour commencer',
    greeting: 'Bonjour,',
    intro: 'Bienvenue ! Veuillez v\u00e9rifier votre adresse email pour activer votre compte{{#if registrationClientName}} pour <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f Pourquoi v\u00e9rifier votre email ?',
    why1: '\u2713 Assure la s\u00e9curit\u00e9 du compte et les options de r\u00e9cup\u00e9ration',
    why2: '\u2713 Active les notifications et mises \u00e0 jour importantes',
    why3: '\u2713 Confirme que vous \u00eates le propri\u00e9taire du compte',
    buttonText: 'V\u00e9rifier l\'adresse email',
    linkInstructions: 'Ou copiez et collez ce lien dans votre navigateur :',
    warningTitle: '\u23f0 V\u00e9rification \u00e0 dur\u00e9e limit\u00e9e',
    warningText: 'Ce lien de v\u00e9rification expirera dans <strong>{{expirationTime}}</strong>. Veuillez compl\u00e9ter la v\u00e9rification avant.',
    didntRequest: '<strong>Vous n\'avez pas demand\u00e9 cet email ?</strong> Vous pouvez l\'ignorer en toute s\u00e9curit\u00e9. Votre adresse email ne sera pas ajout\u00e9e \u00e0 notre syst\u00e8me sauf si vous cliquez sur le lien de v\u00e9rification ci-dessus.',
    footer1: 'Ceci est un email de s\u00e9curit\u00e9 automatis\u00e9.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. Tous droits r\u00e9serv\u00e9s.',
    textWhy: '\u2709\ufe0f Pourquoi v\u00e9rifier votre email ?\n\u2713 Assure la s\u00e9curit\u00e9 du compte et les options de r\u00e9cup\u00e9ration\n\u2713 Active les notifications et mises \u00e0 jour importantes\n\u2713 Confirme que vous \u00eates le propri\u00e9taire du compte',
    textButton: 'V\u00e9rifier l\'adresse email : {{verificationUrl}}',
    textWarning: '\u23f0 V\u00e9rification \u00e0 dur\u00e9e limit\u00e9e\nCe lien de v\u00e9rification expirera dans {{expirationTime}}. Veuillez compl\u00e9ter la v\u00e9rification avant.',
    textDidntRequest: 'Vous n\'avez pas demand\u00e9 cet email ? Vous pouvez l\'ignorer en toute s\u00e9curit\u00e9. Votre adresse email ne sera pas ajout\u00e9e \u00e0 notre syst\u00e8me sauf si vous cliquez sur le lien de v\u00e9rification ci-dessus.',
    textFooter: 'Ceci est un email de s\u00e9curit\u00e9 automatis\u00e9.\n\u00a9 {{currentYear}} {{tenantClientName}}. Tous droits r\u00e9serv\u00e9s.',
  },
  es: {
    subject: 'Verifica tu email{{#if registrationClientName}} para {{registrationClientName}}{{/if}}',
    headerTitle: 'Verificaci\u00f3n de email',
    headerSubtitle: 'Confirma tu direcci\u00f3n de email para comenzar',
    greeting: 'Hola,',
    intro: '\u00a1Bienvenido! Por favor verifica tu direcci\u00f3n de email para activar tu cuenta{{#if registrationClientName}} para <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f \u00bfPor qu\u00e9 verificar tu email?',
    why1: '\u2713 Garantiza la seguridad de la cuenta y opciones de recuperaci\u00f3n',
    why2: '\u2713 Habilita notificaciones y actualizaciones importantes',
    why3: '\u2713 Confirma que eres el propietario de la cuenta',
    buttonText: 'Verificar direcci\u00f3n de email',
    linkInstructions: 'O copia y pega este enlace en tu navegador:',
    warningTitle: '\u23f0 Verificaci\u00f3n con l\u00edmite de tiempo',
    warningText: 'Este enlace de verificaci\u00f3n expirar\u00e1 en <strong>{{expirationTime}}</strong>. Por favor completa la verificaci\u00f3n antes.',
    didntRequest: '<strong>\u00bfNo solicitaste este email?</strong> Puedes ignorarlo de forma segura. Tu direcci\u00f3n de email no se agregar\u00e1 a nuestro sistema a menos que hagas clic en el enlace de verificaci\u00f3n anterior.',
    footer1: 'Este es un email de seguridad automatizado.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. Todos los derechos reservados.',
    textWhy: '\u2709\ufe0f \u00bfPor qu\u00e9 verificar tu email?\n\u2713 Garantiza la seguridad de la cuenta y opciones de recuperaci\u00f3n\n\u2713 Habilita notificaciones y actualizaciones importantes\n\u2713 Confirma que eres el propietario de la cuenta',
    textButton: 'Verificar direcci\u00f3n de email: {{verificationUrl}}',
    textWarning: '\u23f0 Verificaci\u00f3n con l\u00edmite de tiempo\nEste enlace de verificaci\u00f3n expirar\u00e1 en {{expirationTime}}. Por favor completa la verificaci\u00f3n antes.',
    textDidntRequest: '\u00bfNo solicitaste este email? Puedes ignorarlo de forma segura. Tu direcci\u00f3n de email no se agregar\u00e1 a nuestro sistema a menos que hagas clic en el enlace de verificaci\u00f3n anterior.',
    textFooter: 'Este es un email de seguridad automatizado.\n\u00a9 {{currentYear}} {{tenantClientName}}. Todos los derechos reservados.',
  },
  de: {
    subject: 'Verifizieren Sie Ihre E-Mail{{#if registrationClientName}} f\u00fcr {{registrationClientName}}{{/if}}',
    headerTitle: 'E-Mail-Verifizierung',
    headerSubtitle: 'Best\u00e4tigen Sie Ihre E-Mail-Adresse, um zu beginnen',
    greeting: 'Hallo,',
    intro: 'Willkommen! Bitte verifizieren Sie Ihre E-Mail-Adresse, um Ihr Konto zu aktivieren{{#if registrationClientName}} f\u00fcr <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f Warum Ihre E-Mail verifizieren?',
    why1: '\u2713 Gew\u00e4hrleistet Kontosicherheit und Wiederherstellungsoptionen',
    why2: '\u2713 Aktiviert wichtige Benachrichtigungen und Updates',
    why3: '\u2713 Best\u00e4tigt, dass Sie der Kontoinhaber sind',
    buttonText: 'E-Mail-Adresse verifizieren',
    linkInstructions: 'Oder kopieren Sie diesen Link in Ihren Browser:',
    warningTitle: '\u23f0 Zeitlich begrenzte Verifizierung',
    warningText: 'Dieser Verifizierungslink l\u00e4uft in <strong>{{expirationTime}}</strong> ab. Bitte schlie\u00dfen Sie die Verifizierung vorher ab.',
    didntRequest: '<strong>Haben Sie diese E-Mail nicht angefordert?</strong> Sie k\u00f6nnen sie sicher ignorieren. Ihre E-Mail-Adresse wird unserem System nicht hinzugef\u00fcgt, es sei denn, Sie klicken auf den Verifizierungslink oben.',
    footer1: 'Dies ist eine automatisierte Sicherheits-E-Mail.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. Alle Rechte vorbehalten.',
    textWhy: '\u2709\ufe0f Warum Ihre E-Mail verifizieren?\n\u2713 Gew\u00e4hrleistet Kontosicherheit und Wiederherstellungsoptionen\n\u2713 Aktiviert wichtige Benachrichtigungen und Updates\n\u2713 Best\u00e4tigt, dass Sie der Kontoinhaber sind',
    textButton: 'E-Mail-Adresse verifizieren: {{verificationUrl}}',
    textWarning: '\u23f0 Zeitlich begrenzte Verifizierung\nDieser Verifizierungslink l\u00e4uft in {{expirationTime}} ab. Bitte schlie\u00dfen Sie die Verifizierung vorher ab.',
    textDidntRequest: 'Haben Sie diese E-Mail nicht angefordert? Sie k\u00f6nnen sie sicher ignorieren. Ihre E-Mail-Adresse wird unserem System nicht hinzugef\u00fcgt, es sei denn, Sie klicken auf den Verifizierungslink oben.',
    textFooter: 'Dies ist eine automatisierte Sicherheits-E-Mail.\n\u00a9 {{currentYear}} {{tenantClientName}}. Alle Rechte vorbehalten.',
  },
  nl: {
    subject: 'Verifieer uw e-mail{{#if registrationClientName}} voor {{registrationClientName}}{{/if}}',
    headerTitle: 'E-mailverificatie',
    headerSubtitle: 'Bevestig uw e-mailadres om te beginnen',
    greeting: 'Hallo,',
    intro: 'Welkom! Verifieer uw e-mailadres om uw account te activeren{{#if registrationClientName}} voor <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f Waarom uw e-mail verifi\u00ebren?',
    why1: '\u2713 Zorgt voor accountbeveiliging en hersteloptjes',
    why2: '\u2713 Schakelt belangrijke meldingen en updates in',
    why3: '\u2713 Bevestigt dat u de accounteigenaar bent',
    buttonText: 'E-mailadres verifi\u00ebren',
    linkInstructions: 'Of kopieer en plak deze link in uw browser:',
    warningTitle: '\u23f0 Tijdgevoelige verificatie',
    warningText: 'Deze verificatielink verloopt over <strong>{{expirationTime}}</strong>. Voltooi de verificatie v\u00f3\u00f3r die tijd.',
    didntRequest: '<strong>Heeft u deze e-mail niet aangevraagd?</strong> U kunt deze veilig negeren. Uw e-mailadres wordt niet toegevoegd aan ons systeem tenzij u op de verificatielink hierboven klikt.',
    footer1: 'Dit is een geautomatiseerde beveiligingse-mail.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. Alle rechten voorbehouden.',
    textWhy: '\u2709\ufe0f Waarom uw e-mail verifi\u00ebren?\n\u2713 Zorgt voor accountbeveiliging en hersteloptjes\n\u2713 Schakelt belangrijke meldingen en updates in\n\u2713 Bevestigt dat u de accounteigenaar bent',
    textButton: 'E-mailadres verifi\u00ebren: {{verificationUrl}}',
    textWarning: '\u23f0 Tijdgevoelige verificatie\nDeze verificatielink verloopt over {{expirationTime}}. Voltooi de verificatie v\u00f3\u00f3r die tijd.',
    textDidntRequest: 'Heeft u deze e-mail niet aangevraagd? U kunt deze veilig negeren. Uw e-mailadres wordt niet toegevoegd aan ons systeem tenzij u op de verificatielink hierboven klikt.',
    textFooter: 'Dit is een geautomatiseerde beveiligingse-mail.\n\u00a9 {{currentYear}} {{tenantClientName}}. Alle rechten voorbehouden.',
  },
  it: {
    subject: 'Verifica il tuo indirizzo email{{#if registrationClientName}} per {{registrationClientName}}{{/if}}',
    headerTitle: 'Verifica email',
    headerSubtitle: 'Conferma il tuo indirizzo email per iniziare',
    greeting: 'Ciao,',
    intro: 'Benvenuto! Verifica il tuo indirizzo email per attivare il tuo account{{#if registrationClientName}} per <strong>{{registrationClientName}}</strong>{{/if}}.',
    whyTitle: '\u2709\ufe0f Perch\u00e9 verificare la tua email?',
    why1: '\u2713 Garantisce la sicurezza dell\'account e le opzioni di recupero',
    why2: '\u2713 Abilita notifiche e aggiornamenti importanti',
    why3: '\u2713 Conferma che sei il proprietario dell\'account',
    buttonText: 'Verifica indirizzo email',
    linkInstructions: 'Oppure copia e incolla questo link nel tuo browser:',
    warningTitle: '\u23f0 Verifica a tempo limitato',
    warningText: 'Questo link di verifica scadr\u00e0 tra <strong>{{expirationTime}}</strong>. Completa la verifica prima di allora.',
    didntRequest: '<strong>Non hai richiesto questa email?</strong> Puoi ignorarla tranquillamente. Il tuo indirizzo email non verr\u00e0 aggiunto al nostro sistema a meno che tu non faccia clic sul link di verifica qui sopra.',
    footer1: 'Questa \u00e8 un\'email di sicurezza automatica.',
    footer2: '\u00a9 {{currentYear}} {{tenantClientName}}. Tutti i diritti riservati.',
    textWhy: '\u2709\ufe0f Perch\u00e9 verificare la tua email?\n\u2713 Garantisce la sicurezza dell\'account e le opzioni di recupero\n\u2713 Abilita notifiche e aggiornamenti importanti\n\u2713 Conferma che sei il proprietario dell\'account',
    textButton: 'Verifica indirizzo email: {{verificationUrl}}',
    textWarning: '\u23f0 Verifica a tempo limitato\nQuesto link di verifica scadr\u00e0 tra {{expirationTime}}. Completa la verifica prima di allora.',
    textDidntRequest: 'Non hai richiesto questa email? Puoi ignorarla tranquillamente. Il tuo indirizzo email non verr\u00e0 aggiunto al nostro sistema a meno che tu non faccia clic sul link di verifica qui sopra.',
    textFooter: 'Questa \u00e8 un\'email di sicurezza automatica.\n\u00a9 {{currentYear}} {{tenantClientName}}. Tutti i diritti riservati.',
  },
};
/* eslint-enable max-len */

function buildStyledHtml(c) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
  <style>${EMAIL_VERIFICATION_CSS}
  </style>
</head>
<body>
  <div class="header">
    <h1>${c.headerTitle}</h1>
    <p>${c.headerSubtitle}</p>
  </div>

  <div class="content">
    <h2>${c.greeting}</h2>

    <p>${c.intro}</p>

    <div class="verification-box">
      <h3>${c.whyTitle}</h3>
      <p>${c.why1}</p>
      <p>${c.why2}</p>
      <p>${c.why3}</p>
    </div>

    <div style="text-align: center;">
      <a href="{{verificationUrl}}" class="action-button">${c.buttonText}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${c.linkInstructions}
    </p>
    <div class="link-text">{{verificationUrl}}</div>

    {{#if expirationTime}}
    <div class="warning">
      <h4>${c.warningTitle}</h4>
      <p>${c.warningText}</p>
    </div>
    {{/if}}

    <div class="divider"></div>

    <p style="color: #64748b; font-size: 14px;">
      ${c.didntRequest}
    </p>
  </div>

  <div class="footer">
    <p>${c.footer1}</p>
    <p>${c.footer2}</p>
  </div>
</body>
</html>`;
}

function buildStyledText(c) {
  return `${c.headerTitle}

${c.greeting}

${c.intro.replace(/<[^>]+>/g, '')}

${c.textWhy}

${c.textButton}

{{#if expirationTime}}${c.textWarning}{{/if}}

${c.textDidntRequest}

---
${c.textFooter}`;
}

/* ------------------------------------------------------------------ */
/*  Polish styled version (from migration 20251228123000)             */
/* ------------------------------------------------------------------ */
function buildPolishHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weryfikacja adresu email</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .content { background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-bottom: none; }
    .footer { background: #1e293b; color: #cbd5e1; padding: 24px; border-radius: 0 0 12px 12px; text-align: center; font-size: 14px; }
    .action-button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .warning { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 24px 0; }
    .link-text { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #475569; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Zweryfikuj sw\u00f3j adres email</h1>
    <p>Jeszcze jeden krok do uko\u0144czenia rejestracji</p>
  </div>
  <div class="content">
    <h2>Witaj{{#if contactName}} {{contactName}}{{/if}},</h2>
    <p>Dzi\u0119kujemy za rejestracj\u0119! Prosz\u0119 zweryfikowa\u0107 sw\u00f3j adres email, klikaj\u0105c poni\u017cszy przycisk:</p>
    <div style="text-align: center;">
      <a href="{{verificationLink}}" class="action-button">Zweryfikuj adres email</a>
    </div>
    <p style="text-align: center; color: #64748b; font-size: 14px;">Lub skopiuj i wklej ten link do przegl\u0105darki:</p>
    <div class="link-text">{{verificationLink}}</div>
    <div class="warning">
      <h4>\u23f0 Link ograniczony czasowo</h4>
      <p>Ten link weryfikacyjny wyga\u015bnie za {{expirationTime}}. Je\u015bli link wyga\u015bnie, mo\u017cesz poprosi\u0107 o nowy na stronie logowania.</p>
    </div>
    <p style="color: #64748b; font-size: 14px;">Je\u015bli nie zak\u0142ada\u0142e\u015b(a\u015b) konta, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107.</p>
  </div>
  <div class="footer">
    <p>Ta wiadomo\u015b\u0107 zosta\u0142a wys\u0142ana automatycznie. Prosimy nie odpowiada\u0107 na ni\u0105.</p>
  </div>
</body>
</html>`;
}

function buildPolishText() {
  return `Zweryfikuj sw\u00f3j adres email

Witaj{{#if contactName}} {{contactName}}{{/if}},

Dzi\u0119kujemy za rejestracj\u0119! Prosz\u0119 zweryfikowa\u0107 sw\u00f3j adres email, klikaj\u0105c poni\u017cszy link:

{{verificationLink}}

\u23f0 Link ograniczony czasowo
Ten link weryfikacyjny wyga\u015bnie za {{expirationTime}}. Je\u015bli link wyga\u015bnie, mo\u017cesz poprosi\u0107 o nowy na stronie logowania.

Je\u015bli nie zak\u0142ada\u0142e\u015b(a\u015b) konta, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107.`;
}

function getTemplate() {
  const translations = [];

  // Styled versions for en, fr, es, de, nl, it
  for (const [lang, copy] of Object.entries(STYLED_COPY)) {
    translations.push({
      language: lang,
      subject: copy.subject,
      htmlContent: buildStyledHtml(copy),
      textContent: buildStyledText(copy),
    });
  }

  // Polish - own styled version
  translations.push({
    language: 'pl',
    subject: 'Zweryfikuj sw\u00f3j adres email{{#if registrationClientName}} dla {{registrationClientName}}{{/if}}',
    htmlContent: buildPolishHtml(),
    textContent: buildPolishText(),
  });

  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations,
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
