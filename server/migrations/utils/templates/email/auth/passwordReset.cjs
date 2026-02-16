/**
 * Source-of-truth: password-reset email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * The password-reset template uses CSS class-based styling with <style> blocks
 * in ALL languages, sharing a common CSS structure with per-language copy.
 */

const TEMPLATE_NAME = 'password-reset';
const SUBTYPE_NAME = 'password-reset';

/* ------------------------------------------------------------------ */
/*  Shared CSS for the password-reset styled template                 */
/* ------------------------------------------------------------------ */
const PASSWORD_RESET_CSS = `
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
      background: linear-gradient(135deg,#8A4DEA,#40CFF9);
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
    .security-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .security-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .security-box p {
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
    .warning ul {
      margin: 0;
      padding-left: 20px;
      color: #92400e;
    }
    .warning li {
      margin: 4px 0;
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
    .code {
      font-family: 'Courier New', monospace;
      background: #e2e8f0;
      padding: 4px 8px;
      border-radius: 4px;
      color: #0f172a;
      font-size: 14px;
      font-weight: 600;
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
    }
    .help-section {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .help-section h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .help-section p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }`;

/* eslint-disable max-len */
const COPY = {
  en: {
    subject: 'Password Reset Request',
    headerTitle: 'Password Reset Request',
    headerSubtitle: 'Secure password recovery for your account',
    greeting: 'Hello {{userName}},',
    intro: 'We received a request to reset the password for your account associated with <strong>{{email}}</strong>.',
    securityTitle: '🔐 Account Security Check',
    securityRequested: '<strong>Requested at:</strong> Just now',
    securityEmail: '<strong>Account email:</strong> {{email}}',
    securityValid: '<strong>Valid for:</strong> {{expirationTime}}',
    resetPrompt: 'To create a new password for your account, click the button below:',
    buttonText: 'Reset Your Password',
    linkInstructions: 'Or copy and paste this link into your browser:',
    warningTitle: '⚠️ Important Security Information',
    warning1: 'This password reset link will expire in <strong>{{expirationTime}}</strong>',
    warning2: 'For security reasons, this link can only be used <strong>once</strong>',
    warning3: 'If you didn\'t request this reset, please ignore this email',
    warning4: 'Your password won\'t change until you create a new one',
    nextTitle: 'What\'s Next?',
    next1: 'Click the reset button above or use the provided link',
    next2: 'Create a strong, unique password for your account',
    next3: 'You\'ll be automatically logged in after resetting',
    next4: 'All existing sessions will be terminated for security',
    next5: 'Consider enabling two-factor authentication for added protection',
    helpTitle: 'Need Help?',
    helpText: 'If you\'re having trouble resetting your password, our support team is here to help.',
    helpContact: '<strong>Contact Support:</strong> {{supportEmail}}',
    footer1: 'This is an automated security email sent to {{email}}.',
    footer2: 'For your security, we never include passwords in emails.',
    footer3: '© {{currentYear}} {{clientName}}. All rights reserved.',
    textSubject: 'Password Reset Request',
    textSecurityHeader: 'ACCOUNT SECURITY CHECK',
    textSecurityRequested: '- Account email: {{email}}',
    textSecurityValid: '- Valid for: {{expirationTime}}',
    textResetPrompt: 'RESET YOUR PASSWORD:\nClick the link below to create a new password for your account:\n{{resetLink}}',
    textWarningHeader: 'IMPORTANT SECURITY INFORMATION:',
    textWarning1: '- This password reset link will expire in {{expirationTime}}',
    textWarning2: '- For security reasons, this link can only be used once',
    textWarning3: '- If you didn\'t request this reset, please ignore this email',
    textWarning4: '- Your password won\'t change until you create a new one',
    textNextHeader: 'AFTER RESETTING YOUR PASSWORD:',
    textNext1: '1. Click the reset button above or use the provided link',
    textNext2: '2. Create a strong, unique password for your account',
    textNext3: '3. You\'ll be automatically logged in after resetting',
    textNext4: '4. All existing sessions will be terminated for security',
    textNext5: '5. Consider enabling two-factor authentication for added protection',
    textHelp: 'Need Help?\nContact Support: {{supportEmail}}',
    textFooter: 'This is an automated security email sent to {{email}}.\nFor your security, we never include passwords in emails.\n© {{currentYear}} {{clientName}}. All rights reserved.',
  },
  fr: {
    subject: 'Demande de R\u00e9initialisation du Mot de Passe',
    headerTitle: 'Demande de R\u00e9initialisation du Mot de Passe',
    headerSubtitle: 'R\u00e9cup\u00e9ration s\u00e9curis\u00e9e du mot de passe de votre compte',
    greeting: 'Bonjour {{userName}},',
    intro: 'Nous avons re\u00e7u une demande de r\u00e9initialisation du mot de passe pour votre compte associ\u00e9 \u00e0 <strong>{{email}}</strong>.',
    securityTitle: '🔐 V\u00e9rification de S\u00e9curit\u00e9 du Compte',
    securityRequested: '<strong>Demand\u00e9 :</strong> \u00c0 l\'instant',
    securityEmail: '<strong>E-mail du compte :</strong> {{email}}',
    securityValid: '<strong>Valable pendant :</strong> {{expirationTime}}',
    resetPrompt: 'Pour cr\u00e9er un nouveau mot de passe pour votre compte, cliquez sur le bouton ci-dessous :',
    buttonText: 'R\u00e9initialiser Votre Mot de Passe',
    linkInstructions: 'Ou copiez et collez ce lien dans votre navigateur :',
    warningTitle: '⚠️ Informations de S\u00e9curit\u00e9 Importantes',
    warning1: 'Ce lien de r\u00e9initialisation expirera dans <strong>{{expirationTime}}</strong>',
    warning2: 'Pour des raisons de s\u00e9curit\u00e9, ce lien ne peut \u00eatre utilis\u00e9 qu\'<strong>une seule fois</strong>',
    warning3: 'Si vous n\'avez pas demand\u00e9 cette r\u00e9initialisation, ignorez cet e-mail',
    warning4: 'Votre mot de passe ne changera pas tant que vous n\'en cr\u00e9erez pas un nouveau',
    nextTitle: 'Et Ensuite ?',
    next1: 'Cliquez sur le bouton de r\u00e9initialisation ci-dessus ou utilisez le lien fourni',
    next2: 'Cr\u00e9ez un mot de passe fort et unique pour votre compte',
    next3: 'Vous serez automatiquement connect\u00e9 apr\u00e8s la r\u00e9initialisation',
    next4: 'Toutes les sessions existantes seront ferm\u00e9es pour des raisons de s\u00e9curit\u00e9',
    next5: 'Envisagez d\'activer l\'authentification \u00e0 deux facteurs pour une protection accrue',
    helpTitle: 'Besoin d\'Aide ?',
    helpText: 'Si vous rencontrez des difficult\u00e9s pour r\u00e9initialiser votre mot de passe, notre \u00e9quipe d\'assistance est l\u00e0 pour vous aider.',
    helpContact: '<strong>Contacter l\'Assistance :</strong> {{supportEmail}}',
    footer1: 'Ceci est un e-mail de s\u00e9curit\u00e9 automatis\u00e9 envoy\u00e9 \u00e0 {{email}}.',
    footer2: 'Pour votre s\u00e9curit\u00e9, nous n\'incluons jamais de mots de passe dans les e-mails.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Tous droits r\u00e9serv\u00e9s.',
    textSubject: 'Demande de R\u00e9initialisation du Mot de Passe',
    textSecurityHeader: 'V\u00c9RIFICATION DE S\u00c9CURIT\u00c9 DU COMPTE',
    textSecurityRequested: '- Demand\u00e9 : \u00c0 l\'instant\n- E-mail du compte : {{email}}',
    textSecurityValid: '- Valable pendant : {{expirationTime}}',
    textResetPrompt: 'Pour cr\u00e9er un nouveau mot de passe, visitez le lien suivant :\n{{resetLink}}',
    textWarningHeader: 'INFORMATIONS DE S\u00c9CURIT\u00c9 IMPORTANTES :',
    textWarning1: '- Ce lien expirera dans {{expirationTime}}',
    textWarning2: '- Ne peut \u00eatre utilis\u00e9 qu\'une seule fois',
    textWarning3: '- Si vous n\'avez pas demand\u00e9 cela, ignorez cet e-mail',
    textWarning4: '- Votre mot de passe ne changera pas tant que vous n\'en cr\u00e9erez pas un nouveau',
    textNextHeader: 'ET ENSUITE :',
    textNext1: '1. Utilisez le lien fourni ci-dessus',
    textNext2: '2. Cr\u00e9ez un mot de passe fort et unique',
    textNext3: '3. Vous serez automatiquement connect\u00e9',
    textNext4: '4. Toutes les sessions existantes seront ferm\u00e9es',
    textNext5: '5. Envisagez d\'activer l\'authentification \u00e0 deux facteurs',
    textHelp: 'Besoin d\'aide ?\nContacter l\'Assistance : {{supportEmail}}',
    textFooter: 'Ceci est un e-mail de s\u00e9curit\u00e9 automatis\u00e9 envoy\u00e9 \u00e0 {{email}}.\n\u00a9 {{currentYear}} {{clientName}}. Tous droits r\u00e9serv\u00e9s.',
  },
  es: {
    subject: 'Solicitud de Restablecimiento de Contrase\u00f1a',
    headerTitle: 'Solicitud de Restablecimiento de Contrase\u00f1a',
    headerSubtitle: 'Recuperaci\u00f3n segura de contrase\u00f1a para tu cuenta',
    greeting: 'Hola {{userName}},',
    intro: 'Recibimos una solicitud para restablecer la contrase\u00f1a de tu cuenta asociada con <strong>{{email}}</strong>.',
    securityTitle: '🔐 Verificaci\u00f3n de Seguridad de la Cuenta',
    securityRequested: '<strong>Solicitado:</strong> Hace un momento',
    securityEmail: '<strong>Correo de la cuenta:</strong> {{email}}',
    securityValid: '<strong>V\u00e1lido por:</strong> {{expirationTime}}',
    resetPrompt: 'Para crear una nueva contrase\u00f1a para tu cuenta, haz clic en el bot\u00f3n a continuaci\u00f3n:',
    buttonText: 'Restablecer Tu Contrase\u00f1a',
    linkInstructions: 'O copia y pega este enlace en tu navegador:',
    warningTitle: '⚠️ Informaci\u00f3n de Seguridad Importante',
    warning1: 'Este enlace de restablecimiento expirar\u00e1 en <strong>{{expirationTime}}</strong>',
    warning2: 'Por razones de seguridad, este enlace solo se puede usar <strong>una vez</strong>',
    warning3: 'Si no solicitaste este restablecimiento, ignora este correo',
    warning4: 'Tu contrase\u00f1a no cambiar\u00e1 hasta que crees una nueva',
    nextTitle: '\u00bfQu\u00e9 Sigue?',
    next1: 'Haz clic en el bot\u00f3n de restablecimiento arriba o usa el enlace proporcionado',
    next2: 'Crea una contrase\u00f1a fuerte y \u00fanica para tu cuenta',
    next3: 'Iniciar\u00e1s sesi\u00f3n autom\u00e1ticamente despu\u00e9s de restablecer',
    next4: 'Todas las sesiones existentes se terminar\u00e1n por seguridad',
    next5: 'Considera habilitar la autenticaci\u00f3n de dos factores para mayor protecci\u00f3n',
    helpTitle: '\u00bfNecesitas Ayuda?',
    helpText: 'Si tienes problemas para restablecer tu contrase\u00f1a, nuestro equipo de soporte est\u00e1 aqu\u00ed para ayudarte.',
    helpContact: '<strong>Contactar Soporte:</strong> {{supportEmail}}',
    footer1: 'Este es un correo de seguridad autom\u00e1tico enviado a {{email}}.',
    footer2: 'Por tu seguridad, nunca incluimos contrase\u00f1as en los correos.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Todos los derechos reservados.',
    textSubject: 'Solicitud de Restablecimiento de Contrase\u00f1a',
    textSecurityHeader: 'VERIFICACI\u00d3N DE SEGURIDAD DE LA CUENTA',
    textSecurityRequested: '- Solicitado: Hace un momento\n- Correo de la cuenta: {{email}}',
    textSecurityValid: '- V\u00e1lido por: {{expirationTime}}',
    textResetPrompt: 'Para crear una nueva contrase\u00f1a, visita el siguiente enlace:\n{{resetLink}}',
    textWarningHeader: 'INFORMACI\u00d3N DE SEGURIDAD IMPORTANTE:',
    textWarning1: '- Este enlace expirar\u00e1 en {{expirationTime}}',
    textWarning2: '- Solo se puede usar una vez',
    textWarning3: '- Si no solicitaste esto, ignora este correo',
    textWarning4: '- Tu contrase\u00f1a no cambiar\u00e1 hasta que crees una nueva',
    textNextHeader: 'QU\u00c9 SIGUE:',
    textNext1: '1. Usa el enlace proporcionado arriba',
    textNext2: '2. Crea una contrase\u00f1a fuerte y \u00fanica',
    textNext3: '3. Iniciar\u00e1s sesi\u00f3n autom\u00e1ticamente',
    textNext4: '4. Todas las sesiones existentes se terminar\u00e1n',
    textNext5: '5. Considera habilitar autenticaci\u00f3n de dos factores',
    textHelp: '\u00bfNecesitas ayuda?\nContactar Soporte: {{supportEmail}}',
    textFooter: 'Este es un correo de seguridad autom\u00e1tico enviado a {{email}}.\n\u00a9 {{currentYear}} {{clientName}}. Todos los derechos reservados.',
  },
  de: {
    subject: 'Passwort-Zur\u00fccksetzungsanfrage',
    headerTitle: 'Passwort-Zur\u00fccksetzungsanfrage',
    headerSubtitle: 'Sichere Passwortwiederherstellung f\u00fcr Ihr Konto',
    greeting: 'Hallo {{userName}},',
    intro: 'Wir haben eine Anfrage erhalten, das Passwort f\u00fcr Ihr Konto zur\u00fcckzusetzen, das mit <strong>{{email}}</strong> verkn\u00fcpft ist.',
    securityTitle: '🔐 Kontosicherheits\u00fcberpr\u00fcfung',
    securityRequested: '<strong>Angefordert:</strong> Vor einem Moment',
    securityEmail: '<strong>Konto-E-Mail:</strong> {{email}}',
    securityValid: '<strong>G\u00fcltig f\u00fcr:</strong> {{expirationTime}}',
    resetPrompt: 'Um ein neues Passwort f\u00fcr Ihr Konto zu erstellen, klicken Sie auf die Schaltfl\u00e4che unten:',
    buttonText: 'Ihr Passwort Zur\u00fccksetzen',
    linkInstructions: 'Oder kopieren Sie diesen Link in Ihren Browser:',
    warningTitle: '⚠️ Wichtige Sicherheitsinformationen',
    warning1: 'Dieser Zur\u00fccksetzungslink l\u00e4uft in <strong>{{expirationTime}}</strong> ab',
    warning2: 'Aus Sicherheitsgr\u00fcnden kann dieser Link nur <strong>einmal</strong> verwendet werden',
    warning3: 'Wenn Sie diese Zur\u00fccksetzung nicht angefordert haben, ignorieren Sie diese E-Mail',
    warning4: 'Ihr Passwort wird nicht ge\u00e4ndert, bis Sie ein neues erstellen',
    nextTitle: 'Was kommt als N\u00e4chstes?',
    next1: 'Klicken Sie auf die Zur\u00fccksetzungsschaltfl\u00e4che oben oder verwenden Sie den bereitgestellten Link',
    next2: 'Erstellen Sie ein starkes, einzigartiges Passwort f\u00fcr Ihr Konto',
    next3: 'Sie werden nach dem Zur\u00fccksetzen automatisch angemeldet',
    next4: 'Alle bestehenden Sitzungen werden aus Sicherheitsgr\u00fcnden beendet',
    next5: 'Erw\u00e4gen Sie die Aktivierung der Zwei-Faktor-Authentifizierung f\u00fcr zus\u00e4tzlichen Schutz',
    helpTitle: 'Ben\u00f6tigen Sie Hilfe?',
    helpText: 'Wenn Sie Probleme beim Zur\u00fccksetzen Ihres Passworts haben, steht Ihnen unser Support-Team zur Verf\u00fcgung.',
    helpContact: '<strong>Support kontaktieren:</strong> {{supportEmail}}',
    footer1: 'Dies ist eine automatische Sicherheits-E-Mail, die an {{email}} gesendet wurde.',
    footer2: 'Zu Ihrer Sicherheit f\u00fcgen wir niemals Passw\u00f6rter in E-Mails ein.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.',
    textSubject: 'Passwort-Zur\u00fccksetzungsanfrage',
    textSecurityHeader: 'KONTOSICHERHEITS\u00dcBERPR\u00dcFUNG',
    textSecurityRequested: '- Angefordert: Vor einem Moment\n- Konto-E-Mail: {{email}}',
    textSecurityValid: '- G\u00fcltig f\u00fcr: {{expirationTime}}',
    textResetPrompt: 'Um ein neues Passwort zu erstellen, besuchen Sie den folgenden Link:\n{{resetLink}}',
    textWarningHeader: 'WICHTIGE SICHERHEITSINFORMATIONEN:',
    textWarning1: '- Dieser Link l\u00e4uft in {{expirationTime}} ab',
    textWarning2: '- Kann nur einmal verwendet werden',
    textWarning3: '- Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail',
    textWarning4: '- Ihr Passwort wird nicht ge\u00e4ndert, bis Sie ein neues erstellen',
    textNextHeader: 'WAS KOMMT ALS N\u00c4CHSTES:',
    textNext1: '1. Verwenden Sie den oben bereitgestellten Link',
    textNext2: '2. Erstellen Sie ein starkes, einzigartiges Passwort',
    textNext3: '3. Sie werden automatisch angemeldet',
    textNext4: '4. Alle bestehenden Sitzungen werden beendet',
    textNext5: '5. Erw\u00e4gen Sie die Aktivierung der Zwei-Faktor-Authentifizierung',
    textHelp: 'Ben\u00f6tigen Sie Hilfe?\nSupport kontaktieren: {{supportEmail}}',
    textFooter: 'Dies ist eine automatische Sicherheits-E-Mail, die an {{email}} gesendet wurde.\n\u00a9 {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.',
  },
  nl: {
    subject: 'Verzoek tot Wachtwoordherstel',
    headerTitle: 'Verzoek tot Wachtwoordherstel',
    headerSubtitle: 'Veilige wachtwoordherstel voor uw account',
    greeting: 'Hallo {{userName}},',
    intro: 'We hebben een verzoek ontvangen om het wachtwoord voor uw account gekoppeld aan <strong>{{email}}</strong> opnieuw in te stellen.',
    securityTitle: '🔐 Beveiligingscontrole Account',
    securityRequested: '<strong>Aangevraagd:</strong> Zojuist',
    securityEmail: '<strong>Account e-mail:</strong> {{email}}',
    securityValid: '<strong>Geldig voor:</strong> {{expirationTime}}',
    resetPrompt: 'Om een nieuw wachtwoord voor uw account aan te maken, klikt u op de knop hieronder:',
    buttonText: 'Wachtwoord Opnieuw Instellen',
    linkInstructions: 'Of kopieer deze link naar uw browser:',
    warningTitle: '⚠️ Belangrijke Beveiligingsinformatie',
    warning1: 'Deze wachtwoordherstellink verloopt over <strong>{{expirationTime}}</strong>',
    warning2: 'Om beveiligingsredenen kan deze link slechts <strong>\u00e9\u00e9n keer</strong> worden gebruikt',
    warning3: 'Als u dit herstel niet heeft aangevraagd, kunt u deze e-mail negeren',
    warning4: 'Uw wachtwoord verandert pas als u een nieuw wachtwoord aanmaakt',
    nextTitle: 'Wat Nu?',
    next1: 'Klik op de herstelknop hierboven of gebruik de verstrekte link',
    next2: 'Maak een sterk, uniek wachtwoord voor uw account',
    next3: 'U wordt automatisch ingelogd na het opnieuw instellen',
    next4: 'Alle bestaande sessies worden be\u00ebindigd voor de beveiliging',
    next5: 'Overweeg tweefactorauthenticatie in te schakelen voor extra bescherming',
    helpTitle: 'Hulp Nodig?',
    helpText: 'Als u problemen ondervindt bij het opnieuw instellen van uw wachtwoord, staat ons ondersteuningsteam voor u klaar.',
    helpContact: '<strong>Contact Ondersteuning:</strong> {{supportEmail}}',
    footer1: 'Dit is een geautomatiseerde beveiligingse-mail verzonden naar {{email}}.',
    footer2: 'Voor uw veiligheid vermelden we nooit wachtwoorden in e-mails.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Alle rechten voorbehouden.',
    textSubject: 'Verzoek tot Wachtwoordherstel',
    textSecurityHeader: 'BEVEILIGINGSCONTROLE ACCOUNT',
    textSecurityRequested: '- Aangevraagd: Zojuist\n- Account e-mail: {{email}}',
    textSecurityValid: '- Geldig voor: {{expirationTime}}',
    textResetPrompt: 'Om een nieuw wachtwoord aan te maken, bezoekt u de volgende link:\n{{resetLink}}',
    textWarningHeader: 'BELANGRIJKE BEVEILIGINGSINFORMATIE:',
    textWarning1: '- Deze link verloopt over {{expirationTime}}',
    textWarning2: '- Kan slechts \u00e9\u00e9n keer worden gebruikt',
    textWarning3: '- Als u dit niet heeft aangevraagd, negeer deze e-mail',
    textWarning4: '- Uw wachtwoord verandert pas als u een nieuw wachtwoord aanmaakt',
    textNextHeader: 'WAT NU:',
    textNext1: '1. Gebruik de verstrekte link hierboven',
    textNext2: '2. Maak een sterk, uniek wachtwoord',
    textNext3: '3. U wordt automatisch ingelogd',
    textNext4: '4. Alle bestaande sessies worden be\u00ebindigd',
    textNext5: '5. Overweeg tweefactorauthenticatie in te schakelen',
    textHelp: 'Hulp nodig?\nContact Ondersteuning: {{supportEmail}}',
    textFooter: 'Dit is een geautomatiseerde beveiligingse-mail verzonden naar {{email}}.\n\u00a9 {{currentYear}} {{clientName}}. Alle rechten voorbehouden.',
  },
  it: {
    subject: 'Richiesta di reimpostazione della password',
    headerTitle: 'Richiesta di reimpostazione della password',
    headerSubtitle: 'Ripristino sicuro della password del tuo account',
    greeting: 'Ciao {{userName}},',
    intro: 'Abbiamo ricevuto una richiesta di reimpostazione della password per l\'account associato a <strong>{{email}}</strong>.',
    securityTitle: '🔐 Verifica di sicurezza dell\'account',
    securityRequested: '<strong>Richiesta:</strong> Poco fa',
    securityEmail: '<strong>Email dell\'account:</strong> {{email}}',
    securityValid: '<strong>Valido per:</strong> {{expirationTime}}',
    resetPrompt: 'Per creare una nuova password per il tuo account, fai clic sul pulsante qui sotto:',
    buttonText: 'Reimposta password',
    linkInstructions: 'Oppure copia e incolla questo link nel tuo browser:',
    warningTitle: '⚠️ Informazioni di sicurezza importanti',
    warning1: 'Questo link di reimpostazione scadr\u00e0 tra <strong>{{expirationTime}}</strong>',
    warning2: 'Per motivi di sicurezza questo link pu\u00f2 essere utilizzato <strong>una sola volta</strong>',
    warning3: 'Se non hai richiesto questo ripristino, ignora questa email',
    warning4: 'La tua password non verr\u00e0 modificata finch\u00e9 non ne imposterai una nuova',
    nextTitle: 'Cosa succede adesso?',
    next1: 'Fai clic sul pulsante di reimpostazione oppure usa il link fornito',
    next2: 'Crea una password sicura e unica per il tuo account',
    next3: 'Verrai autenticato automaticamente dopo il ripristino',
    next4: 'Tutte le sessioni esistenti verranno chiuse per sicurezza',
    next5: 'Valuta l\'attivazione dell\'autenticazione a due fattori per maggiore protezione',
    helpTitle: 'Hai bisogno di aiuto?',
    helpText: 'Se riscontri problemi nel reimpostare la password, il nostro team di supporto \u00e8 a tua disposizione.',
    helpContact: '<strong>Contatta il supporto:</strong> {{supportEmail}}',
    footer1: 'Questa \u00e8 un\'email di sicurezza automatica inviata a {{email}}.',
    footer2: 'Per la tua sicurezza non includiamo mai password nelle email.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Tutti i diritti riservati.',
    textSubject: 'Richiesta di reimpostazione della password',
    textSecurityHeader: 'VERIFICA DI SICUREZZA DELL\'ACCOUNT',
    textSecurityRequested: '- Richiesta: Poco fa\n- Email dell\'account: {{email}}',
    textSecurityValid: '- Valido per: {{expirationTime}}',
    textResetPrompt: 'Per creare una nuova password, visita il seguente link:\n{{resetLink}}',
    textWarningHeader: 'INFORMAZIONI IMPORTANTI:',
    textWarning1: '- Questo link scadr\u00e0 tra {{expirationTime}}',
    textWarning2: '- Pu\u00f2 essere utilizzato una sola volta',
    textWarning3: '- Se non hai richiesto questa operazione, ignora questa email',
    textWarning4: '- La tua password non verr\u00e0 modificata finch\u00e9 non ne imposterai una nuova',
    textNextHeader: 'Cosa succede adesso?',
    textNext1: '1. Usa il link fornito qui sopra',
    textNext2: '2. Crea una password sicura e unica',
    textNext3: '3. Verrai autenticato automaticamente',
    textNext4: '4. Tutte le sessioni esistenti verranno chiuse',
    textNext5: '5. Valuta l\'autenticazione a due fattori',
    textHelp: 'Hai bisogno di aiuto?\nContatta il supporto: {{supportEmail}}',
    textFooter: 'Questa \u00e8 un\'email di sicurezza automatica inviata a {{email}}.\n\u00a9 {{currentYear}} {{clientName}}. Tutti i diritti riservati.',
  },
  pl: {
    subject: 'Pro\u015bba o zresetowanie has\u0142a',
    headerTitle: 'Pro\u015bba o zresetowanie has\u0142a',
    headerSubtitle: 'Bezpieczne odzyskiwanie has\u0142a do Twojego konta',
    greeting: 'Cze\u015b\u0107 {{userName}},',
    intro: 'Otrzymali\u015bmy pro\u015bb\u0119 o zresetowanie has\u0142a dla konta powi\u0105zanego z <strong>{{email}}</strong>.',
    securityTitle: '🔐 Weryfikacja bezpiecze\u0144stwa konta',
    securityRequested: '<strong>Zg\u0142oszone:</strong> Przed chwil\u0105',
    securityEmail: '<strong>E-mail konta:</strong> {{email}}',
    securityValid: '<strong>Wa\u017cne przez:</strong> {{expirationTime}}',
    resetPrompt: 'Aby ustawi\u0107 nowe has\u0142o, kliknij przycisk poni\u017cej:',
    buttonText: 'Zresetuj has\u0142o',
    linkInstructions: 'Lub skopiuj i wklej ten link w przegl\u0105darce:',
    warningTitle: '⚠️ Wa\u017cne informacje dotycz\u0105ce bezpiecze\u0144stwa',
    warning1: 'Ten link resetuj\u0105cy wyga\u015bnie za <strong>{{expirationTime}}</strong>',
    warning2: 'Ze wzgl\u0119d\u00f3w bezpiecze\u0144stwa link mo\u017ce zosta\u0107 u\u017cyty tylko <strong>raz</strong>',
    warning3: 'Je\u015bli nie prosi\u0142e\u015b(a\u015b) o reset, zignoruj t\u0119 wiadomo\u015b\u0107',
    warning4: 'Twoje has\u0142o nie zmieni si\u0119, dop\u00f3ki nie ustawisz nowego',
    nextTitle: 'Co dalej?',
    next1: 'Kliknij przycisk resetowania powy\u017cej lub u\u017cyj podanego linku',
    next2: 'Utw\u00f3rz silne i unikalne has\u0142o do swojego konta',
    next3: 'Po resecie zostaniesz automatycznie zalogowany(a)',
    next4: 'Wszystkie bie\u017c\u0105ce sesje zostan\u0105 wylogowane ze wzgl\u0119d\u00f3w bezpiecze\u0144stwa',
    next5: 'Rozwa\u017c w\u0142\u0105czenie uwierzytelniania dwusk\u0142adnikowego dla wi\u0119kszej ochrony',
    helpTitle: 'Potrzebujesz pomocy?',
    helpText: 'Je\u015bli masz trudno\u015bci z resetowaniem has\u0142a, nasz zesp\u00f3\u0142 wsparcia jest do Twojej dyspozycji.',
    helpContact: '<strong>Skontaktuj si\u0119 ze wsparciem:</strong> {{supportEmail}}',
    footer1: 'To automatyczna wiadomo\u015b\u0107 bezpiecze\u0144stwa wys\u0142ana na {{email}}.',
    footer2: 'Dla Twojego bezpiecze\u0144stwa nigdy nie wysy\u0142amy hase\u0142 e-mailem.',
    footer3: '\u00a9 {{currentYear}} {{clientName}}. Wszelkie prawa zastrze\u017cone.',
    textSubject: 'Pro\u015bba o zresetowanie has\u0142a',
    textSecurityHeader: 'WERYFIKACJA BEZPIECZE\u0143STWA KONTA',
    textSecurityRequested: '- Zg\u0142oszone: Przed chwil\u0105\n- E-mail konta: {{email}}',
    textSecurityValid: '- Wa\u017cne przez: {{expirationTime}}',
    textResetPrompt: 'Aby utworzy\u0107 nowe has\u0142o, otw\u00f3rz poni\u017cszy link:\n{{resetLink}}',
    textWarningHeader: 'WA\u017bNE INFORMACJE DOTYCZ\u0104CE BEZPIECZE\u0143STWA:',
    textWarning1: '- Link wyga\u015bnie za {{expirationTime}}',
    textWarning2: '- Mo\u017ce zosta\u0107 u\u017cyty tylko raz',
    textWarning3: '- Je\u015bli nie prosi\u0142e\u015b(a\u015b) o reset, zignoruj t\u0119 wiadomo\u015b\u0107',
    textWarning4: '- Twoje has\u0142o nie zmieni si\u0119, dop\u00f3ki nie ustawisz nowego',
    textNextHeader: 'CO DALEJ:',
    textNext1: '1. U\u017cyj powy\u017cszego linku',
    textNext2: '2. Utw\u00f3rz silne i unikalne has\u0142o',
    textNext3: '3. Zostaniesz automatycznie zalogowany(a)',
    textNext4: '4. Wszystkie istniej\u0105ce sesje zostan\u0105 wylogowane',
    textNext5: '5. Rozwa\u017c w\u0142\u0105czenie uwierzytelniania dwusk\u0142adnikowego',
    textHelp: 'Potrzebujesz pomocy?\nSkontaktuj si\u0119 ze wsparciem: {{supportEmail}}',
    textFooter: 'To automatyczna wiadomo\u015b\u0107 bezpiecze\u0144stwa wys\u0142ana na {{email}}.\n\u00a9 {{currentYear}} {{clientName}}. Wszelkie prawa zastrze\u017cone.',
  },
};
/* eslint-enable max-len */

function buildHtml(c) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${c.headerTitle}</title>
  <style>${PASSWORD_RESET_CSS}
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

    <div class="security-box">
      <h3>${c.securityTitle}</h3>
      <p>${c.securityRequested}</p>
      <p>${c.securityEmail}</p>
      <p>${c.securityValid}</p>
    </div>

    <p>${c.resetPrompt}</p>

    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">${c.buttonText}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${c.linkInstructions}
    </p>
    <div class="link-text">{{resetLink}}</div>

    <div class="warning">
      <h4>${c.warningTitle}</h4>
      <ul>
        <li>${c.warning1}</li>
        <li>${c.warning2}</li>
        <li>${c.warning3}</li>
        <li>${c.warning4}</li>
      </ul>
    </div>

    <h3>${c.nextTitle}</h3>
    <ol>
      <li>${c.next1}</li>
      <li>${c.next2}</li>
      <li>${c.next3}</li>
      <li>${c.next4}</li>
      <li>${c.next5}</li>
    </ol>

    <div class="divider"></div>

    <div class="help-section">
      <h4>${c.helpTitle}</h4>
      <p>${c.helpText}</p>
      <p style="margin-top: 12px;">${c.helpContact}</p>
    </div>
  </div>

  <div class="footer">
    <p>${c.footer1}</p>
    <p>${c.footer2}</p>
    <p>${c.footer3}</p>
  </div>
</body>
</html>`;
}

function buildText(c) {
  return `${c.textSubject}

${c.greeting}

${c.intro.replace(/<[^>]+>/g, '')}

${c.textSecurityHeader}
${c.textSecurityRequested}
${c.textSecurityValid}

${c.textResetPrompt}

${c.textWarningHeader}
${c.textWarning1}
${c.textWarning2}
${c.textWarning3}
${c.textWarning4}

${c.textNextHeader}
${c.textNext1}
${c.textNext2}
${c.textNext3}
${c.textNext4}
${c.textNext5}

${c.textHelp}

---
${c.textFooter}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: copy.subject,
      htmlContent: buildHtml(copy),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
