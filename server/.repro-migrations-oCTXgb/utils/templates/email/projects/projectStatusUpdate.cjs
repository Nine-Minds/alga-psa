const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, BRAND_DARK, INFO_BOX_BG, INFO_BOX_BORDER } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-status-update';
const SUBTYPE_NAME = 'Project Status Update';

/* eslint-disable max-len */
const COPY = {
  en: { subject: 'Project update: {{project.name}}', label: 'Project Status Update', intro: 'Here is the latest status for your project.', progress: 'Overall progress', tasks: 'Tasks completed', hours: 'Hours used', recent: 'Recently completed', message: 'A note from your team', button: 'View project', footer: 'Powered by AlgaPSA' },
  fr: { subject: 'Point sur le projet : {{project.name}}', label: 'Point d’avancement du projet', intro: 'Voici le dernier état d’avancement de votre projet.', progress: 'Avancement global', tasks: 'Tâches terminées', hours: 'Heures utilisées', recent: 'Terminé récemment', message: 'Un mot de votre équipe', button: 'Voir le projet', footer: 'Propulsé par AlgaPSA' },
  es: { subject: 'Actualización del proyecto: {{project.name}}', label: 'Actualización del estado del proyecto', intro: 'Este es el último estado de su proyecto.', progress: 'Avance general', tasks: 'Tareas completadas', hours: 'Horas utilizadas', recent: 'Completado recientemente', message: 'Una nota de su equipo', button: 'Ver proyecto', footer: 'Desarrollado por AlgaPSA' },
  de: { subject: 'Projekt-Update: {{project.name}}', label: 'Projektstatus-Update', intro: 'Hier ist der aktuelle Stand Ihres Projekts.', progress: 'Gesamtfortschritt', tasks: 'Erledigte Aufgaben', hours: 'Verbrauchte Stunden', recent: 'Kürzlich abgeschlossen', message: 'Eine Nachricht Ihres Teams', button: 'Projekt ansehen', footer: 'Bereitgestellt von AlgaPSA' },
  nl: { subject: 'Projectupdate: {{project.name}}', label: 'Projectstatusupdate', intro: 'Dit is de laatste status van uw project.', progress: 'Totale voortgang', tasks: 'Afgeronde taken', hours: 'Gebruikte uren', recent: 'Onlangs afgerond', message: 'Een bericht van uw team', button: 'Project bekijken', footer: 'Mogelijk gemaakt door AlgaPSA' },
  it: { subject: 'Aggiornamento del progetto: {{project.name}}', label: 'Aggiornamento sullo stato del progetto', intro: 'Ecco lo stato più recente del tuo progetto.', progress: 'Avanzamento complessivo', tasks: 'Attività completate', hours: 'Ore utilizzate', recent: 'Completato di recente', message: 'Un messaggio dal tuo team', button: 'Vedi progetto', footer: 'Powered by AlgaPSA' },
  pl: { subject: 'Aktualizacja projektu: {{project.name}}', label: 'Aktualizacja statusu projektu', intro: 'Oto najnowszy status Twojego projektu.', progress: 'Ogólny postęp', tasks: 'Ukończone zadania', hours: 'Wykorzystane godziny', recent: 'Ostatnio ukończone', message: 'Wiadomość od zespołu', button: 'Zobacz projekt', footer: 'Powered by AlgaPSA' },
  pt: { subject: 'Atualização do projeto: {{project.name}}', label: 'Atualização de status do projeto', intro: 'Este é o status mais recente do seu projeto.', progress: 'Progresso geral', tasks: 'Tarefas concluídas', hours: 'Horas utilizadas', recent: 'Concluído recentemente', message: 'Um recado da sua equipe', button: 'Ver projeto', footer: 'Desenvolvido por AlgaPSA' },
};
/* eslint-enable max-len */

// `hours` is only rendered when the project's client-portal config exposes
// budget hours, so an internal-only budget never leaks through the email.
function body(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;width:180px;font-weight:600;color:#475467;">${c.progress}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{progress.percent}}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.tasks}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{progress.tasks}}</td></tr>
      {{#if hours.visible}}
      <tr><td style="padding:10px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.hours}</td><td style="padding:10px 0;border-bottom:1px solid #eef2ff;">{{hours.used}}</td></tr>
      {{/if}}
    </table>
    {{#if recent.items}}
    <div style="margin-top:24px;">
      <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.recent}</div>
      <ul style="margin:0;padding-left:20px;color:#475467;line-height:1.6;">
        {{#each recent.items}}
        <li>{{this.name}}{{#if this.completedOn}} — {{this.completedOn}}{{/if}}</li>
        {{/each}}
      </ul>
    </div>
    {{/if}}
    {{#if customMessage}}
    <div style="margin:24px 0 0 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
      <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.message}</div>
      <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
    </div>
    {{/if}}
    <div style="margin-top:24px;"><a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.button}</a></div>`;
}

function text(c) {
  return `${c.label}

${c.intro}

${c.progress}: {{progress.percent}}
${c.tasks}: {{progress.tasks}}
{{#if hours.visible}}${c.hours}: {{hours.used}}{{/if}}

{{#if recent.items}}${c.recent}:
{{#each recent.items}}- {{this.name}}{{#if this.completedOn}} — {{this.completedOn}}{{/if}}
{{/each}}{{/if}}

{{#if customMessage}}${c.message}:
{{customMessage}}{{/if}}

${c.button}: {{project.url}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([language, c]) => ({
      language,
      subject: c.subject,
      htmlContent: wrapEmailLayout({ language, headerLabel: c.label, headerTitle: '{{project.name}}', headerMeta: '{{project.number}}', bodyHtml: body(c), footerText: c.footer }),
      textContent: text(c),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
