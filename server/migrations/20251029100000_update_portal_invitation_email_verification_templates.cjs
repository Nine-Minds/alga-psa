/**
 * Update portal-invitation templates for FR, ES, DE, NL, IT with advanced styling
 * Update email-verification templates for EN, FR, ES, DE, NL, IT with advanced styling
 *
 * These templates were previously overwritten by language-specific migrations.
 * This migration restores the professionally-styled versions.
 */

exports.up = async function(knex) {
  console.log('Updating portal-invitation and email-verification templates with advanced styling...');

  // Get notification subtype IDs
  const subtypes = await knex('notification_subtypes')
    .select('id', 'name')
    .whereIn('name', [
      'portal-invitation',
      'email-verification'
    ]);

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  // The advanced CSS styling shared across all portal-invitation templates
  const portalInvitationStyles = `
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
    }
  `;

  // Update portal-invitation templates with advanced styling
  const portalInvitationTemplates = [
    // French
    {
      language_code: 'fr',
      subject: 'Invitation au portail client - {{clientName}}',
      headerTitle: 'Bienvenue sur votre portail client',
      headerSubtitle: 'Vous êtes invité à accéder à votre compte',
      greeting: 'Bonjour {{contactName}},',
      intro: 'Excellente nouvelle ! Vous avez été invité à accéder au portail client de <strong>{{clientName}}</strong>. Ce portail sécurisé vous donne un accès instantané à :',
      accessTitle: '🎯 Ce à quoi vous pouvez accéder',
      access1: '✓ Consulter et suivre vos tickets de support',
      access2: '✓ Examiner les mises à jour de projet et la documentation',
      access3: '✓ Communiquer directement avec votre équipe de support',
      tagline: 'Profitez d\'une gestion de services fluide avec notre portail intuitif. Tout ce dont vous avez besoin pour rester informé et connecté, le tout dans un emplacement sécurisé.',
      buttonText: 'Configurer votre accès au portail',
      linkInstructions: 'Ou copiez et collez ce lien dans votre navigateur :',
      warningTitle: '⏰ Invitation à durée limitée',
      warningText: 'Ce lien d\'invitation expirera dans <strong>{{expirationTime}}</strong>. Veuillez compléter la configuration de votre compte avant cette date pour garantir un accès ininterrompu.',
      contactTitle: 'Besoin d\'assistance ?',
      contactEmail: '<strong>Email :</strong> {{clientLocationEmail}}',
      contactPhone: '<strong>Téléphone :</strong> {{clientLocationPhone}}',
      contactNote: 'Notre équipe de support est prête à vous aider à démarrer.',
      footer1: 'Cet email a été envoyé à {{contactName}} dans le cadre de la configuration de votre accès au portail.',
      footer2: 'Si vous ne vous attendiez pas à cette invitation, veuillez nous contacter à {{clientLocationEmail}}.',
      footer3: '© {{currentYear}} {{clientName}}. Tous droits réservés.',
      textIntro: 'Excellente nouvelle ! Vous avez été invité à accéder au portail client de {{clientName}}. Ce portail sécurisé vous donne un accès instantané à :',
      textAccess: '✓ Consulter et suivre vos tickets de support\n✓ Examiner les mises à jour de projet et la documentation\n✓ Communiquer directement avec votre équipe de support',
      textTagline: 'Profitez d\'une gestion de services fluide avec notre portail intuitif. Tout ce dont vous avez besoin pour rester informé et connecté, le tout dans un emplacement sécurisé.',
      textButton: 'Configurer votre accès au portail : {{portalLink}}',
      textWarning: '⏰ Invitation à durée limitée\nCe lien d\'invitation expirera dans {{expirationTime}}. Veuillez compléter la configuration de votre compte avant cette date pour garantir un accès ininterrompu.',
      textContact: 'Besoin d\'assistance ?\nEmail : {{clientLocationEmail}}\nTéléphone : {{clientLocationPhone}}\nNotre équipe de support est prête à vous aider à démarrer.',
      textFooter: 'Cet email a été envoyé à {{contactName}} dans le cadre de la configuration de votre accès au portail.\nSi vous ne vous attendiez pas à cette invitation, veuillez nous contacter à {{clientLocationEmail}}.\n© {{currentYear}} {{clientName}}. Tous droits réservés.'
    },
    // Spanish
    {
      language_code: 'es',
      subject: 'Invitación al portal del cliente - {{clientName}}',
      headerTitle: 'Bienvenido a su portal de cliente',
      headerSubtitle: 'Está invitado a acceder a su cuenta',
      greeting: 'Hola {{contactName}},',
      intro: '¡Buenas noticias! Has sido invitado a acceder al portal de cliente de <strong>{{clientName}}</strong>. Este portal seguro te da acceso instantáneo a:',
      accessTitle: '🎯 Lo que puedes acceder',
      access1: '✓ Ver y rastrear tus tickets de soporte',
      access2: '✓ Revisar actualizaciones de proyectos y documentación',
      access3: '✓ Comunicarte directamente con tu equipo de soporte',
      tagline: 'Experimenta la gestión de servicios sin problemas con nuestro portal intuitivo. Todo lo que necesitas para mantenerte informado y conectado, todo en una ubicación segura.',
      buttonText: 'Configurar tu acceso al portal',
      linkInstructions: 'O copia y pega este enlace en tu navegador:',
      warningTitle: '⏰ Invitación con límite de tiempo',
      warningText: 'Este enlace de invitación expirará en <strong>{{expirationTime}}</strong>. Por favor, completa la configuración de tu cuenta antes de esa fecha para garantizar un acceso ininterrumpido.',
      contactTitle: '¿Necesitas ayuda?',
      contactEmail: '<strong>Email:</strong> {{clientLocationEmail}}',
      contactPhone: '<strong>Teléfono:</strong> {{clientLocationPhone}}',
      contactNote: 'Nuestro equipo de soporte está listo para ayudarte a comenzar.',
      footer1: 'Este correo electrónico fue enviado a {{contactName}} como parte de la configuración de acceso a tu portal.',
      footer2: 'Si no esperabas esta invitación, por favor contáctanos en {{clientLocationEmail}}.',
      footer3: '© {{currentYear}} {{clientName}}. Todos los derechos reservados.',
      textIntro: '¡Buenas noticias! Has sido invitado a acceder al portal de cliente de {{clientName}}. Este portal seguro te da acceso instantáneo a:',
      textAccess: '✓ Ver y rastrear tus tickets de soporte\n✓ Revisar actualizaciones de proyectos y documentación\n✓ Comunicarte directamente con tu equipo de soporte',
      textTagline: 'Experimenta la gestión de servicios sin problemas con nuestro portal intuitivo. Todo lo que necesitas para mantenerte informado y conectado, todo en una ubicación segura.',
      textButton: 'Configurar tu acceso al portal: {{portalLink}}',
      textWarning: '⏰ Invitación con límite de tiempo\nEste enlace de invitación expirará en {{expirationTime}}. Por favor, completa la configuración de tu cuenta antes de esa fecha para garantizar un acceso ininterrumpido.',
      textContact: '¿Necesitas ayuda?\nEmail: {{clientLocationEmail}}\nTeléfono: {{clientLocationPhone}}\nNuestro equipo de soporte está listo para ayudarte a comenzar.',
      textFooter: 'Este correo electrónico fue enviado a {{contactName}} como parte de la configuración de acceso a tu portal.\nSi no esperabas esta invitación, por favor contáctanos en {{clientLocationEmail}}.\n© {{currentYear}} {{clientName}}. Todos los derechos reservados.'
    },
    // German
    {
      language_code: 'de',
      subject: 'Kundenportal-Einladung - {{clientName}}',
      headerTitle: 'Willkommen in Ihrem Kundenportal',
      headerSubtitle: 'Sie sind eingeladen, auf Ihr Konto zuzugreifen',
      greeting: 'Hallo {{contactName}},',
      intro: 'Gute Nachrichten! Sie wurden eingeladen, auf das Kundenportal von <strong>{{clientName}}</strong> zuzugreifen. Dieses sichere Portal bietet Ihnen sofortigen Zugang zu:',
      accessTitle: '🎯 Was Sie zugreifen können',
      access1: '✓ Ihre Support-Tickets anzeigen und verfolgen',
      access2: '✓ Projekt-Updates und Dokumentation überprüfen',
      access3: '✓ Direkt mit Ihrem Support-Team kommunizieren',
      tagline: 'Erleben Sie nahtloses Service-Management mit unserem intuitiven Portal. Alles, was Sie brauchen, um informiert und verbunden zu bleiben, an einem sicheren Ort.',
      buttonText: 'Richten Sie Ihren Portalzugang ein',
      linkInstructions: 'Oder kopieren Sie diesen Link in Ihren Browser:',
      warningTitle: '⏰ Zeitlich begrenzte Einladung',
      warningText: 'Dieser Einladungslink läuft in <strong>{{expirationTime}}</strong> ab. Bitte schließen Sie Ihre Kontoeinrichtung vorher ab, um einen unterbrechungsfreien Zugang zu gewährleisten.',
      contactTitle: 'Benötigen Sie Hilfe?',
      contactEmail: '<strong>E-Mail:</strong> {{clientLocationEmail}}',
      contactPhone: '<strong>Telefon:</strong> {{clientLocationPhone}}',
      contactNote: 'Unser Support-Team ist bereit, Ihnen beim Einstieg zu helfen.',
      footer1: 'Diese E-Mail wurde an {{contactName}} als Teil Ihrer Portalzugangseinrichtung gesendet.',
      footer2: 'Wenn Sie diese Einladung nicht erwartet haben, kontaktieren Sie uns bitte unter {{clientLocationEmail}}.',
      footer3: '© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.',
      textIntro: 'Gute Nachrichten! Sie wurden eingeladen, auf das Kundenportal von {{clientName}} zuzugreifen. Dieses sichere Portal bietet Ihnen sofortigen Zugang zu:',
      textAccess: '✓ Ihre Support-Tickets anzeigen und verfolgen\n✓ Projekt-Updates und Dokumentation überprüfen\n✓ Direkt mit Ihrem Support-Team kommunizieren',
      textTagline: 'Erleben Sie nahtloses Service-Management mit unserem intuitiven Portal. Alles, was Sie brauchen, um informiert und verbunden zu bleiben, an einem sicheren Ort.',
      textButton: 'Richten Sie Ihren Portalzugang ein: {{portalLink}}',
      textWarning: '⏰ Zeitlich begrenzte Einladung\nDieser Einladungslink läuft in {{expirationTime}} ab. Bitte schließen Sie Ihre Kontoeinrichtung vorher ab, um einen unterbrechungsfreien Zugang zu gewährleisten.',
      textContact: 'Benötigen Sie Hilfe?\nE-Mail: {{clientLocationEmail}}\nTelefon: {{clientLocationPhone}}\nUnser Support-Team ist bereit, Ihnen beim Einstieg zu helfen.',
      textFooter: 'Diese E-Mail wurde an {{contactName}} als Teil Ihrer Portalzugangseinrichtung gesendet.\nWenn Sie diese Einladung nicht erwartet haben, kontaktieren Sie uns bitte unter {{clientLocationEmail}}.\n© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.'
    },
    // Dutch
    {
      language_code: 'nl',
      subject: 'Uitnodiging voor klantenportaal - {{clientName}}',
      headerTitle: 'Welkom bij uw klantenportaal',
      headerSubtitle: 'U bent uitgenodigd om toegang te krijgen tot uw account',
      greeting: 'Hallo {{contactName}},',
      intro: 'Goed nieuws! U bent uitgenodigd om toegang te krijgen tot het klantenportaal van <strong>{{clientName}}</strong>. Dit beveiligde portal geeft u directe toegang tot:',
      accessTitle: '🎯 Waartoe u toegang heeft',
      access1: '✓ Uw supporttickets bekijken en volgen',
      access2: '✓ Project-updates en documentatie bekijken',
      access3: '✓ Direct communiceren met uw supportteam',
      tagline: 'Ervaar naadloos servicebeheer met ons intuïtieve portal. Alles wat u nodig heeft om geïnformeerd en verbonden te blijven, allemaal op één veilige locatie.',
      buttonText: 'Stel uw portaaltoegang in',
      linkInstructions: 'Of kopieer en plak deze link in uw browser:',
      warningTitle: '⏰ Tijdgevoelige uitnodiging',
      warningText: 'Deze uitnodigingslink verloopt over <strong>{{expirationTime}}</strong>. Voltooi uw accountconfiguratie vóór die tijd om ononderbroken toegang te garanderen.',
      contactTitle: 'Hulp nodig?',
      contactEmail: '<strong>E-mail:</strong> {{clientLocationEmail}}',
      contactPhone: '<strong>Telefoon:</strong> {{clientLocationPhone}}',
      contactNote: 'Ons supportteam staat klaar om u op weg te helpen.',
      footer1: 'Deze e-mail is verzonden naar {{contactName}} als onderdeel van uw portaaltoegangsinstelling.',
      footer2: 'Als u deze uitnodiging niet verwachtte, neem dan contact met ons op via {{clientLocationEmail}}.',
      footer3: '© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.',
      textIntro: 'Goed nieuws! U bent uitgenodigd om toegang te krijgen tot het klantenportaal van {{clientName}}. Dit beveiligde portal geeft u directe toegang tot:',
      textAccess: '✓ Uw supporttickets bekijken en volgen\n✓ Project-updates en documentatie bekijken\n✓ Direct communiceren met uw supportteam',
      textTagline: 'Ervaar naadloos servicebeheer met ons intuïtieve portal. Alles wat u nodig heeft om geïnformeerd en verbonden te blijven, allemaal op één veilige locatie.',
      textButton: 'Stel uw portaaltoegang in: {{portalLink}}',
      textWarning: '⏰ Tijdgevoelige uitnodiging\nDeze uitnodigingslink verloopt over {{expirationTime}}. Voltooi uw accountconfiguratie vóór die tijd om ononderbroken toegang te garanderen.',
      textContact: 'Hulp nodig?\nE-mail: {{clientLocationEmail}}\nTelefoon: {{clientLocationPhone}}\nOns supportteam staat klaar om u op weg te helpen.',
      textFooter: 'Deze e-mail is verzonden naar {{contactName}} als onderdeel van uw portaaltoegangsinstelling.\nAls u deze uitnodiging niet verwachtte, neem dan contact met ons op via {{clientLocationEmail}}.\n© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.'
    },
    // Italian
    {
      language_code: 'it',
      subject: 'Invito al portale clienti - {{clientName}}',
      headerTitle: 'Benvenuto nel portale clienti',
      headerSubtitle: 'Sei invitato ad accedere al tuo account',
      greeting: 'Ciao {{contactName}},',
      intro: 'Ottime notizie! Sei stato invitato ad accedere al portale clienti di <strong>{{clientName}}</strong>. Questo portale sicuro ti dà accesso immediato a:',
      accessTitle: '🎯 A cosa puoi accedere',
      access1: '✓ Visualizzare e monitorare i tuoi ticket di supporto',
      access2: '✓ Rivedere gli aggiornamenti dei progetti e la documentazione',
      access3: '✓ Comunicare direttamente con il tuo team di supporto',
      tagline: 'Sperimenta una gestione dei servizi senza problemi con il nostro portale intuitivo. Tutto ciò di cui hai bisogno per rimanere informato e connesso, tutto in un\'unica posizione sicura.',
      buttonText: 'Configura il tuo accesso al portale',
      linkInstructions: 'Oppure copia e incolla questo link nel tuo browser:',
      warningTitle: '⏰ Invito a tempo limitato',
      warningText: 'Questo link di invito scadrà tra <strong>{{expirationTime}}</strong>. Completa la configurazione del tuo account prima di allora per garantire un accesso ininterrotto.',
      contactTitle: 'Hai bisogno di assistenza?',
      contactEmail: '<strong>Email:</strong> {{clientLocationEmail}}',
      contactPhone: '<strong>Telefono:</strong> {{clientLocationPhone}}',
      contactNote: 'Il nostro team di supporto è pronto ad aiutarti a iniziare.',
      footer1: 'Questa email è stata inviata a {{contactName}} come parte della configurazione dell\'accesso al portale.',
      footer2: 'Se non ti aspettavi questo invito, contattaci all\'indirizzo {{clientLocationEmail}}.',
      footer3: '© {{currentYear}} {{clientName}}. Tutti i diritti riservati.',
      textIntro: 'Ottime notizie! Sei stato invitato ad accedere al portale clienti di {{clientName}}. Questo portale sicuro ti dà accesso immediato a:',
      textAccess: '✓ Visualizzare e monitorare i tuoi ticket di supporto\n✓ Rivedere gli aggiornamenti dei progetti e la documentazione\n✓ Comunicare direttamente con il tuo team di supporto',
      textTagline: 'Sperimenta una gestione dei servizi senza problemi con il nostro portale intuitivo. Tutto ciò di cui hai bisogno per rimanere informato e connesso, tutto in un\'unica posizione sicura.',
      textButton: 'Configura il tuo accesso al portale: {{portalLink}}',
      textWarning: '⏰ Invito a tempo limitato\nQuesto link di invito scadrà tra {{expirationTime}}. Completa la configurazione del tuo account prima di allora per garantire un accesso ininterrotto.',
      textContact: 'Hai bisogno di assistenza?\nEmail: {{clientLocationEmail}}\nTelefono: {{clientLocationPhone}}\nIl nostro team di supporto è pronto ad aiutarti a iniziare.',
      textFooter: 'Questa email è stata inviata a {{contactName}} come parte della configurazione dell\'accesso al portale.\nSe non ti aspettavi questo invito, contattaci all\'indirizzo {{clientLocationEmail}}.\n© {{currentYear}} {{clientName}}. Tutti i diritti riservati.'
    }
  ];

  // Build the insert array for portal-invitation templates
  const portalTemplates = portalInvitationTemplates.map(template => ({
    name: 'portal-invitation',
    language_code: template.language_code,
    subject: template.subject,
    notification_subtype_id: getSubtypeId('portal-invitation'),
    html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Access Invitation</title>
  <style>
${portalInvitationStyles}
  </style>
</head>
<body>
  <div class="header">
    <h1>${template.headerTitle}</h1>
    <p>${template.headerSubtitle}</p>
  </div>

  <div class="content">
    <h2>${template.greeting}</h2>

    <p>${template.intro}</p>

    <div class="info-box">
      <h3>${template.accessTitle}</h3>
      <p>${template.access1}</p>
      <p>${template.access2}</p>
      <p>${template.access3}</p>
    </div>

    <div class="tagline">
      ${template.tagline}
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">${template.buttonText}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${template.linkInstructions}
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>${template.warningTitle}</h4>
      <p>${template.warningText}</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>${template.contactTitle}</h4>
      <p>${template.contactEmail}</p>
      <p>${template.contactPhone}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">${template.contactNote}</p>
    </div>
  </div>

  <div class="footer">
    <p>${template.footer1}</p>
    <p>${template.footer2}</p>
    <p>${template.footer3}</p>
  </div>
</body>
</html>`,
    text_content: `${template.headerTitle}

${template.greeting}

${template.textIntro}

${template.textAccess}

${template.textTagline}

${template.textButton}

${template.textWarning}

${template.textContact}

---
${template.textFooter}`
  }));

  // English email-verification with advanced styling
  const emailVerificationEn = {
    name: 'email-verification',
    language_code: 'en',
    subject: 'Verify your email{{#if registrationClientName}} for {{registrationClientName}}{{/if}}',
    notification_subtype_id: getSubtypeId('email-verification'),
    html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
  <style>
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
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Email Verification</h1>
    <p>Confirm your email address to get started</p>
  </div>

  <div class="content">
    <h2>Hello,</h2>

    <p>Welcome! Please verify your email address to activate your account{{#if registrationClientName}} for <strong>{{registrationClientName}}</strong>{{/if}}.</p>

    <div class="verification-box">
      <h3>✉️ Why verify your email?</h3>
      <p>✓ Ensures account security and recovery options</p>
      <p>✓ Enables important notifications and updates</p>
      <p>✓ Confirms you're the account owner</p>
    </div>

    <div style="text-align: center;">
      <a href="{{verificationUrl}}" class="action-button">Verify Email Address</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Or copy and paste this link into your browser:
    </p>
    <div class="link-text">{{verificationUrl}}</div>

    {{#if expirationTime}}
    <div class="warning">
      <h4>⏰ Time-Sensitive Verification</h4>
      <p>This verification link will expire in <strong>{{expirationTime}}</strong>. Please complete verification before then.</p>
    </div>
    {{/if}}

    <div class="divider"></div>

    <p style="color: #64748b; font-size: 14px;">
      <strong>Didn't request this email?</strong> You can safely ignore it. Your email address won't be added to our system unless you click the verification link above.
    </p>
  </div>

  <div class="footer">
    <p>This is an automated security email.</p>
    <p>© {{currentYear}} {{tenantClientName}}. All rights reserved.</p>
  </div>
</body>
</html>`,
    text_content: `Email Verification

Hello,

Welcome! Please verify your email address to activate your account{{#if registrationClientName}} for {{registrationClientName}}{{/if}}.

✉️ Why verify your email?
✓ Ensures account security and recovery options
✓ Enables important notifications and updates
✓ Confirms you're the account owner

Verify Email Address: {{verificationUrl}}

{{#if expirationTime}}⏰ Time-Sensitive Verification
This verification link will expire in {{expirationTime}}. Please complete verification before then.{{/if}}

Didn't request this email? You can safely ignore it. Your email address won't be added to our system unless you click the verification link above.

---
This is an automated security email.
© {{currentYear}} {{tenantClientName}}. All rights reserved.`
  };

  // Email verification templates for all 5 languages (FR, ES, DE, NL, IT)
  const emailVerificationTemplates = [
    // French
    {
      language_code: 'fr',
      subject: 'Vérifiez votre email{{#if registrationClientName}} pour {{registrationClientName}}{{/if}}',
      headerTitle: 'Vérification d\'email',
      headerSubtitle: 'Confirmez votre adresse email pour commencer',
      greeting: 'Bonjour,',
      intro: 'Bienvenue ! Veuillez vérifier votre adresse email pour activer votre compte{{#if registrationClientName}} pour <strong>{{registrationClientName}}</strong>{{/if}}.',
      whyTitle: '✉️ Pourquoi vérifier votre email ?',
      why1: '✓ Assure la sécurité du compte et les options de récupération',
      why2: '✓ Active les notifications et mises à jour importantes',
      why3: '✓ Confirme que vous êtes le propriétaire du compte',
      buttonText: 'Vérifier l\'adresse email',
      linkInstructions: 'Ou copiez et collez ce lien dans votre navigateur :',
      warningTitle: '⏰ Vérification à durée limitée',
      warningText: 'Ce lien de vérification expirera dans <strong>{{expirationTime}}</strong>. Veuillez compléter la vérification avant.',
      didntRequest: '<strong>Vous n\'avez pas demandé cet email ?</strong> Vous pouvez l\'ignorer en toute sécurité. Votre adresse email ne sera pas ajoutée à notre système sauf si vous cliquez sur le lien de vérification ci-dessus.',
      footer1: 'Ceci est un email de sécurité automatisé.',
      footer2: '© {{currentYear}} {{tenantClientName}}. Tous droits réservés.',
      textWhy: '✉️ Pourquoi vérifier votre email ?\n✓ Assure la sécurité du compte et les options de récupération\n✓ Active les notifications et mises à jour importantes\n✓ Confirme que vous êtes le propriétaire du compte',
      textButton: 'Vérifier l\'adresse email : {{verificationUrl}}',
      textWarning: '⏰ Vérification à durée limitée\nCe lien de vérification expirera dans {{expirationTime}}. Veuillez compléter la vérification avant.',
      textDidntRequest: 'Vous n\'avez pas demandé cet email ? Vous pouvez l\'ignorer en toute sécurité. Votre adresse email ne sera pas ajoutée à notre système sauf si vous cliquez sur le lien de vérification ci-dessus.',
      textFooter: 'Ceci est un email de sécurité automatisé.\n© {{currentYear}} {{tenantClientName}}. Tous droits réservés.'
    },
    // Spanish
    {
      language_code: 'es',
      subject: 'Verifica tu email{{#if registrationClientName}} para {{registrationClientName}}{{/if}}',
      headerTitle: 'Verificación de email',
      headerSubtitle: 'Confirma tu dirección de email para comenzar',
      greeting: 'Hola,',
      intro: '¡Bienvenido! Por favor verifica tu dirección de email para activar tu cuenta{{#if registrationClientName}} para <strong>{{registrationClientName}}</strong>{{/if}}.',
      whyTitle: '✉️ ¿Por qué verificar tu email?',
      why1: '✓ Garantiza la seguridad de la cuenta y opciones de recuperación',
      why2: '✓ Habilita notificaciones y actualizaciones importantes',
      why3: '✓ Confirma que eres el propietario de la cuenta',
      buttonText: 'Verificar dirección de email',
      linkInstructions: 'O copia y pega este enlace en tu navegador:',
      warningTitle: '⏰ Verificación con límite de tiempo',
      warningText: 'Este enlace de verificación expirará en <strong>{{expirationTime}}</strong>. Por favor completa la verificación antes.',
      didntRequest: '<strong>¿No solicitaste este email?</strong> Puedes ignorarlo de forma segura. Tu dirección de email no se agregará a nuestro sistema a menos que hagas clic en el enlace de verificación anterior.',
      footer1: 'Este es un email de seguridad automatizado.',
      footer2: '© {{currentYear}} {{tenantClientName}}. Todos los derechos reservados.',
      textWhy: '✉️ ¿Por qué verificar tu email?\n✓ Garantiza la seguridad de la cuenta y opciones de recuperación\n✓ Habilita notificaciones y actualizaciones importantes\n✓ Confirma que eres el propietario de la cuenta',
      textButton: 'Verificar dirección de email: {{verificationUrl}}',
      textWarning: '⏰ Verificación con límite de tiempo\nEste enlace de verificación expirará en {{expirationTime}}. Por favor completa la verificación antes.',
      textDidntRequest: '¿No solicitaste este email? Puedes ignorarlo de forma segura. Tu dirección de email no se agregará a nuestro sistema a menos que hagas clic en el enlace de verificación anterior.',
      textFooter: 'Este es un email de seguridad automatizado.\n© {{currentYear}} {{tenantClientName}}. Todos los derechos reservados.'
    },
    // German
    {
      language_code: 'de',
      subject: 'Verifizieren Sie Ihre E-Mail{{#if registrationClientName}} für {{registrationClientName}}{{/if}}',
      headerTitle: 'E-Mail-Verifizierung',
      headerSubtitle: 'Bestätigen Sie Ihre E-Mail-Adresse, um zu beginnen',
      greeting: 'Hallo,',
      intro: 'Willkommen! Bitte verifizieren Sie Ihre E-Mail-Adresse, um Ihr Konto zu aktivieren{{#if registrationClientName}} für <strong>{{registrationClientName}}</strong>{{/if}}.',
      whyTitle: '✉️ Warum Ihre E-Mail verifizieren?',
      why1: '✓ Gewährleistet Kontosicherheit und Wiederherstellungsoptionen',
      why2: '✓ Aktiviert wichtige Benachrichtigungen und Updates',
      why3: '✓ Bestätigt, dass Sie der Kontoinhaber sind',
      buttonText: 'E-Mail-Adresse verifizieren',
      linkInstructions: 'Oder kopieren Sie diesen Link in Ihren Browser:',
      warningTitle: '⏰ Zeitlich begrenzte Verifizierung',
      warningText: 'Dieser Verifizierungslink läuft in <strong>{{expirationTime}}</strong> ab. Bitte schließen Sie die Verifizierung vorher ab.',
      didntRequest: '<strong>Haben Sie diese E-Mail nicht angefordert?</strong> Sie können sie sicher ignorieren. Ihre E-Mail-Adresse wird unserem System nicht hinzugefügt, es sei denn, Sie klicken auf den Verifizierungslink oben.',
      footer1: 'Dies ist eine automatisierte Sicherheits-E-Mail.',
      footer2: '© {{currentYear}} {{tenantClientName}}. Alle Rechte vorbehalten.',
      textWhy: '✉️ Warum Ihre E-Mail verifizieren?\n✓ Gewährleistet Kontosicherheit und Wiederherstellungsoptionen\n✓ Aktiviert wichtige Benachrichtigungen und Updates\n✓ Bestätigt, dass Sie der Kontoinhaber sind',
      textButton: 'E-Mail-Adresse verifizieren: {{verificationUrl}}',
      textWarning: '⏰ Zeitlich begrenzte Verifizierung\nDieser Verifizierungslink läuft in {{expirationTime}} ab. Bitte schließen Sie die Verifizierung vorher ab.',
      textDidntRequest: 'Haben Sie diese E-Mail nicht angefordert? Sie können sie sicher ignorieren. Ihre E-Mail-Adresse wird unserem System nicht hinzugefügt, es sei denn, Sie klicken auf den Verifizierungslink oben.',
      textFooter: 'Dies ist eine automatisierte Sicherheits-E-Mail.\n© {{currentYear}} {{tenantClientName}}. Alle Rechte vorbehalten.'
    },
    // Dutch
    {
      language_code: 'nl',
      subject: 'Verifieer uw e-mail{{#if registrationClientName}} voor {{registrationClientName}}{{/if}}',
      headerTitle: 'E-mailverificatie',
      headerSubtitle: 'Bevestig uw e-mailadres om te beginnen',
      greeting: 'Hallo,',
      intro: 'Welkom! Verifieer uw e-mailadres om uw account te activeren{{#if registrationClientName}} voor <strong>{{registrationClientName}}</strong>{{/if}}.',
      whyTitle: '✉️ Waarom uw e-mail verifiëren?',
      why1: '✓ Zorgt voor accountbeveiliging en hersteloptjes',
      why2: '✓ Schakelt belangrijke meldingen en updates in',
      why3: '✓ Bevestigt dat u de accounteigenaar bent',
      buttonText: 'E-mailadres verifiëren',
      linkInstructions: 'Of kopieer en plak deze link in uw browser:',
      warningTitle: '⏰ Tijdgevoelige verificatie',
      warningText: 'Deze verificatielink verloopt over <strong>{{expirationTime}}</strong>. Voltooi de verificatie vóór die tijd.',
      didntRequest: '<strong>Heeft u deze e-mail niet aangevraagd?</strong> U kunt deze veilig negeren. Uw e-mailadres wordt niet toegevoegd aan ons systeem tenzij u op de verificatielink hierboven klikt.',
      footer1: 'Dit is een geautomatiseerde beveiligingse-mail.',
      footer2: '© {{currentYear}} {{tenantClientName}}. Alle rechten voorbehouden.',
      textWhy: '✉️ Waarom uw e-mail verifiëren?\n✓ Zorgt voor accountbeveiliging en hersteloptjes\n✓ Schakelt belangrijke meldingen en updates in\n✓ Bevestigt dat u de accounteigenaar bent',
      textButton: 'E-mailadres verifiëren: {{verificationUrl}}',
      textWarning: '⏰ Tijdgevoelige verificatie\nDeze verificatielink verloopt over {{expirationTime}}. Voltooi de verificatie vóór die tijd.',
      textDidntRequest: 'Heeft u deze e-mail niet aangevraagd? U kunt deze veilig negeren. Uw e-mailadres wordt niet toegevoegd aan ons systeem tenzij u op de verificatielink hierboven klikt.',
      textFooter: 'Dit is een geautomatiseerde beveiligingse-mail.\n© {{currentYear}} {{tenantClientName}}. Alle rechten voorbehouden.'
    },
    // Italian
    {
      language_code: 'it',
      subject: 'Verifica il tuo indirizzo email{{#if registrationClientName}} per {{registrationClientName}}{{/if}}',
      headerTitle: 'Verifica email',
      headerSubtitle: 'Conferma il tuo indirizzo email per iniziare',
      greeting: 'Ciao,',
      intro: 'Benvenuto! Verifica il tuo indirizzo email per attivare il tuo account{{#if registrationClientName}} per <strong>{{registrationClientName}}</strong>{{/if}}.',
      whyTitle: '✉️ Perché verificare la tua email?',
      why1: '✓ Garantisce la sicurezza dell\'account e le opzioni di recupero',
      why2: '✓ Abilita notifiche e aggiornamenti importanti',
      why3: '✓ Conferma che sei il proprietario dell\'account',
      buttonText: 'Verifica indirizzo email',
      linkInstructions: 'Oppure copia e incolla questo link nel tuo browser:',
      warningTitle: '⏰ Verifica a tempo limitato',
      warningText: 'Questo link di verifica scadrà tra <strong>{{expirationTime}}</strong>. Completa la verifica prima di allora.',
      didntRequest: '<strong>Non hai richiesto questa email?</strong> Puoi ignorarla tranquillamente. Il tuo indirizzo email non verrà aggiunto al nostro sistema a meno che tu non faccia clic sul link di verifica qui sopra.',
      footer1: 'Questa è un\'email di sicurezza automatica.',
      footer2: '© {{currentYear}} {{tenantClientName}}. Tutti i diritti riservati.',
      textWhy: '✉️ Perché verificare la tua email?\n✓ Garantisce la sicurezza dell\'account e le opzioni di recupero\n✓ Abilita notifiche e aggiornamenti importanti\n✓ Conferma che sei il proprietario dell\'account',
      textButton: 'Verifica indirizzo email: {{verificationUrl}}',
      textWarning: '⏰ Verifica a tempo limitato\nQuesto link di verifica scadrà tra {{expirationTime}}. Completa la verifica prima di allora.',
      textDidntRequest: 'Non hai richiesto questa email? Puoi ignorarla tranquillamente. Il tuo indirizzo email non verrà aggiunto al nostro sistema a meno che tu non faccia clic sul link di verifica qui sopra.',
      textFooter: 'Questa è un\'email di sicurezza automatica.\n© {{currentYear}} {{tenantClientName}}. Tutti i diritti riservati.'
    }
  ];

  // Build email verification templates array
  const emailVerificationTemplatesArray = emailVerificationTemplates.map(template => ({
    name: 'email-verification',
    language_code: template.language_code,
    subject: template.subject,
    notification_subtype_id: getSubtypeId('email-verification'),
    html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
  <style>
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
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${template.headerTitle}</h1>
    <p>${template.headerSubtitle}</p>
  </div>

  <div class="content">
    <h2>${template.greeting}</h2>

    <p>${template.intro}</p>

    <div class="verification-box">
      <h3>${template.whyTitle}</h3>
      <p>${template.why1}</p>
      <p>${template.why2}</p>
      <p>${template.why3}</p>
    </div>

    <div style="text-align: center;">
      <a href="{{verificationUrl}}" class="action-button">${template.buttonText}</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      ${template.linkInstructions}
    </p>
    <div class="link-text">{{verificationUrl}}</div>

    {{#if expirationTime}}
    <div class="warning">
      <h4>${template.warningTitle}</h4>
      <p>${template.warningText}</p>
    </div>
    {{/if}}

    <div class="divider"></div>

    <p style="color: #64748b; font-size: 14px;">
      ${template.didntRequest}
    </p>
  </div>

  <div class="footer">
    <p>${template.footer1}</p>
    <p>${template.footer2}</p>
  </div>
</body>
</html>`,
    text_content: `${template.headerTitle}

${template.greeting}

${template.intro}

${template.textWhy}

${template.textButton}

{{#if expirationTime}}${template.textWarning}{{/if}}

${template.textDidntRequest}

---
${template.textFooter}`
  }));

  // Insert all templates using onConflict to update existing ones
  await knex('system_email_templates')
    .insert([...portalTemplates, emailVerificationEn, ...emailVerificationTemplatesArray])
    .onConflict(['name', 'language_code'])
    .merge({
      subject: knex.raw('excluded.subject'),
      html_content: knex.raw('excluded.html_content'),
      text_content: knex.raw('excluded.text_content'),
      notification_subtype_id: knex.raw('excluded.notification_subtype_id')
    });

  console.log('✓ Updated portal-invitation templates (FR, ES, DE, NL, IT) with advanced styling');
  console.log('✓ Updated email-verification templates (EN, FR, ES, DE, NL, IT) with advanced styling');
};

exports.down = async function(knex) {
  // This rollback would revert to the simpler versions
  // In practice, you probably don't want to roll this back
  console.log('Note: Rollback would revert to previous template versions');
  console.log('Skipping rollback to preserve advanced styling');
};
