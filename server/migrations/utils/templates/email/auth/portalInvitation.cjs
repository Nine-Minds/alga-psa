/**
 * Source-of-truth: portal-invitation email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * English has full styled CSS-class-based HTML (from migration 20251027080000);
 * fr/es/de/nl/it from seed 86 use simple inline styles;
 * Polish has its own styled version (from migration 20251228123000).
 *
 * The styled English version uses the same portalInvitationStyles CSS as the
 * migration 20251029100000 updates for fr/es/de/nl/it, but those languages
 * were later overwritten by seed 86 with simpler HTML. We preserve each
 * language's latest version.
 */

const TEMPLATE_NAME = 'portal-invitation';
const SUBTYPE_NAME = 'portal-invitation';

/* ------------------------------------------------------------------ */
/*  Shared CSS for English styled portal-invitation template          */
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
/*  English styled version (from migration 20251027080000)            */
/* ------------------------------------------------------------------ */
function buildEnglishHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Access Invitation</title>
  <style>${PORTAL_INVITATION_CSS}
  </style>
</head>
<body>
  <div class="header">
    <h1>Welcome to Your Customer Portal</h1>
    <p>You're invited to access your account</p>
  </div>

  <div class="content">
    <h2>Hello {{contactName}},</h2>

    <p>Great news! You've been invited to access the customer portal for <strong>{{clientName}}</strong>. This secure portal gives you instant access to:</p>

    <div class="info-box">
      <h3>\ud83c\udfaf What You Can Access</h3>
      <p>\u2713 View and track your support tickets</p>
      <p>\u2713 Review project updates and documentation</p>
      <p>\u2713 Communicate directly with your support team</p>
    </div>

    <div class="tagline">
      Experience seamless service management with our intuitive portal. Everything you need to stay informed and connected, all in one secure location.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Set Up Your Portal Access</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Or copy and paste this link into your browser:
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>\u23f0 Time-Sensitive Invitation</h4>
      <p>This invitation link will expire in <strong>{{expirationTime}}</strong>. Please complete your account setup before then to ensure uninterrupted access.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>Need Assistance?</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>Phone:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Our support team is ready to help you get started.</p>
    </div>
  </div>

  <div class="footer">
    <p>This email was sent to {{contactName}} as part of your portal access setup.</p>
    <p>If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.</p>
    <p>\u00a9 {{currentYear}} {{clientName}}. All rights reserved.</p>
  </div>
</body>
</html>`;
}

function buildEnglishText() {
  return `Welcome to Your Customer Portal

Hello {{contactName}},

Great news! You've been invited to access the customer portal for {{clientName}}. This secure portal gives you instant access to:

\u2713 View and track your support tickets
\u2713 Review project updates and documentation
\u2713 Communicate directly with your support team

Experience seamless service management with our intuitive portal. Everything you need to stay informed and connected, all in one secure location.

Set Up Your Portal Access: {{portalLink}}

\u23f0 Time-Sensitive Invitation
This invitation link will expire in {{expirationTime}}. Please complete your account setup before then to ensure uninterrupted access.

Need Assistance?
Email: {{clientLocationEmail}}
Phone: {{clientLocationPhone}}
Our support team is ready to help you get started.

---
This email was sent to {{contactName}} as part of your portal access setup.
If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.
\u00a9 {{currentYear}} {{clientName}}. All rights reserved.`;
}

/* ------------------------------------------------------------------ */
/*  Simple inline-style versions for fr/es/de/nl/it (from seed 86)   */
/* ------------------------------------------------------------------ */
const SIMPLE_LANGS = {
  fr: {
    subject: 'Invitation au portail client - {{clientName}}',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Bienvenue sur votre portail client</h2>
          <p>Bonjour {{contactName}},</p>
          <p>Vous \u00eates invit\u00e9 \u00e0 rejoindre le portail client de {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Activer mon acc\u00e8s</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{portalLink}}</p>
          <p><small>Le lien expirera dans {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Besoin d'assistance ?</p>
          <p style="color: #666; font-size: 12px;">Email : {{clientLocationEmail}}<br>T\u00e9l\u00e9phone : {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">\u00a9 {{currentYear}} {{clientName}}</p>
        </div>
      `,
    text: `Bienvenue sur votre portail client

Bonjour {{contactName}},

Vous \u00eates invit\u00e9 \u00e0 rejoindre le portail client de {{clientName}}.

Activer mon acc\u00e8s : {{portalLink}}

Le lien expirera dans {{expirationTime}}.

Besoin d'assistance ?
Email : {{clientLocationEmail}}
T\u00e9l\u00e9phone : {{clientLocationPhone}}

\u00a9 {{currentYear}} {{clientName}}`,
  },
  es: {
    subject: 'Invitaci\u00f3n al portal del cliente - {{clientName}}',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Bienvenido a tu portal del cliente</h2>
          <p>Hola {{contactName}},</p>
          <p>Has sido invitado a unirte al portal del cliente de {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Activar mi acceso</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{portalLink}}</p>
          <p><small>El enlace expirar\u00e1 en {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">\u00bfNecesitas asistencia?</p>
          <p style="color: #666; font-size: 12px;">Email: {{clientLocationEmail}}<br>Tel\u00e9fono: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">\u00a9 {{currentYear}} {{clientName}}</p>
        </div>
      `,
    text: `Bienvenido a tu portal del cliente

Hola {{contactName}},

Has sido invitado a unirte al portal del cliente de {{clientName}}.

Activar mi acceso: {{portalLink}}

El enlace expirar\u00e1 en {{expirationTime}}.

\u00bfNecesitas asistencia?
Email: {{clientLocationEmail}}
Tel\u00e9fono: {{clientLocationPhone}}

\u00a9 {{currentYear}} {{clientName}}`,
  },
  de: {
    subject: 'Kundenportal-Einladung - {{clientName}}',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Willkommen in Ihrem Kundenportal</h2>
          <p>Hallo {{contactName}},</p>
          <p>Sie wurden eingeladen, dem Kundenportal von {{clientName}} beizutreten.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Zugang aktivieren</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{portalLink}}</p>
          <p><small>Der Link l\u00e4uft in {{expirationTime}} ab.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Ben\u00f6tigen Sie Unterst\u00fctzung?</p>
          <p style="color: #666; font-size: 12px;">E-Mail: {{clientLocationEmail}}<br>Telefon: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">\u00a9 {{currentYear}} {{clientName}}</p>
        </div>
      `,
    text: `Willkommen in Ihrem Kundenportal

Hallo {{contactName}},

Sie wurden eingeladen, dem Kundenportal von {{clientName}} beizutreten.

Zugang aktivieren: {{portalLink}}

Der Link l\u00e4uft in {{expirationTime}} ab.

Ben\u00f6tigen Sie Unterst\u00fctzung?
E-Mail: {{clientLocationEmail}}
Telefon: {{clientLocationPhone}}

\u00a9 {{currentYear}} {{clientName}}`,
  },
  nl: {
    subject: 'Uitnodiging voor klantenportaal - {{clientName}}',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welkom bij uw klantenportaal</h2>
          <p>Hallo {{contactName}},</p>
          <p>U bent uitgenodigd om lid te worden van het klantenportaal van {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Toegang activeren</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{portalLink}}</p>
          <p><small>De link verloopt over {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Hulp nodig?</p>
          <p style="color: #666; font-size: 12px;">E-mail: {{clientLocationEmail}}<br>Telefoon: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">\u00a9 {{currentYear}} {{clientName}}</p>
        </div>
      `,
    text: `Welkom bij uw klantenportaal

Hallo {{contactName}},

U bent uitgenodigd om lid te worden van het klantenportaal van {{clientName}}.

Toegang activeren: {{portalLink}}

De link verloopt over {{expirationTime}}.

Hulp nodig?
E-mail: {{clientLocationEmail}}
Telefoon: {{clientLocationPhone}}

\u00a9 {{currentYear}} {{clientName}}`,
  },
  it: {
    subject: 'Invito al portale clienti - {{clientName}}',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Benvenuto nel portale clienti</h2>
          <p>Ciao {{contactName}},</p>
          <p>Hai ricevuto un invito per accedere al portale clienti di {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Attiva il mio accesso</a></p>
          <p>Oppure copia e incolla questo link nel tuo browser:</p>
          <p>{{portalLink}}</p>
          <p><small>Il link scadr\u00e0 tra {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Serve supporto?</p>
          <p style="color: #666; font-size: 12px;">Email: {{clientLocationEmail}}<br>Telefono: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">\u00a9 {{currentYear}} {{clientName}}</p>
        </div>
      `,
    text: `Benvenuto nel portale clienti

Ciao {{contactName}},

Hai ricevuto un invito per accedere al portale clienti di {{clientName}}.

Attiva il mio accesso: {{portalLink}}

Il link scadr\u00e0 tra {{expirationTime}}.

Serve supporto?
Email: {{clientLocationEmail}}
Telefono: {{clientLocationPhone}}

\u00a9 {{currentYear}} {{clientName}}`,
  },
};

/* ------------------------------------------------------------------ */
/*  Polish styled version (from migration 20251228123000)             */
/* ------------------------------------------------------------------ */
function buildPolishHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zaproszenie do portalu</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
    .header { background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%); color: white; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { font-family: Poppins, system-ui, sans-serif; font-weight: 700; font-size: 28px; margin: 0 0 8px 0; color: white; }
    .header p { margin: 0; opacity: 1; font-size: 16px; color: rgba(255, 255, 255, 0.95); }
    .content { background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-bottom: none; }
    .footer { background: #1e293b; color: #cbd5e1; padding: 24px; border-radius: 0 0 12px 12px; text-align: center; font-size: 14px; }
    .footer p { margin: 6px 0; color: #cbd5e1; }
    .info-box { background: #faf8ff; padding: 24px; border-radius: 8px; border: 1px solid #e9e5f5; border-left: 4px solid #8a4dea; margin: 24px 0; }
    .info-box h3 { color: #0f172a; margin: 0 0 16px 0; font-size: 18px; font-weight: 600; }
    .info-box p { margin: 8px 0; color: #475569; font-size: 15px; }
    .action-button { display: inline-block; background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .warning { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 24px 0; }
    .warning h4 { color: #b45309; margin: 0 0 8px 0; font-size: 15px; }
    .warning p { color: #92400e; margin: 0; font-size: 14px; }
    .link-text { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #475569; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Witamy w portalu klienta</h1>
    <p>Tw\u00f3j dost\u0119p do zarz\u0105dzania us\u0142ugami jest gotowy</p>
  </div>
  <div class="content">
    <h2>Witaj {{contactName}},</h2>
    <p>Zosta\u0142e\u015b(a\u015b) zaproszony(a) do portalu klienta {{clientName}}. Ten bezpieczny portal daje Ci natychmiastowy dost\u0119p do:</p>
    <div class="info-box">
      <h3>Tw\u00f3j dost\u0119p obejmuje:</h3>
      <p>\u2713 Przegl\u0105danie i \u015bledzenie Twoich zg\u0142osze\u0144 serwisowych</p>
      <p>\u2713 Przegl\u0105d aktualizacji projekt\u00f3w i dokumentacji</p>
      <p>\u2713 Bezpo\u015brednia komunikacja z zespo\u0142em wsparcia</p>
    </div>
    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Skonfiguruj dost\u0119p do portalu</a>
    </div>
    <p style="text-align: center; color: #64748b; font-size: 14px;">Lub skopiuj i wklej ten link do przegl\u0105darki:</p>
    <div class="link-text">{{portalLink}}</div>
    <div class="warning">
      <h4>\u23f0 Zaproszenie ograniczone czasowo</h4>
      <p>Ten link zaproszeniowy wyga\u015bnie za {{expirationTime}}. Doko\u0144cz konfiguracj\u0119 konta przed tym terminem, aby zapewni\u0107 nieprzerwany dost\u0119p.</p>
    </div>
    <div class="contact-info">
      <h4>Potrzebujesz pomocy?</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>Telefon:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Nasz zesp\u00f3\u0142 wsparcia jest gotowy, aby pom\u00f3c Ci rozpocz\u0105\u0107.</p>
    </div>
  </div>
  <div class="footer">
    <p>Ta wiadomo\u015b\u0107 zosta\u0142a wys\u0142ana do {{contactName}} w ramach konfiguracji dost\u0119pu do portalu.</p>
    <p>Je\u015bli nie spodziewale\u015b(a\u015b) si\u0119 tego zaproszenia, skontaktuj si\u0119 z nami pod adresem {{clientLocationEmail}}.</p>
    <p>\u00a9 {{currentYear}} {{clientName}}. Wszelkie prawa zastrze\u017cone.</p>
  </div>
</body>
</html>`;
}

function buildPolishText() {
  return `Witamy w portalu klienta

Witaj {{contactName}},

Zosta\u0142e\u015b(a\u015b) zaproszony(a) do portalu klienta {{clientName}}. Ten bezpieczny portal daje Ci natychmiastowy dost\u0119p do:

\u2713 Przegl\u0105danie i \u015bledzenie Twoich zg\u0142osze\u0144 serwisowych
\u2713 Przegl\u0105d aktualizacji projekt\u00f3w i dokumentacji
\u2713 Bezpo\u015brednia komunikacja z zespo\u0142em wsparcia

Skonfiguruj dost\u0119p do portalu: {{portalLink}}

\u23f0 Zaproszenie ograniczone czasowo
Ten link zaproszeniowy wyga\u015bnie za {{expirationTime}}. Doko\u0144cz konfiguracj\u0119 konta przed tym terminem, aby zapewni\u0107 nieprzerwany dost\u0119p.

Potrzebujesz pomocy?
Email: {{clientLocationEmail}}
Telefon: {{clientLocationPhone}}
Nasz zesp\u00f3\u0142 wsparcia jest gotowy, aby pom\u00f3c Ci rozpocz\u0105\u0107.

---
Ta wiadomo\u015b\u0107 zosta\u0142a wys\u0142ana do {{contactName}} w ramach konfiguracji dost\u0119pu do portalu.
Je\u015bli nie spodziewale\u015b(a\u015b) si\u0119 tego zaproszenia, skontaktuj si\u0119 z nami pod adresem {{clientLocationEmail}}.
\u00a9 {{currentYear}} {{clientName}}. Wszelkie prawa zastrze\u017cone.`;
}
/* eslint-enable max-len */

function getTemplate() {
  const translations = [];

  // English styled version
  translations.push({
    language: 'en',
    subject: 'Portal Invitation - {{clientName}}',
    htmlContent: buildEnglishHtml(),
    textContent: buildEnglishText(),
  });

  // Simple inline-style versions for fr/es/de/nl/it
  for (const [lang, data] of Object.entries(SIMPLE_LANGS)) {
    translations.push({
      language: lang,
      subject: data.subject,
      htmlContent: data.html,
      textContent: data.text,
    });
  }

  // Polish styled version
  translations.push({
    language: 'pl',
    subject: 'Zaproszenie do portalu klienta{{#if clientName}} - {{clientName}}{{/if}}',
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
