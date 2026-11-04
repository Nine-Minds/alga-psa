/**
 * Source-of-truth: msp-tenant-recovery email template.
 *
 * Sent when an MSP (internal) user whose email is used in more than one
 * organization asks for their sign-in links. One scoped link per organization,
 * each opening /auth/msp/signin?tenant=<slug>. The links carry only a public
 * slug: password, 2FA and captcha still apply.
 *
 * Ships exactly the languages tenantRecovery.cjs ships. The copy never says
 * "client portal": the recipient is signing in to the MSP application.
 * Shares the {{variables}} of tenant-recovery (platformName, currentYear,
 * tenantCount, tenantLinksHtml, tenantLinksText, isMultiple).
 */

const TEMPLATE_NAME = 'msp-tenant-recovery';
const SUBTYPE_NAME = 'msp-tenant-recovery';

/* eslint-disable max-len */

// Per-language copy. `intro` carries the single/multiple branch inline.
const COPY = {
  en: {
    subject: '{{platformName}} - Your Sign-in Links',
    hello: 'Hello,',
    intro: 'You asked to sign in to {{platformName}}. {{#if isMultiple}}Your email address is used in {{tenantCount}} organizations. Choose the one you want to sign in to:{{else}}Here is your sign-in link:{{/if}}',
    listTitle: 'Your Sign-in Links:',
    securityLabel: 'Security Note:',
    security: "These links only open the sign-in page for each organization. You still need your password, and any verification step your organization requires. If you didn't request them, you can safely ignore this email.",
    help: "If you have any questions or need assistance, please contact your organization's administrator.",
    rights: 'All rights reserved.',
    automated: 'This is an automated message. Please do not reply to this email.',
  },
  fr: {
    subject: '{{platformName}} - Vos liens de connexion',
    hello: 'Bonjour,',
    intro: "Vous avez demandé à vous connecter à {{platformName}}. {{#if isMultiple}}Votre adresse e-mail est utilisée dans {{tenantCount}} organisations. Choisissez celle à laquelle vous souhaitez vous connecter :{{else}}Voici votre lien de connexion :{{/if}}",
    listTitle: 'Vos liens de connexion :',
    securityLabel: 'Note de sécurité :',
    security: "Ces liens ouvrent uniquement la page de connexion de chaque organisation. Votre mot de passe et les éventuelles vérifications exigées par votre organisation restent nécessaires. Si vous ne les avez pas demandés, vous pouvez ignorer cet e-mail en toute sécurité.",
    help: "Si vous avez des questions ou besoin d'assistance, veuillez contacter l'administrateur de votre organisation.",
    rights: 'Tous droits réservés.',
    automated: 'Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.',
  },
  es: {
    subject: '{{platformName}} - Sus enlaces de inicio de sesión',
    hello: 'Hola,',
    intro: 'Solicitó iniciar sesión en {{platformName}}. {{#if isMultiple}}Su dirección de correo electrónico se usa en {{tenantCount}} organizaciones. Elija aquella en la que desea iniciar sesión:{{else}}Aquí tiene su enlace de inicio de sesión:{{/if}}',
    listTitle: 'Sus enlaces de inicio de sesión:',
    securityLabel: 'Nota de seguridad:',
    security: 'Estos enlaces solo abren la página de inicio de sesión de cada organización. Sigue siendo necesaria su contraseña y cualquier verificación que exija su organización. Si no los solicitó, puede ignorar este correo de forma segura.',
    help: 'Si tiene preguntas o necesita asistencia, contacte al administrador de su organización.',
    rights: 'Todos los derechos reservados.',
    automated: 'Este es un mensaje automático. No responda a este correo.',
  },
  de: {
    subject: '{{platformName}} - Ihre Anmeldelinks',
    hello: 'Hallo,',
    intro: 'Sie haben die Anmeldung bei {{platformName}} angefordert. {{#if isMultiple}}Ihre E-Mail-Adresse wird in {{tenantCount}} Organisationen verwendet. Wählen Sie die Organisation, bei der Sie sich anmelden möchten:{{else}}Hier ist Ihr Anmeldelink:{{/if}}',
    listTitle: 'Ihre Anmeldelinks:',
    securityLabel: 'Sicherheitshinweis:',
    security: 'Diese Links öffnen nur die Anmeldeseite der jeweiligen Organisation. Sie benötigen weiterhin Ihr Passwort und jede Verifizierung, die Ihre Organisation verlangt. Wenn Sie die Links nicht angefordert haben, können Sie diese E-Mail sicher ignorieren.',
    help: 'Bei Fragen oder für Unterstützung wenden Sie sich bitte an den Administrator Ihrer Organisation.',
    rights: 'Alle Rechte vorbehalten.',
    automated: 'Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.',
  },
  nl: {
    subject: '{{platformName}} - Uw inloglinks',
    hello: 'Hallo,',
    intro: 'U heeft gevraagd om in te loggen bij {{platformName}}. {{#if isMultiple}}Uw e-mailadres wordt gebruikt in {{tenantCount}} organisaties. Kies de organisatie waarbij u wilt inloggen:{{else}}Hier is uw inloglink:{{/if}}',
    listTitle: 'Uw inloglinks:',
    securityLabel: 'Beveiligingsopmerking:',
    security: 'Deze links openen alleen de inlogpagina van elke organisatie. U heeft nog steeds uw wachtwoord nodig, en elke verificatiestap die uw organisatie vereist. Als u ze niet heeft aangevraagd, kunt u deze e-mail veilig negeren.',
    help: 'Als u vragen heeft of hulp nodig heeft, neem dan contact op met de beheerder van uw organisatie.',
    rights: 'Alle rechten voorbehouden.',
    automated: 'Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.',
  },
  it: {
    subject: '{{platformName}} - I tuoi link di accesso',
    hello: 'Ciao,',
    intro: "Hai richiesto di accedere a {{platformName}}. {{#if isMultiple}}Il tuo indirizzo email è utilizzato in {{tenantCount}} organizzazioni. Scegli quella a cui vuoi accedere:{{else}}Ecco il tuo link di accesso:{{/if}}",
    listTitle: 'I tuoi link di accesso:',
    securityLabel: 'Nota di sicurezza:',
    security: "Questi link aprono solo la pagina di accesso di ciascuna organizzazione. Sono comunque necessari la tua password e ogni verifica richiesta dalla tua organizzazione. Se non li hai richiesti, puoi ignorare questa email in tutta sicurezza.",
    help: "Se hai domande o hai bisogno di assistenza, contatta l'amministratore della tua organizzazione.",
    rights: 'Tutti i diritti riservati.',
    automated: 'Questo è un messaggio automatico. Non rispondere a questa email.',
  },
  pl: {
    subject: '{{platformName}} - Twoje linki do logowania',
    hello: 'Cześć,',
    intro: 'Poprosiłeś(aś) o zalogowanie do {{platformName}}. {{#if isMultiple}}Twój adres e-mail jest używany w {{tenantCount}} organizacjach. Wybierz tę, do której chcesz się zalogować:{{else}}Oto Twój link do logowania:{{/if}}',
    listTitle: 'Twoje linki do logowania:',
    securityLabel: 'Uwaga dotycząca bezpieczeństwa:',
    security: 'Te linki otwierają tylko stronę logowania każdej organizacji. Nadal potrzebujesz hasła oraz każdej weryfikacji wymaganej przez Twoją organizację. Jeśli nie prosiłeś(aś) o te linki, możesz bezpiecznie zignorować tę wiadomość.',
    help: 'Jeśli masz pytania lub potrzebujesz pomocy, skontaktuj się z administratorem swojej organizacji.',
    rights: 'Wszelkie prawa zastrzeżone.',
    automated: 'To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.',
  },
  pt: {
    subject: '{{platformName}} - Seus links de login',
    hello: 'Olá,',
    intro: 'Você solicitou entrar no {{platformName}}. {{#if isMultiple}}Seu endereço de email é usado em {{tenantCount}} organizações. Escolha aquela em que deseja entrar:{{else}}Aqui está seu link de login:{{/if}}',
    listTitle: 'Seus links de login:',
    securityLabel: 'Observação de segurança:',
    security: 'Estes links apenas abrem a página de login de cada organização. Você ainda precisa da sua senha e de qualquer verificação exigida pela sua organização. Se você não os solicitou, pode ignorar este email com segurança.',
    help: 'Se tiver dúvidas ou precisar de ajuda, entre em contato com o administrador da sua organização.',
    rights: 'Todos os direitos reservados.',
    automated: 'Esta é uma mensagem automática. Não responda a este email.',
  },
  sv: {
    subject: '{{platformName}} – Dina inloggningslänkar',
    hello: 'Hej,',
    intro: 'Du har begärt att logga in på {{platformName}}. {{#if isMultiple}}Din e-postadress används i {{tenantCount}} organisationer. Välj den du vill logga in på:{{else}}Här är din inloggningslänk:{{/if}}',
    listTitle: 'Dina inloggningslänkar:',
    securityLabel: 'Säkerhetsinformation:',
    security: 'De här länkarna öppnar bara inloggningssidan för varje organisation. Du behöver fortfarande ditt lösenord och eventuella verifieringssteg som din organisation kräver. Om du inte har begärt dem kan du lugnt ignorera det här e-postmeddelandet.',
    help: 'Kontakta din organisations administratör om du har frågor eller behöver hjälp.',
    rights: 'Alla rättigheter förbehållna.',
    automated: 'Det här är ett automatiskt meddelande. Svara inte på det här e-postmeddelandet.',
  },
};

function renderHtml(c) {
  return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background-color:#8A4DEA;background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">${c.hello}</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              ${c.intro}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>${c.securityLabel}</strong> ${c.security}
              </p>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
              ${c.help}
            </p>
          </div>
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">© {{currentYear}} {{platformName}}. ${c.rights}</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">${c.automated}</p>
          </div>
        </div>
      `;
}

function renderText(c) {
  return `{{platformName}} - ${c.subject.replace(/^\{\{platformName\}\}\s*[-–]\s*/, '')}

${c.hello}

${c.intro}

${c.listTitle}
{{tenantLinksText}}

${c.securityLabel} ${c.security}

${c.help}

---
© {{currentYear}} {{platformName}}. ${c.rights}
${c.automated}`;
}

const LANGS = Object.fromEntries(
  Object.entries(COPY).map(([lang, copy]) => [
    lang,
    { subject: copy.subject, html: renderHtml(copy), text: renderText(copy) },
  ])
);

/* eslint-enable max-len */

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(LANGS).map(([lang, data]) => ({
      language: lang,
      subject: data.subject,
      htmlContent: data.html,
      textContent: data.text,
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
