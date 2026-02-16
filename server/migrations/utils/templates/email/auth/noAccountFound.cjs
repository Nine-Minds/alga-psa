/**
 * Source-of-truth: no-account-found email template.
 *
 * Auth templates manage their own full HTML (no shared emailLayout wrapper).
 * All languages use simple inline-style HTML. The structure is consistent
 * across languages with per-language translated text.
 */

const TEMPLATE_NAME = 'no-account-found';
const SUBTYPE_NAME = 'no-account-found';

/* eslint-disable max-len */

/* ------------------------------------------------------------------ */
/*  Per-language HTML and text templates                              */
/* ------------------------------------------------------------------ */
const LANGS = {
  en: {
    subject: '{{platformName}} - Access Request',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hello,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              We received a request to access the client portal using this email address.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              If you have an account with us, you should have received a separate email with your login links.
              If you didn't receive a login email, it may mean:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>This email address is not associated with any client portal accounts</li>
              <li>Your account may be inactive</li>
              <li>The email may have been filtered to your spam folder</li>
            </ul>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Need Help?</strong> If you believe you should have access to a client portal, please contact your service provider's support team for assistance.
              </p>
            </div>

            <div style="background-color: #fef3c7; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #92400e; font-size: 14px; margin: 0;">
                <strong>Security Note:</strong> If you didn't request access, you can safely ignore this email.
              </p>
            </div>
          </div>
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">\u00a9 {{currentYear}} {{platformName}}. All rights reserved.</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `,
    text: `{{platformName}} - Access Request

Hello,

We received a request to access the client portal using this email address.

If you have an account with us, you should have received a separate email with your login links.
If you didn't receive a login email, it may mean:

- This email address is not associated with any client portal accounts
- Your account may be inactive
- The email may have been filtered to your spam folder

Need Help? If you believe you should have access to a client portal, please contact your service provider's support team for assistance.

Security Note: If you didn't request access, you can safely ignore this email.

---
\u00a9 {{currentYear}} {{platformName}}. All rights reserved.
This is an automated message. Please do not reply to this email.`,
  },
  fr: {
    subject: '{{platformName}} - Demande d\'acc\u00e8s',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Nous avons re\u00e7u une demande d\u2019acc\u00e8s au portail client utilisant cette adresse e-mail.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si vous avez un compte chez nous, vous devriez avoir re\u00e7u un e-mail s\u00e9par\u00e9 avec vos liens de connexion.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si vous n\u2019avez pas re\u00e7u d\u2019e-mail de connexion, cela peut signifier :
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Cette adresse e-mail n\u2019est associ\u00e9e \u00e0 aucun compte de portail client</li>
              <li>Votre compte peut \u00eatre inactif</li>
              <li>L\u2019e-mail peut avoir \u00e9t\u00e9 filtr\u00e9 vers votre dossier spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Besoin d\u2019aide ?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si vous pensez que vous devriez avoir acc\u00e8s \u00e0 un portail client, veuillez contacter l\u2019\u00e9quipe d\u2019assistance de votre fournisseur de services pour obtenir de l\u2019aide.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de s\u00e9curit\u00e9 :</strong> Si vous n\u2019avez pas demand\u00e9 d\u2019acc\u00e8s, vous pouvez ignorer cet e-mail en toute s\u00e9curit\u00e9.
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
    text: `{{platformName}} - Demande d'acc\u00e8s

Bonjour,

Nous avons re\u00e7u une demande d\u2019acc\u00e8s au portail client utilisant cette adresse e-mail.

Si vous avez un compte chez nous, vous devriez avoir re\u00e7u un e-mail s\u00e9par\u00e9 avec vos liens de connexion.

Si vous n\u2019avez pas re\u00e7u d\u2019e-mail de connexion, cela peut signifier :
- Cette adresse e-mail n\u2019est associ\u00e9e \u00e0 aucun compte de portail client
- Votre compte peut \u00eatre inactif
- L\u2019e-mail peut avoir \u00e9t\u00e9 filtr\u00e9 vers votre dossier spam

Besoin d\u2019aide ?
Si vous pensez que vous devriez avoir acc\u00e8s \u00e0 un portail client, veuillez contacter l\u2019\u00e9quipe d\u2019assistance de votre fournisseur de services pour obtenir de l\u2019aide.

Note de s\u00e9curit\u00e9 : Si vous n\u2019avez pas demand\u00e9 d\u2019acc\u00e8s, vous pouvez ignorer cet e-mail en toute s\u00e9curit\u00e9.

---
\u00a9 {{currentYear}} {{platformName}}. Tous droits r\u00e9serv\u00e9s.
Ceci est un message automatis\u00e9. Veuillez ne pas r\u00e9pondre \u00e0 cet e-mail.`,
  },
  es: {
    subject: '{{platformName}} - Solicitud de acceso',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Recibimos una solicitud para acceder al portal del cliente usando esta direcci\u00f3n de correo electr\u00f3nico.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si tienes una cuenta con nosotros, deber\u00edas haber recibido un correo separado con tus enlaces de inicio de sesi\u00f3n.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si no recibiste un correo de inicio de sesi\u00f3n, puede significar:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Esta direcci\u00f3n de correo electr\u00f3nico no est\u00e1 asociada con ninguna cuenta del portal del cliente</li>
              <li>Tu cuenta puede estar inactiva</li>
              <li>El correo puede haber sido filtrado a tu carpeta de spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>\u00bfNecesitas ayuda?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si crees que deber\u00edas tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste acceso, puedes ignorar este correo de forma segura.
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
    text: `{{platformName}} - Solicitud de acceso

Hola,

Recibimos una solicitud para acceder al portal del cliente usando esta direcci\u00f3n de correo electr\u00f3nico.

Si tienes una cuenta con nosotros, deber\u00edas haber recibido un correo separado con tus enlaces de inicio de sesi\u00f3n.

Si no recibiste un correo de inicio de sesi\u00f3n, puede significar:
- Esta direcci\u00f3n de correo electr\u00f3nico no est\u00e1 asociada con ninguna cuenta del portal del cliente
- Tu cuenta puede estar inactiva
- El correo puede haber sido filtrado a tu carpeta de spam

\u00bfNecesitas ayuda?
Si crees que deber\u00edas tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.

Nota de seguridad: Si no solicitaste acceso, puedes ignorar este correo de forma segura.

---
\u00a9 {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje autom\u00e1tico. Por favor no respondas a este correo.`,
  },
  de: {
    subject: '{{platformName}} - Zugriffsanfrage',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Wir haben eine Anfrage f\u00fcr den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Wenn Sie keine Anmelde-E-Mail erhalten haben, k\u00f6nnte dies bedeuten:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verkn\u00fcpft</li>
              <li>Ihr Konto k\u00f6nnte inaktiv sein</li>
              <li>Die E-Mail k\u00f6nnte in Ihrem Spam-Ordner gefiltert worden sein</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Ben\u00f6tigen Sie Hilfe?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie keinen Zugriff angefordert haben, k\u00f6nnen Sie diese E-Mail sicher ignorieren.
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
    text: `{{platformName}} - Zugriffsanfrage

Hallo,

Wir haben eine Anfrage f\u00fcr den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.

Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.

Wenn Sie keine Anmelde-E-Mail erhalten haben, k\u00f6nnte dies bedeuten:
- Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verkn\u00fcpft
- Ihr Konto k\u00f6nnte inaktiv sein
- Die E-Mail k\u00f6nnte in Ihrem Spam-Ordner gefiltert worden sein

Ben\u00f6tigen Sie Hilfe?
Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.

Sicherheitshinweis: Wenn Sie keinen Zugriff angefordert haben, k\u00f6nnen Sie diese E-Mail sicher ignorieren.

---
\u00a9 {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`,
  },
  nl: {
    subject: '{{platformName}} - Toegangsverzoek',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Dit e-mailadres is niet gekoppeld aan een klantenportalaccount</li>
              <li>Uw account kan inactief zijn</li>
              <li>De e-mail kan zijn gefilterd naar uw spam-map</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Hulp nodig?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.
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
    text: `{{platformName}} - Toegangsverzoek

Hallo,

We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.

Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.

Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
- Dit e-mailadres is niet gekoppeld aan een klantenportalaccount
- Uw account kan inactief zijn
- De e-mail kan zijn gefilterd naar uw spam-map

Hulp nodig?
Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.

Beveiligingsopmerking: Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.

---
\u00a9 {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`,
  },
  it: {
    subject: '{{platformName}} - Richiesta di accesso',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg,#8A4DEA,#40CFF9); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Ciao,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Abbiamo ricevuto una richiesta di accesso al portale clienti utilizzando questo indirizzo email.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Se hai un account con noi, dovresti aver ricevuto un'email separata con i tuoi link di accesso.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Se non hai ricevuto l'email di accesso, potrebbe significare:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Questo indirizzo email non \u00e8 associato a un account del portale clienti</li>
              <li>Il tuo account potrebbe essere inattivo</li>
              <li>L'email potrebbe essere stata filtrata nella cartella spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Hai bisogno di aiuto?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Se ritieni di dover avere accesso a un portale clienti, contatta il team di supporto del tuo provider di servizi per assistenza.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota di sicurezza:</strong> Se non hai richiesto l'accesso, puoi ignorare questa email in tutta sicurezza.
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
    text: `{{platformName}} - Richiesta di accesso

Ciao,

Abbiamo ricevuto una richiesta di accesso al portale clienti utilizzando questo indirizzo email.

Se hai un account con noi, dovresti aver ricevuto un'email separata con i tuoi link di accesso.

Se non hai ricevuto l'email di accesso, potrebbe significare:
- Questo indirizzo email non \u00e8 associato a un account del portale clienti
- Il tuo account potrebbe essere inattivo
- L'email potrebbe essere stata filtrata nella cartella spam

Hai bisogno di aiuto?
Se ritieni di dover avere accesso a un portale clienti, contatta il team di supporto del tuo provider di servizi per assistenza.

Nota di sicurezza: Se non hai richiesto l'accesso, puoi ignorare questa email in tutta sicurezza.

---
\u00a9 {{currentYear}} {{platformName}}. Tutti i diritti riservati.
Questo \u00e8 un messaggio automatico. Non rispondere a questa email.`,
  },
  pl: {
    subject: '{{platformName}} - Pro\u015bba o dost\u0119p',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Cze\u015b\u0107,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Otrzymali\u015bmy pro\u015bb\u0119 o dost\u0119p do portalu klienta z u\u017cyciem tego adresu e-mail.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Je\u015bli masz u nas konto, powiniene\u015b/powinna\u015b otrzyma\u0107 osobny e-mail z linkami do logowania.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Je\u015bli nie otrzyma\u0142e\u015b(a\u015b) e-maila z logowaniem, mo\u017ce to oznacza\u0107:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Ten adres e-mail nie jest powi\u0105zany z \u017cadnym kontem portalu klienta</li>
              <li>Twoje konto mo\u017ce by\u0107 nieaktywne</li>
              <li>Wiadomo\u015b\u0107 mog\u0142a trafi\u0107 do folderu spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Potrzebujesz pomocy?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Je\u015bli uwa\u017casz, \u017ce powiniene\u015b/powinna\u015b mie\u0107 dost\u0119p do portalu klienta, skontaktuj si\u0119 z zespo\u0142em wsparcia swojego dostawcy us\u0142ug.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Uwaga dotycz\u0105ca bezpiecze\u0144stwa:</strong> Je\u015bli nie prosi\u0142e\u015b(a\u015b) o dost\u0119p, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107.
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
    text: `{{platformName}} - Pro\u015bba o dost\u0119p

Cze\u015b\u0107,

Otrzymali\u015bmy pro\u015bb\u0119 o dost\u0119p do portalu klienta z u\u017cyciem tego adresu e-mail.

Je\u015bli masz u nas konto, powiniene\u015b/powinna\u015b otrzyma\u0107 osobny e-mail z linkami do logowania.

Je\u015bli nie otrzyma\u0142e\u015b(a\u015b) e-maila z logowaniem, mo\u017ce to oznacza\u0107:
- Ten adres e-mail nie jest powi\u0105zany z \u017cadnym kontem portalu klienta
- Twoje konto mo\u017ce by\u0107 nieaktywne
- Wiadomo\u015b\u0107 mog\u0142a trafi\u0107 do folderu spam

Potrzebujesz pomocy?
Je\u015bli uwa\u017casz, \u017ce powiniene\u015b/powinna\u015b mie\u0107 dost\u0119p do portalu klienta, skontaktuj si\u0119 z zespo\u0142em wsparcia swojego dostawcy us\u0142ug.

Uwaga dotycz\u0105ca bezpiecze\u0144stwa: Je\u015bli nie prosi\u0142e\u015b(a\u015b) o dost\u0119p, mo\u017cesz bezpiecznie zignorowa\u0107 t\u0119 wiadomo\u015b\u0107.

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
