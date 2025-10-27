/**
 * Add Spanish translations for client-facing email templates
 *
 * Translates authentication, ticketing, and billing email templates to Spanish
 * for client portal users.
 */

exports.up = async function(knex) {
  console.log('Adding Spanish email templates...');

  // Get notification subtypes
  const subtypes = await knex('notification_subtypes')
    .select('id', 'name')
    .whereIn('name', [
      'email-verification',
      'password-reset',
      'portal-invitation',
      'tenant-recovery',
      'no-account-found',
      'Ticket Assigned',
      'Ticket Created',
      'Ticket Updated',
      'Ticket Closed',
      'Ticket Comment Added',
      'Invoice Generated',
      'Payment Received',
      'Payment Overdue'
    ]);

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Notification subtype '${name}' not found`);
    }
    return subtype.id;
  };

  // Insert Spanish templates
  await knex('system_email_templates').insert([
    // Authentication templates
    {
      name: 'email-verification',
      language_code: 'es',
      subject: 'Verifica tu correo electrónico{{#if registrationClientName}} para {{registrationClientName}}{{/if}}',
      notification_subtype_id: getSubtypeId('email-verification'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verificación de correo electrónico</h2>
          <p>Hola,</p>
          <p>Por favor verifica tu dirección de correo electrónico haciendo clic en el enlace a continuación:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verificar correo</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Este enlace expirará en {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste este correo, por favor ignóralo.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Verificación de correo electrónico

Por favor verifica tu dirección de correo electrónico visitando:
{{verificationUrl}}

{{#if expirationTime}}Este enlace expirará en {{expirationTime}}.{{/if}}

Si no solicitaste este correo, por favor ignóralo.

© {{currentYear}} {{tenantClientName}}`
    },
    {
      name: 'password-reset',
      language_code: 'es',
      subject: 'Solicitud de restablecimiento de contraseña',
      notification_subtype_id: getSubtypeId('password-reset'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Restablecimiento de contraseña</h2>
          <p>Hola {{userName}},</p>
          <p>Has solicitado restablecer tu contraseña para {{email}}. Haz clic en el enlace a continuación para continuar:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Restablecer contraseña</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{resetLink}}</p>
          <p><small>Este enlace expirará en {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste este restablecimiento, por favor ignora este correo. Tu contraseña permanecerá sin cambios.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">¿Necesitas ayuda? Contacta {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Solicitud de restablecimiento de contraseña

Hola {{userName}},

Has solicitado restablecer tu contraseña para {{email}}. Visita el siguiente enlace:
{{resetLink}}

Este enlace expirará en {{expirationTime}}.

Si no solicitaste este restablecimiento, por favor ignora este correo.
{{#if supportEmail}}¿Necesitas ayuda? Contacta {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'portal-invitation',
      language_code: 'es',
      subject: 'Invitación al portal del cliente - {{clientName}}',
      notification_subtype_id: getSubtypeId('portal-invitation'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Bienvenido a tu portal del cliente</h2>
          <p>Hola {{contactName}},</p>
          <p>Has sido invitado a unirte al portal del cliente de {{clientName}}.</p>
          <p><a href="{{portalLink}}" style="display: inline-block; padding: 10px 20px; background-color: #8A4DEA; color: white; text-decoration: none; border-radius: 5px;">Activar mi acceso</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{portalLink}}</p>
          <p><small>El enlace expirará en {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">¿Necesitas asistencia?</p>
          <p style="color: #666; font-size: 12px;">Email: {{clientLocationEmail}}<br>Teléfono: {{clientLocationPhone}}</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Bienvenido a tu portal del cliente

Hola {{contactName}},

Has sido invitado a unirte al portal del cliente de {{clientName}}.

Activar mi acceso: {{portalLink}}

El enlace expirará en {{expirationTime}}.

¿Necesitas asistencia?
Email: {{clientLocationEmail}}
Teléfono: {{clientLocationPhone}}

© {{currentYear}} {{clientName}}`
    },
    {
      name: 'tenant-recovery',
      language_code: 'es',
      subject: '{{platformName}} - Tus enlaces de inicio de sesión',
      notification_subtype_id: getSubtypeId('tenant-recovery'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura. Tu cuenta permanece segura.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Tus enlaces de inicio de sesión

Hola,

Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}

Tus enlaces de inicio de sesión:
{{tenantLinksText}}

Nota de seguridad: Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura.

Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`
    },
    {
      name: 'no-account-found',
      language_code: 'es',
      subject: '{{platformName}} - Solicitud de acceso',
      notification_subtype_id: getSubtypeId('no-account-found'),
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si no recibiste un correo de inicio de sesión, puede significar:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente</li>
              <li>Tu cuenta puede estar inactiva</li>
              <li>El correo puede haber sido filtrado a tu carpeta de spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>¿Necesitas ayuda?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.
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
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Solicitud de acceso

Hola,

Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.

Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.

Si no recibiste un correo de inicio de sesión, puede significar:
- Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente
- Tu cuenta puede estar inactiva
- El correo puede haber sido filtrado a tu carpeta de spam

¿Necesitas ayuda?
Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.

Nota de seguridad: Si no solicitaste acceso, puedes ignorar este correo de forma segura.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`
    },

    // Ticketing templates
    {
      name: 'ticket-assigned',
      language_code: 'es',
      subject: 'Te han asignado el ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Assigned'),
      html_content: `
        <h2>Ticket asignado</h2>
        <p>Se te ha asignado un ticket:</p>
        <div class="details">
          <p><strong>ID del ticket:</strong> {{ticket.id}}</p>
          <p><strong>Título:</strong> {{ticket.title}}</p>
          <p><strong>Prioridad:</strong> {{ticket.priority}}</p>
          <p><strong>Estado:</strong> {{ticket.status}}</p>
          <p><strong>Asignado por:</strong> {{ticket.assignedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ver el ticket</a>
      `,
      text_content: `
Ticket asignado

Se te ha asignado un ticket:

ID del ticket: {{ticket.id}}
Título: {{ticket.title}}
Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}
Asignado por: {{ticket.assignedBy}}

Ver el ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-created',
      language_code: 'es',
      subject: 'Nuevo ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Created'),
      html_content: `
        <h2>Nuevo ticket creado</h2>
        <p>Se ha creado un nuevo ticket en tu sistema PSA:</p>
        <div class="details">
          <p><strong>ID del ticket:</strong> {{ticket.id}}</p>
          <p><strong>Título:</strong> {{ticket.title}}</p>
          <p><strong>Descripción:</strong> {{ticket.description}}</p>
          <p><strong>Prioridad:</strong> {{ticket.priority}}</p>
          <p><strong>Estado:</strong> {{ticket.status}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ver el ticket</a>
      `,
      text_content: `
Nuevo ticket creado

Se ha creado un nuevo ticket en tu sistema PSA:

ID del ticket: {{ticket.id}}
Título: {{ticket.title}}
Descripción: {{ticket.description}}
Prioridad: {{ticket.priority}}
Estado: {{ticket.status}}

Ver el ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'es',
      subject: 'Ticket actualizado: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Updated'),
      html_content: `
        <h2>Ticket actualizado</h2>
        <p>Se ha actualizado un ticket en tu sistema PSA:</p>
        <div class="details">
          <p><strong>ID del ticket:</strong> {{ticket.id}}</p>
          <p><strong>Título:</strong> {{ticket.title}}</p>
          <p><strong>Cambios:</strong> {{ticket.changes}}</p>
          <p><strong>Actualizado por:</strong> {{ticket.updatedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ver el ticket</a>
      `,
      text_content: `
Ticket actualizado

Se ha actualizado un ticket en tu sistema PSA:

ID del ticket: {{ticket.id}}
Título: {{ticket.title}}
Cambios: {{ticket.changes}}
Actualizado por: {{ticket.updatedBy}}

Ver el ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'es',
      subject: 'Ticket cerrado: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Closed'),
      html_content: `
        <h2>Ticket cerrado</h2>
        <p>Se ha cerrado un ticket en tu sistema PSA:</p>
        <div class="details">
          <p><strong>ID del ticket:</strong> {{ticket.id}}</p>
          <p><strong>Título:</strong> {{ticket.title}}</p>
          <p><strong>Resolución:</strong> {{ticket.resolution}}</p>
          <p><strong>Cerrado por:</strong> {{ticket.closedBy}}</p>
        </div>
        <a href="{{ticket.url}}" class="button">Ver el ticket</a>
      `,
      text_content: `
Ticket cerrado

Se ha cerrado un ticket en tu sistema PSA:

ID del ticket: {{ticket.id}}
Título: {{ticket.title}}
Resolución: {{ticket.resolution}}
Cerrado por: {{ticket.closedBy}}

Ver el ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-comment-added',
      language_code: 'es',
      subject: 'Nuevo comentario en el ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
        <h2>Nuevo comentario agregado</h2>
        <p>Se ha agregado un nuevo comentario al ticket:</p>
        <div class="details">
          <p><strong>ID del ticket:</strong> {{ticket.id}}</p>
          <p><strong>Título:</strong> {{ticket.title}}</p>
          <p><strong>Comentario de:</strong> {{comment.author}}</p>
          <p><strong>Comentario:</strong></p>
          <div class="comment-content">
            {{comment.content}}
          </div>
        </div>
        <a href="{{ticket.url}}" class="button">Ver el ticket</a>
      `,
      text_content: `
Nuevo comentario agregado

Se ha agregado un nuevo comentario al ticket:

ID del ticket: {{ticket.id}}
Título: {{ticket.title}}
Comentario de: {{comment.author}}

Comentario:
{{comment.content}}

Ver el ticket: {{ticket.url}}
      `
    },

    // Billing templates
    {
      name: 'invoice-generated',
      language_code: 'es',
      subject: 'Nueva factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Invoice Generated'),
      html_content: `
        <h2>Factura {{invoice.number}}</h2>
        <p>Se ha generado una nueva factura para tu revisión:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto:</strong> {{invoice.amount}}</p>
          <p><strong>Fecha de vencimiento:</strong> {{invoice.dueDate}}</p>
          <p><strong>Cliente:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Factura {{invoice.number}}

Se ha generado una nueva factura para tu revisión:

Número de factura: {{invoice.number}}
Monto: {{invoice.amount}}
Fecha de vencimiento: {{invoice.dueDate}}
Cliente: {{invoice.clientName}}

Ver la factura: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'es',
      subject: 'Pago recibido: Factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Received'),
      html_content: `
        <h2>Pago recibido</h2>
        <p>Se ha recibido el pago de la factura #{{invoice.number}}:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto pagado:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Fecha de pago:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Método de pago:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Pago recibido

Se ha recibido el pago de la factura #{{invoice.number}}:

Número de factura: {{invoice.number}}
Monto pagado: {{invoice.amountPaid}}
Fecha de pago: {{invoice.paymentDate}}
Método de pago: {{invoice.paymentMethod}}

Ver la factura: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'es',
      subject: 'Pago vencido: Factura #{{invoice.number}}',
      notification_subtype_id: getSubtypeId('Payment Overdue'),
      html_content: `
        <h2>Pago vencido</h2>
        <p>El pago de la factura #{{invoice.number}} está vencido:</p>
        <div class="details">
          <p><strong>Número de factura:</strong> {{invoice.number}}</p>
          <p><strong>Monto adeudado:</strong> {{invoice.amountDue}}</p>
          <p><strong>Fecha de vencimiento:</strong> {{invoice.dueDate}}</p>
          <p><strong>Días de retraso:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">Ver la factura</a>
      `,
      text_content: `
Pago vencido

El pago de la factura #{{invoice.number}} está vencido:

Número de factura: {{invoice.number}}
Monto adeudado: {{invoice.amountDue}}
Fecha de vencimiento: {{invoice.dueDate}}
Días de retraso: {{invoice.daysOverdue}}

Ver la factura: {{invoice.url}}
      `
    }
  ]).onConflict(['name', 'language_code']).merge({
    subject: knex.raw('excluded.subject'),
    html_content: knex.raw('excluded.html_content'),
    text_content: knex.raw('excluded.text_content'),
    notification_subtype_id: knex.raw('excluded.notification_subtype_id')
  });

  console.log('✓ Spanish email templates added (auth + notifications)');
};

exports.down = async function(knex) {
  // Remove Spanish email templates
  await knex('system_email_templates')
    .where({ language_code: 'es' })
    .whereIn('name', [
      'email-verification',
      'password-reset',
      'portal-invitation',
      'tenant-recovery',
      'no-account-found',
      'ticket-assigned',
      'ticket-created',
      'ticket-updated',
      'ticket-closed',
      'ticket-comment-added',
      'invoice-generated',
      'payment-received',
      'payment-overdue'
    ])
    .del();

  console.log('Spanish email templates removed');
};
