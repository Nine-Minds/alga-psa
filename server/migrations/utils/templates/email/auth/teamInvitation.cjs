/**
 * Source-of-truth: team-invitation email template.
 *
 * Sent to internal (MSP) team members invited from onboarding or
 * Settings > Users, mirroring portal-invitation's structure/CSS but for
 * staff joining the MSP's own workspace rather than a client portal.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * Locales match the set used elsewhere in the onboarding wizard
 * (en, de, es, fr, it).
 */

const TEMPLATE_NAME = 'team-invitation';
const SUBTYPE_NAME = 'team-invitation';

/* ------------------------------------------------------------------ */
/*  Shared CSS (mirrors portal-invitation's brand styling)             */
/* ------------------------------------------------------------------ */
const TEAM_INVITATION_CSS = `
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
      background: linear-gradient(135deg, #8A4DEA, #40CFF9);
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
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
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
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
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
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
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
/*  Per-language copy                                                 */
/* ------------------------------------------------------------------ */
const COPY = {
  en: {
    subject: "You're invited to join {{tenantName}} on AlgaPSA",
    title: 'Team Invitation',
    headerTitle: 'Welcome to the Team',
    headerSubtitle: "You're invited to join {{tenantName}}",
    greeting: 'Hello {{teamMemberName}},',
    intro: '{{invitedByName}} has invited you to join <strong>{{tenantName}}</strong> as a <strong>{{roleName}}</strong>. Set up your account to get started.',
    infoBoxTitle: 'What happens next',
    feature1: '✓ Click the button below to set your own password',
    feature2: '✓ Sign in with your work email and new password',
    feature3: '✓ Start managing tickets, clients, and projects right away',
    buttonLabel: 'Set Up Your Account',
    copyLinkHint: 'Or copy and paste this link into your browser:',
    warningTitle: '⏰ Time-Sensitive Invitation',
    warningText: 'This invitation link will expire in <strong>{{expirationTime}}</strong>. Please complete your account setup before then.',
    footerSent: 'This email was sent to {{teamMemberName}} as part of your {{tenantName}} account setup.',
    footerUnexpected: "If you didn't expect this invitation, you can safely ignore this email.",
    footerCopyright: '© {{currentYear}} {{tenantName}}. All rights reserved.',
  },
  de: {
    subject: 'Sie sind eingeladen, {{tenantName}} auf AlgaPSA beizutreten',
    title: 'Team-Einladung',
    headerTitle: 'Willkommen im Team',
    headerSubtitle: 'Sie sind eingeladen, {{tenantName}} beizutreten',
    greeting: 'Hallo {{teamMemberName}},',
    intro: '{{invitedByName}} hat Sie eingeladen, <strong>{{tenantName}}</strong> als <strong>{{roleName}}</strong> beizutreten. Richten Sie Ihr Konto ein, um loszulegen.',
    infoBoxTitle: 'Wie es weitergeht',
    feature1: '✓ Klicken Sie unten auf die Schaltfläche, um Ihr eigenes Passwort festzulegen',
    feature2: '✓ Melden Sie sich mit Ihrer Arbeits-E-Mail und dem neuen Passwort an',
    feature3: '✓ Verwalten Sie sofort Tickets, Kunden und Projekte',
    buttonLabel: 'Konto einrichten',
    copyLinkHint: 'Oder kopieren Sie diesen Link in Ihren Browser:',
    warningTitle: '⏰ Zeitlich begrenzte Einladung',
    warningText: 'Dieser Einladungslink läuft in <strong>{{expirationTime}}</strong> ab. Bitte schließen Sie die Kontoeinrichtung vorher ab.',
    footerSent: 'Diese E-Mail wurde an {{teamMemberName}} im Rahmen der Einrichtung Ihres {{tenantName}}-Kontos gesendet.',
    footerUnexpected: 'Wenn Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',
    footerCopyright: '© {{currentYear}} {{tenantName}}. Alle Rechte vorbehalten.',
  },
  es: {
    subject: 'Estás invitado a unirte a {{tenantName}} en AlgaPSA',
    title: 'Invitación al equipo',
    headerTitle: 'Bienvenido al equipo',
    headerSubtitle: 'Estás invitado a unirte a {{tenantName}}',
    greeting: 'Hola {{teamMemberName}},',
    intro: '{{invitedByName}} te ha invitado a unirte a <strong>{{tenantName}}</strong> como <strong>{{roleName}}</strong>. Configura tu cuenta para comenzar.',
    infoBoxTitle: 'Qué sigue',
    feature1: '✓ Haz clic en el botón de abajo para establecer tu propia contraseña',
    feature2: '✓ Inicia sesión con tu correo de trabajo y la nueva contraseña',
    feature3: '✓ Comienza a gestionar tickets, clientes y proyectos de inmediato',
    buttonLabel: 'Configurar tu cuenta',
    copyLinkHint: 'O copia y pega este enlace en tu navegador:',
    warningTitle: '⏰ Invitación con tiempo limitado',
    warningText: 'Este enlace de invitación expirará en <strong>{{expirationTime}}</strong>. Completa la configuración de tu cuenta antes de esa fecha.',
    footerSent: 'Este correo fue enviado a {{teamMemberName}} como parte de la configuración de tu cuenta de {{tenantName}}.',
    footerUnexpected: 'Si no esperabas esta invitación, puedes ignorar este correo con seguridad.',
    footerCopyright: '© {{currentYear}} {{tenantName}}. Todos los derechos reservados.',
  },
  fr: {
    subject: 'Vous êtes invité à rejoindre {{tenantName}} sur AlgaPSA',
    title: 'Équipe – Invitation',
    headerTitle: "Bienvenue dans l'équipe",
    headerSubtitle: 'Étes-vous invité(e) à rejoindre {{tenantName}}',
    greeting: 'Bonjour {{teamMemberName}},',
    intro: '{{invitedByName}} vous a invité(e) à rejoindre <strong>{{tenantName}}</strong> en tant que <strong>{{roleName}}</strong>. Configurez votre compte pour commencer.',
    infoBoxTitle: 'Prochaines étapes',
    feature1: '✓ Cliquez sur le bouton ci-dessous pour définir votre propre mot de passe',
    feature2: '✓ Connectez-vous avec votre e-mail professionnel et votre nouveau mot de passe',
    feature3: '✓ Commencez à gérer les tickets, clients et projets immédiatement',
    buttonLabel: 'Configurer votre compte',
    copyLinkHint: 'Ou copiez et collez ce lien dans votre navigateur :',
    warningTitle: '⏰ Invitation à durée limitée',
    warningText: 'Ce lien d’invitation expirera dans <strong>{{expirationTime}}</strong>. Veuillez terminer la configuration de votre compte avant cette date.',
    footerSent: 'Cet e-mail a été envoyé à {{teamMemberName}} dans le cadre de la configuration de votre compte {{tenantName}}.',
    footerUnexpected: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer cet e-mail en toute sécurité.",
    footerCopyright: '© {{currentYear}} {{tenantName}}. Tous droits réservés.',
  },
  it: {
    subject: 'Sei invitato a unirti a {{tenantName}} su AlgaPSA',
    title: 'Invito al team',
    headerTitle: 'Benvenuto nel team',
    headerSubtitle: 'Sei invitato a unirti a {{tenantName}}',
    greeting: 'Ciao {{teamMemberName}},',
    intro: '{{invitedByName}} ti ha invitato a unirti a <strong>{{tenantName}}</strong> come <strong>{{roleName}}</strong>. Configura il tuo account per iniziare.',
    infoBoxTitle: 'Cosa succede dopo',
    feature1: '✓ Fai clic sul pulsante qui sotto per impostare la tua password',
    feature2: '✓ Accedi con la tua email di lavoro e la nuova password',
    feature3: '✓ Inizia subito a gestire ticket, clienti e progetti',
    buttonLabel: 'Configura il tuo account',
    copyLinkHint: 'Oppure copia e incolla questo link nel tuo browser:',
    warningTitle: '⏰ Invito a tempo limitato',
    warningText: "Questo link di invito scadrà tra <strong>{{expirationTime}}</strong>. Completa la configurazione del tuo account prima di tale scadenza.",
    footerSent: "Questa e-mail è stata inviata a {{teamMemberName}} nell'ambito della configurazione del tuo account {{tenantName}}.",
    footerUnexpected: 'Se non ti aspettavi questo invito, puoi ignorare tranquillamente questa e-mail.',
    footerCopyright: '© {{currentYear}} {{tenantName}}. Tutti i diritti riservati.',
  },
};

/* eslint-enable max-len */

/* ------------------------------------------------------------------ */
/*  Shared HTML builder                                               */
/* ------------------------------------------------------------------ */
function buildStyledHtml(c) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${c.title}</title>
  <style>${TEAM_INVITATION_CSS}
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

    <div class="info-box">
      <h3>${c.infoBoxTitle}</h3>
      <p>${c.feature1}</p>
      <p>${c.feature2}</p>
      <p>${c.feature3}</p>
    </div>

    <div style="text-align: center;">
      <a href="{{inviteLink}}" class="action-button">${c.buttonLabel}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${c.copyLinkHint}
    </p>
    <div class="link-text">{{inviteLink}}</div>

    <div class="warning">
      <h4>${c.warningTitle}</h4>
      <p>${c.warningText}</p>
    </div>

    <div class="divider"></div>
  </div>

  <div class="footer">
    <p>${c.footerSent}</p>
    <p>${c.footerUnexpected}</p>
    <p>${c.footerCopyright}</p>
  </div>
</body>
</html>`;
}

function buildText(c) {
  return `${c.headerTitle}

${c.greeting}

${c.intro.replace(/<[^>]+>/g, '')}

${c.feature1}
${c.feature2}
${c.feature3}

${c.buttonLabel}: {{inviteLink}}

${c.warningTitle}
${c.warningText.replace(/<[^>]+>/g, '')}

---
${c.footerSent}
${c.footerUnexpected}
${c.footerCopyright}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: copy.subject,
      htmlContent: buildStyledHtml(copy),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
