/**
 * Source-of-truth: portal-invitation email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * All languages use the same CSS-class-based styled layout with the brand
 * gradient header. English and Polish were originally styled in their own
 * migrations; fr/es/de/nl/it were styled via migration 20251029100000.
 */

const TEMPLATE_NAME = 'portal-invitation';
const SUBTYPE_NAME = 'portal-invitation';

/* ------------------------------------------------------------------ */
/*  Shared CSS for all portal-invitation templates                    */
/* ------------------------------------------------------------------ */
const PORTAL_INVITATION_CSS = `
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
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
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
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
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
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
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
    subject: 'Portal Invitation - {{clientName}}',
    title: 'Portal Access Invitation',
    headerTitle: 'Welcome to Your Customer Portal',
    headerSubtitle: "You're invited to access your account",
    greeting: 'Hello {{contactName}},',
    intro: "Great news! You've been invited to access the customer portal for <strong>{{clientName}}</strong>. This secure portal gives you instant access to:",
    infoBoxTitle: '\ud83c\udfaf What You Can Access',
    feature1: '\u2713 View and track your support tickets',
    feature2: '\u2713 Review project updates and documentation',
    feature3: '\u2713 Communicate directly with your support team',
    tagline: 'Experience seamless service management with our intuitive portal. Everything you need to stay informed and connected, all in one secure location.',
    buttonLabel: 'Set Up Your Portal Access',
    copyLinkHint: 'Or copy and paste this link into your browser:',
    warningTitle: '\u23f0 Time-Sensitive Invitation',
    warningText: 'This invitation link will expire in <strong>{{expirationTime}}</strong>. Please complete your account setup before then to ensure uninterrupted access.',
    contactTitle: 'Need Assistance?',
    phoneLabel: 'Phone',
    contactHelp: 'Our support team is ready to help you get started.',
    footerSent: 'This email was sent to {{contactName}} as part of your portal access setup.',
    footerUnexpected: "If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.",
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. All rights reserved.',
  },
  fr: {
    subject: 'Invitation au portail client - {{clientName}}',
    title: 'Invitation au portail',
    headerTitle: 'Bienvenue sur votre portail client',
    headerSubtitle: 'Vous \u00eates invit\u00e9 \u00e0 acc\u00e9der \u00e0 votre compte',
    greeting: 'Bonjour {{contactName}},',
    intro: "Bonne nouvelle\u00a0! Vous avez \u00e9t\u00e9 invit\u00e9 \u00e0 acc\u00e9der au portail client de <strong>{{clientName}}</strong>. Ce portail s\u00e9curis\u00e9 vous donne un acc\u00e8s instantan\u00e9 \u00e0\u00a0:",
    infoBoxTitle: '\ud83c\udfaf Ce \u00e0 quoi vous avez acc\u00e8s',
    feature1: '\u2713 Consulter et suivre vos tickets d\u2019assistance',
    feature2: '\u2713 Voir les mises \u00e0 jour de projets et la documentation',
    feature3: '\u2713 Communiquer directement avec votre \u00e9quipe support',
    tagline: "D\u00e9couvrez une gestion de services simplifi\u00e9e gr\u00e2ce \u00e0 notre portail intuitif. Tout ce dont vous avez besoin pour rester inform\u00e9 et connect\u00e9, au m\u00eame endroit.",
    buttonLabel: 'Configurer votre acc\u00e8s au portail',
    copyLinkHint: 'Ou copiez et collez ce lien dans votre navigateur\u00a0:',
    warningTitle: '\u23f0 Invitation \u00e0 dur\u00e9e limit\u00e9e',
    warningText: "Ce lien d\u2019invitation expirera dans <strong>{{expirationTime}}</strong>. Veuillez terminer la configuration de votre compte avant cette date pour garantir un acc\u00e8s ininterrompu.",
    contactTitle: "Besoin d\u2019aide\u00a0?",
    phoneLabel: 'T\u00e9l\u00e9phone',
    contactHelp: "Notre \u00e9quipe support est pr\u00eate \u00e0 vous aider \u00e0 d\u00e9marrer.",
    footerSent: 'Cet e-mail a \u00e9t\u00e9 envoy\u00e9 \u00e0 {{contactName}} dans le cadre de la configuration de votre acc\u00e8s au portail.',
    footerUnexpected: "Si vous n\u2019attendiez pas cette invitation, veuillez nous contacter \u00e0 {{clientLocationEmail}}.",
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Tous droits r\u00e9serv\u00e9s.',
  },
  es: {
    subject: 'Invitaci\u00f3n al portal del cliente - {{clientName}}',
    title: 'Invitaci\u00f3n al portal',
    headerTitle: 'Bienvenido a tu portal de cliente',
    headerSubtitle: 'Has sido invitado a acceder a tu cuenta',
    greeting: 'Hola {{contactName}},',
    intro: '\u00a1Buenas noticias! Has sido invitado a acceder al portal de cliente de <strong>{{clientName}}</strong>. Este portal seguro te da acceso instant\u00e1neo a:',
    infoBoxTitle: '\ud83c\udfaf A qu\u00e9 puedes acceder',
    feature1: '\u2713 Ver y dar seguimiento a tus tickets de soporte',
    feature2: '\u2713 Revisar actualizaciones de proyectos y documentaci\u00f3n',
    feature3: '\u2713 Comunicarte directamente con tu equipo de soporte',
    tagline: 'Disfruta de una gesti\u00f3n de servicios fluida con nuestro portal intuitivo. Todo lo que necesitas para estar informado y conectado, en un solo lugar seguro.',
    buttonLabel: 'Configurar tu acceso al portal',
    copyLinkHint: 'O copia y pega este enlace en tu navegador:',
    warningTitle: '\u23f0 Invitaci\u00f3n con tiempo limitado',
    warningText: 'Este enlace de invitaci\u00f3n expirar\u00e1 en <strong>{{expirationTime}}</strong>. Completa la configuraci\u00f3n de tu cuenta antes de esa fecha para garantizar un acceso ininterrumpido.',
    contactTitle: '\u00bfNecesitas ayuda?',
    phoneLabel: 'Tel\u00e9fono',
    contactHelp: 'Nuestro equipo de soporte est\u00e1 listo para ayudarte a comenzar.',
    footerSent: 'Este correo fue enviado a {{contactName}} como parte de la configuraci\u00f3n de tu acceso al portal.',
    footerUnexpected: 'Si no esperabas esta invitaci\u00f3n, cont\u00e1ctanos en {{clientLocationEmail}}.',
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Todos los derechos reservados.',
  },
  de: {
    subject: 'Kundenportal-Einladung - {{clientName}}',
    title: 'Portal-Einladung',
    headerTitle: 'Willkommen in Ihrem Kundenportal',
    headerSubtitle: 'Sie sind eingeladen, auf Ihr Konto zuzugreifen',
    greeting: 'Hallo {{contactName}},',
    intro: 'Gute Nachrichten! Sie wurden eingeladen, auf das Kundenportal von <strong>{{clientName}}</strong> zuzugreifen. Dieses sichere Portal bietet Ihnen sofortigen Zugang zu:',
    infoBoxTitle: '\ud83c\udfaf Worauf Sie Zugriff haben',
    feature1: '\u2713 Ihre Support-Tickets einsehen und verfolgen',
    feature2: '\u2713 Projektaktualisierungen und Dokumentation \u00fcberpr\u00fcfen',
    feature3: '\u2713 Direkt mit Ihrem Support-Team kommunizieren',
    tagline: 'Erleben Sie nahtloses Service-Management mit unserem intuitiven Portal. Alles, was Sie brauchen, um informiert und verbunden zu bleiben \u2013 an einem sicheren Ort.',
    buttonLabel: 'Portalzugang einrichten',
    copyLinkHint: 'Oder kopieren Sie diesen Link in Ihren Browser:',
    warningTitle: '\u23f0 Zeitlich begrenzte Einladung',
    warningText: 'Dieser Einladungslink l\u00e4uft in <strong>{{expirationTime}}</strong> ab. Bitte schlie\u00dfen Sie die Einrichtung Ihres Kontos vorher ab, um einen unterbrechungsfreien Zugang zu gew\u00e4hrleisten.',
    contactTitle: 'Brauchen Sie Hilfe?',
    phoneLabel: 'Telefon',
    contactHelp: 'Unser Support-Team steht bereit, um Ihnen den Einstieg zu erleichtern.',
    footerSent: 'Diese E-Mail wurde an {{contactName}} im Rahmen der Einrichtung Ihres Portal-Zugangs gesendet.',
    footerUnexpected: 'Wenn Sie diese Einladung nicht erwartet haben, kontaktieren Sie uns bitte unter {{clientLocationEmail}}.',
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.',
  },
  nl: {
    subject: 'Uitnodiging voor klantenportaal - {{clientName}}',
    title: 'Portaaluitnodiging',
    headerTitle: 'Welkom bij uw klantenportaal',
    headerSubtitle: 'U bent uitgenodigd om toegang te krijgen tot uw account',
    greeting: 'Hallo {{contactName}},',
    intro: 'Goed nieuws! U bent uitgenodigd om toegang te krijgen tot het klantenportaal van <strong>{{clientName}}</strong>. Dit beveiligde portaal geeft u direct toegang tot:',
    infoBoxTitle: '\ud83c\udfaf Waar u toegang toe hebt',
    feature1: '\u2713 Uw supporttickets bekijken en volgen',
    feature2: '\u2713 Projectupdates en documentatie bekijken',
    feature3: '\u2713 Direct communiceren met uw supportteam',
    tagline: 'Ervaar naadloos servicebeheer met ons intu\u00eftieve portaal. Alles wat u nodig hebt om ge\u00efnformeerd en verbonden te blijven, op \u00e9\u00e9n veilige plek.',
    buttonLabel: 'Uw portaaltoegang instellen',
    copyLinkHint: 'Of kopieer en plak deze link in uw browser:',
    warningTitle: '\u23f0 Tijdgebonden uitnodiging',
    warningText: 'Deze uitnodigingslink verloopt over <strong>{{expirationTime}}</strong>. Voltooi uw accountconfiguratie v\u00f3\u00f3r die tijd om ononderbroken toegang te garanderen.',
    contactTitle: 'Hulp nodig?',
    phoneLabel: 'Telefoon',
    contactHelp: 'Ons supportteam staat klaar om u op weg te helpen.',
    footerSent: 'Deze e-mail is verzonden naar {{contactName}} als onderdeel van uw portaaltoegang.',
    footerUnexpected: 'Als u deze uitnodiging niet verwachtte, neem dan contact met ons op via {{clientLocationEmail}}.',
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Alle rechten voorbehouden.',
  },
  it: {
    subject: 'Invito al portale clienti - {{clientName}}',
    title: 'Invito al portale',
    headerTitle: 'Benvenuto nel tuo portale clienti',
    headerSubtitle: 'Sei stato invitato ad accedere al tuo account',
    greeting: 'Ciao {{contactName}},',
    intro: 'Ottime notizie! Sei stato invitato ad accedere al portale clienti di <strong>{{clientName}}</strong>. Questo portale sicuro ti d\u00e0 accesso immediato a:',
    infoBoxTitle: '\ud83c\udfaf A cosa puoi accedere',
    feature1: '\u2713 Visualizzare e monitorare i tuoi ticket di assistenza',
    feature2: '\u2713 Consultare aggiornamenti sui progetti e documentazione',
    feature3: '\u2713 Comunicare direttamente con il tuo team di supporto',
    tagline: 'Sperimenta una gestione dei servizi senza interruzioni con il nostro portale intuitivo. Tutto ci\u00f2 di cui hai bisogno per restare informato e connesso, in un unico luogo sicuro.',
    buttonLabel: 'Configura il tuo accesso al portale',
    copyLinkHint: 'Oppure copia e incolla questo link nel tuo browser:',
    warningTitle: '\u23f0 Invito a tempo limitato',
    warningText: "Questo link di invito scadr\u00e0 tra <strong>{{expirationTime}}</strong>. Completa la configurazione del tuo account prima di tale scadenza per garantire un accesso ininterrotto.",
    contactTitle: 'Hai bisogno di assistenza?',
    phoneLabel: 'Telefono',
    contactHelp: 'Il nostro team di supporto \u00e8 pronto ad aiutarti a iniziare.',
    footerSent: "Questa e-mail \u00e8 stata inviata a {{contactName}} nell'ambito della configurazione dell'accesso al portale.",
    footerUnexpected: 'Se non ti aspettavi questo invito, contattaci all\'indirizzo {{clientLocationEmail}}.',
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Tutti i diritti riservati.',
  },
  pl: {
    subject: 'Zaproszenie do portalu klienta{{#if clientName}} - {{clientName}}{{/if}}',
    title: 'Zaproszenie do portalu',
    headerTitle: 'Witamy w portalu klienta',
    headerSubtitle: 'Tw\u00f3j dost\u0119p do zarz\u0105dzania us\u0142ugami jest gotowy',
    greeting: 'Witaj {{contactName}},',
    intro: 'Zosta\u0142e\u015b(a\u015b) zaproszony(a) do portalu klienta {{clientName}}. Ten bezpieczny portal daje Ci natychmiastowy dost\u0119p do:',
    infoBoxTitle: 'Tw\u00f3j dost\u0119p obejmuje:',
    feature1: '\u2713 Przegl\u0105danie i \u015bledzenie Twoich zg\u0142osze\u0144 serwisowych',
    feature2: '\u2713 Przegl\u0105d aktualizacji projekt\u00f3w i dokumentacji',
    feature3: '\u2713 Bezpo\u015brednia komunikacja z zespo\u0142em wsparcia',
    tagline: null,
    buttonLabel: 'Skonfiguruj dost\u0119p do portalu',
    copyLinkHint: 'Lub skopiuj i wklej ten link do przegl\u0105darki:',
    warningTitle: '\u23f0 Zaproszenie ograniczone czasowo',
    warningText: 'Ten link zaproszeniowy wyga\u015bnie za {{expirationTime}}. Doko\u0144cz konfiguracj\u0119 konta przed tym terminem, aby zapewni\u0107 nieprzerwany dost\u0119p.',
    contactTitle: 'Potrzebujesz pomocy?',
    phoneLabel: 'Telefon',
    contactHelp: 'Nasz zesp\u00f3\u0142 wsparcia jest gotowy, aby pom\u00f3c Ci rozpocz\u0105\u0107.',
    footerSent: 'Ta wiadomo\u015b\u0107 zosta\u0142a wys\u0142ana do {{contactName}} w ramach konfiguracji dost\u0119pu do portalu.',
    footerUnexpected: 'Je\u015bli nie spodziewale\u015b(a\u015b) si\u0119 tego zaproszenia, skontaktuj si\u0119 z nami pod adresem {{clientLocationEmail}}.',
    footerCopyright: '\u00a9 {{currentYear}} {{clientName}}. Wszelkie prawa zastrze\u017cone.',
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
  <style>${PORTAL_INVITATION_CSS}
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
${c.tagline ? `
    <div class="tagline">
      ${c.tagline}
    </div>
` : ''}
    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">${c.buttonLabel}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${c.copyLinkHint}
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>${c.warningTitle}</h4>
      <p>${c.warningText}</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>${c.contactTitle}</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>${c.phoneLabel}:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">${c.contactHelp}</p>
    </div>
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
${c.tagline ? `\n${c.tagline}\n` : ''}
${c.buttonLabel}: {{portalLink}}

${c.warningTitle}
${c.warningText.replace(/<[^>]+>/g, '')}

${c.contactTitle}
Email: {{clientLocationEmail}}
${c.phoneLabel}: {{clientLocationPhone}}
${c.contactHelp}

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
