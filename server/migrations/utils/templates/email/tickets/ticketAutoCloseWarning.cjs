/**
 * Source-of-truth: ticket-auto-close-warning email template (client-facing).
 *
 * Sent to the ticket's primary contact when an auto-close rule has scheduled
 * the ticket to close after a period of inactivity. Tells the customer when
 * the ticket will close and that any reply keeps it open.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BADGE_BG, BRAND_DARK, BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-auto-close-warning';
const SUBTYPE_NAME = 'Ticket Auto-Close Warning';

const SUBJECTS = {
  en: 'Your ticket will close soon • {{ticket.title}}',
  fr: 'Votre ticket sera bientôt clôturé • {{ticket.title}}',
  es: 'Su ticket se cerrará pronto • {{ticket.title}}',
  de: 'Ihr Ticket wird bald geschlossen • {{ticket.title}}',
  nl: 'Uw ticket wordt binnenkort gesloten • {{ticket.title}}',
  it: 'Il suo ticket verrà chiuso a breve • {{ticket.title}}',
  pl: 'Twoje zgłoszenie zostanie wkrótce zamknięte • {{ticket.title}}',
  pt: 'Seu chamado será encerrado em breve • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Closing Soon',
    intro: 'We have not heard back from you on this ticket. It will be closed automatically on <strong>{{ticket.scheduledCloseDate}}</strong> if there is no new activity.',
    keepOpen: 'If you still need help, simply reply to this email or add a comment to the ticket — that keeps it open.',
    badgePrefix: 'Ticket #',
    closeDate: 'Scheduled to close',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Your ticket will close soon',
    textKeepOpen: 'If you still need help, reply to this email or add a comment to the ticket to keep it open.',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Clôture Imminente du Ticket',
    intro: 'Nous restons sans nouvelles de votre part concernant ce ticket. Il sera clôturé automatiquement le <strong>{{ticket.scheduledCloseDate}}</strong> en l\'absence de nouvelle activité.',
    keepOpen: 'Si vous avez encore besoin d\'aide, répondez simplement à cet e-mail ou ajoutez un commentaire au ticket — il restera alors ouvert.',
    badgePrefix: 'Ticket #',
    closeDate: 'Clôture prévue le',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Votre ticket sera bientôt clôturé',
    textKeepOpen: 'Si vous avez encore besoin d\'aide, répondez à cet e-mail ou ajoutez un commentaire au ticket pour le garder ouvert.',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Cierre Próximo del Ticket',
    intro: 'No hemos recibido respuesta suya sobre este ticket. Se cerrará automáticamente el <strong>{{ticket.scheduledCloseDate}}</strong> si no hay nueva actividad.',
    keepOpen: 'Si todavía necesita ayuda, simplemente responda a este correo o añada un comentario al ticket — eso lo mantiene abierto.',
    badgePrefix: 'Ticket #',
    closeDate: 'Cierre programado',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Su ticket se cerrará pronto',
    textKeepOpen: 'Si todavía necesita ayuda, responda a este correo o añada un comentario al ticket para mantenerlo abierto.',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Wird Bald Geschlossen',
    intro: 'Wir haben zu diesem Ticket keine Rückmeldung von Ihnen erhalten. Es wird am <strong>{{ticket.scheduledCloseDate}}</strong> automatisch geschlossen, sofern keine neue Aktivität erfolgt.',
    keepOpen: 'Wenn Sie weiterhin Hilfe benötigen, antworten Sie einfach auf diese E-Mail oder fügen Sie dem Ticket einen Kommentar hinzu — dann bleibt es offen.',
    badgePrefix: 'Ticket #',
    closeDate: 'Geplante Schließung',
    viewButton: 'Ticket Ansehen',
    footer: 'Powered by Alga PSA &middot; Teams im Einklang halten',
    textHeader: 'Ihr Ticket wird bald geschlossen',
    textKeepOpen: 'Wenn Sie weiterhin Hilfe benötigen, antworten Sie auf diese E-Mail oder fügen Sie dem Ticket einen Kommentar hinzu, damit es offen bleibt.',
    textView: 'Ticket ansehen',
  },
  nl: {
    headerLabel: 'Ticket Sluit Binnenkort',
    intro: 'We hebben geen reactie van u ontvangen op dit ticket. Het wordt automatisch gesloten op <strong>{{ticket.scheduledCloseDate}}</strong> als er geen nieuwe activiteit is.',
    keepOpen: 'Heeft u nog hulp nodig? Beantwoord dan deze e-mail of voeg een reactie toe aan het ticket — dan blijft het open.',
    badgePrefix: 'Ticket #',
    closeDate: 'Geplande sluiting',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Uw ticket wordt binnenkort gesloten',
    textKeepOpen: 'Heeft u nog hulp nodig? Beantwoord deze e-mail of voeg een reactie toe aan het ticket om het open te houden.',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Chiusura Imminente del Ticket',
    intro: 'Non abbiamo ricevuto una sua risposta su questo ticket. Verrà chiuso automaticamente il <strong>{{ticket.scheduledCloseDate}}</strong> in assenza di nuova attività.',
    keepOpen: 'Se ha ancora bisogno di aiuto, risponda semplicemente a questa email o aggiunga un commento al ticket — così rimarrà aperto.',
    badgePrefix: 'Ticket #',
    closeDate: 'Chiusura programmata',
    viewButton: 'Vedi Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Il suo ticket verrà chiuso a breve',
    textKeepOpen: 'Se ha ancora bisogno di aiuto, risponda a questa email o aggiunga un commento al ticket per tenerlo aperto.',
    textView: 'Vedi ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie Wkrótce Zostanie Zamknięte',
    intro: 'Nie otrzymaliśmy od Ciebie odpowiedzi w sprawie tego zgłoszenia. Zostanie ono automatycznie zamknięte <strong>{{ticket.scheduledCloseDate}}</strong>, jeśli nie pojawi się nowa aktywność.',
    keepOpen: 'Jeśli nadal potrzebujesz pomocy, po prostu odpowiedz na tę wiadomość lub dodaj komentarz do zgłoszenia — wtedy pozostanie ono otwarte.',
    badgePrefix: 'Zgłoszenie #',
    closeDate: 'Planowane zamknięcie',
    viewButton: 'Zobacz Zgłoszenie',
    footer: 'Powered by Alga PSA &middot; Zespoły zawsze zgrane',
    textHeader: 'Twoje zgłoszenie zostanie wkrótce zamknięte',
    textKeepOpen: 'Jeśli nadal potrzebujesz pomocy, odpowiedz na tę wiadomość lub dodaj komentarz do zgłoszenia, aby pozostało otwarte.',
    textView: 'Zobacz zgłoszenie',
  },
  pt: {
    headerLabel: 'Chamado Será Encerrado em Breve',
    intro: 'Não recebemos retorno seu neste chamado. Ele será encerrado automaticamente em <strong>{{ticket.scheduledCloseDate}}</strong> se não houver nova atividade.',
    keepOpen: 'Se você ainda precisa de ajuda, basta responder a este email ou adicionar um comentário ao chamado — isso o mantém aberto.',
    badgePrefix: 'Chamado #',
    closeDate: 'Programado para encerramento',
    viewButton: 'Ver chamado',
    footer: 'Powered by Alga PSA &middot; Mantendo as equipes alinhadas',
    textHeader: 'Seu chamado será encerrado em breve',
    textKeepOpen: 'Se você ainda precisa de ajuda, responda a este email ou adicione um comentário ao chamado para mantê-lo aberto.',
    textView: 'Ver chamado',
  },
};

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">${c.badgePrefix}{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;width:200px;font-weight:600;color:#475467;">${c.closeDate}</td>
                    <td style="padding:12px 0;">{{ticket.scheduledCloseDate}}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 24px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.keepOpen}</p>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}

${c.closeDate}: {{ticket.scheduledCloseDate}}

${c.textKeepOpen}

${c.textView}: {{ticket.url}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: SUBJECTS[lang],
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        headerTitle: '{{ticket.title}}',
        headerMeta: '{{ticket.metaLine}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
