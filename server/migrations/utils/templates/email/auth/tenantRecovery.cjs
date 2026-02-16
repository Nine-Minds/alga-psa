/**
 * Source-of-truth: tenant-recovery email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * All languages use simple inline-style HTML. The structure is consistent
 * across languages with per-language translated text.
 */

const TEMPLATE_NAME = 'tenant-recovery';
const SUBTYPE_NAME = 'tenant-recovery';

/* eslint-disable max-len */

/* ------------------------------------------------------------------ */
/*  Per-language HTML and text templates                              */
/* ------------------------------------------------------------------ */
const LANGS = {
  en: {
    subject: '{{platformName}} - Your Login Links',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hello,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              You requested access to your client portal{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}We found {{tenantCount}} organizations associated with your email address.{{else}}Here is your login link:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Security Note:</strong> If you didn't request these login links, you can safely ignore this email. Your account remains secure.
              </p>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
              If you have any questions or need assistance, please contact your organization's support team.
            </p>
          </div>
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">\u00a9 {{currentYear}} {{platformName}}. All rights reserved.</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Your Login Links

Hello,

You requested access to your client portal{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}We found {{tenantCount}} organizations associated with your email address.{{else}}Here is your login link:{{/if}}

Your Login Links:
{{tenantLinksText}}

Security Note: If you didn't request these login links, you can safely ignore this email. Your account remains secure.

If you have any questions or need assistance, please contact your organization's support team.

---
\u00a9 {{currentYear}} {{platformName}}. All rights reserved.
This is an automated message. Please do not reply to this email.`,
  },
  fr: {
    subject: '{{platformName}} - Vos liens de connexion',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Vous avez demand\u00e9 l'acc\u00e8s \u00e0 votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Nous avons trouv\u00e9 {{tenantCount}} organisations associ\u00e9es \u00e0 votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de s\u00e9curit\u00e9 :</strong> Si vous n'avez pas demand\u00e9 ces liens de connexion, vous pouvez ignorer cet e-mail en toute s\u00e9curit\u00e9. Votre compte reste s\u00e9curis\u00e9.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si vous avez des questions ou besoin d'assistance, veuillez contacter l'\u00e9quipe d'assistance de votre organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Tous droits r\u00e9serv\u00e9s.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Ceci est un message automatis\u00e9. Veuillez ne pas r\u00e9pondre \u00e0 cet e-mail.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Vos liens de connexion

Bonjour,

Vous avez demand\u00e9 l'acc\u00e8s \u00e0 votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Nous avons trouv\u00e9 {{tenantCount}} organisations associ\u00e9es \u00e0 votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}

Vos liens de connexion :
{{tenantLinksText}}

Note de s\u00e9curit\u00e9 : Si vous n'avez pas demand\u00e9 ces liens de connexion, vous pouvez ignorer cet e-mail en toute s\u00e9curit\u00e9.

Si vous avez des questions ou besoin d'assistance, veuillez contacter l'\u00e9quipe d'assistance de votre organisation.

---
\u00a9 {{currentYear}} {{platformName}}. Tous droits r\u00e9serv\u00e9s.
Ceci est un message automatis\u00e9. Veuillez ne pas r\u00e9pondre \u00e0 cet e-mail.`,
  },
  es: {
    subject: '{{platformName}} - Tus enlaces de inicio de sesi\u00f3n',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu direcci\u00f3n de correo electr\u00f3nico.{{else}}Aqu\u00ed est\u00e1 tu enlace de inicio de sesi\u00f3n:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste estos enlaces de inicio de sesi\u00f3n, puedes ignorar este correo de forma segura. Tu cuenta permanece segura.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organizaci\u00f3n.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje autom\u00e1tico. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Tus enlaces de inicio de sesi\u00f3n

Hola,

Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu direcci\u00f3n de correo electr\u00f3nico.{{else}}Aqu\u00ed est\u00e1 tu enlace de inicio de sesi\u00f3n:{{/if}}

Tus enlaces de inicio de sesi\u00f3n:
{{tenantLinksText}}

Nota de seguridad: Si no solicitaste estos enlaces de inicio de sesi\u00f3n, puedes ignorar este correo de forma segura.

Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organizaci\u00f3n.

---
\u00a9 {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje autom\u00e1tico. Por favor no respondas a este correo.`,
  },
  de: {
    subject: '{{platformName}} - Ihre Anmeldelinks',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
              {{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verkn\u00fcpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie diese Anmeldelinks nicht angefordert haben, k\u00f6nnen Sie diese E-Mail sicher ignorieren. Ihr Konto bleibt sicher.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Bei Fragen oder f\u00fcr Unterst\u00fctzung wenden Sie sich bitte an das Support-Team Ihrer Organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Ihre Anmeldelinks

Hallo,

Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
{{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verkn\u00fcpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}

Ihre Anmeldelinks:
{{tenantLinksText}}

Sicherheitshinweis: Wenn Sie diese Anmeldelinks nicht angefordert haben, k\u00f6nnen Sie diese E-Mail sicher ignorieren.

Bei Fragen oder f\u00fcr Unterst\u00fctzung wenden Sie sich bitte an das Support-Team Ihrer Organisation.

---
\u00a9 {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`,
  },
  nl: {
    subject: '{{platformName}} - Uw inloglinks',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
              {{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren. Uw account blijft beveiligd.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Uw inloglinks

Hallo,

U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
{{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}

Uw inloglinks:
{{tenantLinksText}}

Beveiligingsopmerking: Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren.

Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.

---
\u00a9 {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`,
  },
  it: {
    subject: '{{platformName}} - I tuoi link di accesso',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Ciao,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Hai richiesto l'accesso al tuo{{#if isMultiple}}i{{/if}} portale{{#if isMultiple}}i{{/if}} clienti.
              {{#if isMultiple}}Abbiamo trovato {{tenantCount}} organizzazioni associate al tuo indirizzo email.{{else}}Ecco il tuo link di accesso:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota di sicurezza:</strong> Se non hai richiesto questi link di accesso, puoi ignorare questa email in tutta sicurezza. Il tuo account rimane protetto.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Se hai domande o hai bisogno di assistenza, contatta il team di supporto della tua organizzazione.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Tutti i diritti riservati.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Questo \u00e8 un messaggio automatico. Non rispondere a questa email.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - I tuoi link di accesso

Ciao,

Hai richiesto l'accesso al tuo{{#if isMultiple}}i{{/if}} portale{{#if isMultiple}}i{{/if}} clienti.
{{#if isMultiple}}Abbiamo trovato {{tenantCount}} organizzazioni associate al tuo indirizzo email.{{else}}Ecco il tuo link di accesso:{{/if}}

I tuoi link di accesso:
{{tenantLinksText}}

Nota di sicurezza: Se non hai richiesto questi link di accesso, puoi ignorare questa email in tutta sicurezza.

Se hai domande o hai bisogno di assistenza, contatta il team di supporto della tua organizzazione.

---
\u00a9 {{currentYear}} {{platformName}}. Tutti i diritti riservati.
Questo \u00e8 un messaggio automatico. Non rispondere a questa email.`,
  },
  pl: {
    subject: '{{platformName}} - Twoje linki do logowania',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Cze\u015b\u0107,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Poprosi\u0142e\u015b(a\u015b) o dost\u0119p do portalu{{#if isMultiple}}i{{/if}} klienta{{#if isMultiple}}\u00f3w{{/if}}.
              {{#if isMultiple}}Znale\u017ali\u015bmy {{tenantCount}} organizacji powi\u0105zanych z Twoim adresem e-mail.{{else}}Oto Tw\u00f3j link do logowania:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Uwaga dotycz\u0105ca bezpiecze\u0144stwa:</strong> Je\u015bli nie prosi\u0142e\u015b(a\u015b) o te linki do logowania, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107. Twoje konto pozostaje bezpieczne.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Je\u015bli masz pytania lub potrzebujesz pomocy, skontaktuj si\u0119 z zespo\u0142em wsparcia swojej organizacji.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              \u00a9 {{currentYear}} {{platformName}}. Wszelkie prawa zastrze\u017cone.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              To automatyczna wiadomo\u015b\u0107. Nie odpowiadaj na ten e-mail.
            </p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Twoje linki do logowania

Cze\u015b\u0107,

Poprosi\u0142e\u015b(a\u015b) o dost\u0119p do portalu{{#if isMultiple}}i{{/if}} klienta{{#if isMultiple}}\u00f3w{{/if}}.
{{#if isMultiple}}Znale\u017ali\u015bmy {{tenantCount}} organizacji powi\u0105zanych z Twoim adresem e-mail.{{else}}Oto Tw\u00f3j link do logowania:{{/if}}

Twoje linki do logowania:
{{tenantLinksText}}

Uwaga dotycz\u0105ca bezpiecze\u0144stwa: Je\u015bli nie prosi\u0142e\u015b(a\u015b) o te linki do logowania, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107.

Je\u015bli masz pytania lub potrzebujesz pomocy, skontaktuj si\u0119 z zespo\u0142em wsparcia swojej organizacji.

---
\u00a9 {{currentYear}} {{platformName}}. Wszelkie prawa zastrze\u017cone.
To automatyczna wiadomo\u015b\u0107. Nie odpowiadaj na ten e-mail.`,
  },
};
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
