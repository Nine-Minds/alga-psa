/**
 * Source of truth: project-related internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'project-assigned',
    subtypeName: 'project-assigned',
    translations: {
      en: { title: 'Project Assigned', message: 'Project "{{projectName}}" has been assigned to you' },
      fr: { title: 'Projet attribué', message: 'Le projet "{{projectName}}" vous a été attribué' },
      es: { title: 'Proyecto asignado', message: 'El proyecto "{{projectName}}" se le ha asignado' },
      de: { title: 'Projekt zugewiesen', message: 'Projekt "{{projectName}}" wurde Ihnen zugewiesen' },
      nl: { title: 'Project toegewezen', message: 'Project "{{projectName}}" is aan u toegewezen' },
      it: { title: 'Progetto assegnato', message: 'Il progetto "{{projectName}}" le è stato assegnato' },
      pl: { title: 'Projekt przypisany', message: 'Projekt "{{projectName}}" został do Ciebie przypisany' },
    },
  },
  {
    templateName: 'project-created',
    subtypeName: 'project-created',
    translations: {
      en: { title: 'New Project Created', message: 'Project "{{projectName}}" was created for {{clientName}}' },
      fr: { title: 'Nouveau projet créé', message: 'Le projet "{{projectName}}" a été créé pour {{clientName}}' },
      es: { title: 'Nuevo proyecto creado', message: 'El proyecto "{{projectName}}" se creó para {{clientName}}' },
      de: { title: 'Neues Projekt erstellt', message: 'Projekt "{{projectName}}" wurde für {{clientName}} erstellt' },
      nl: { title: 'Nieuw project aangemaakt', message: 'Project "{{projectName}}" is aangemaakt voor {{clientName}}' },
      it: { title: 'Nuovo progetto creato', message: 'Il progetto "{{projectName}}" è stato creato per {{clientName}}' },
      pl: { title: 'Nowy projekt utworzony', message: 'Projekt "{{projectName}}" został utworzony dla {{clientName}}' },
    },
  },
  {
    templateName: 'task-assigned',
    subtypeName: 'task-assigned',
    translations: {
      en: { title: 'Task Assigned', message: 'Task "{{taskName}}" in project "{{projectName}}" has been assigned to you' },
      fr: { title: 'Tâche attribuée', message: 'La tâche "{{taskName}}" du projet "{{projectName}}" vous a été attribuée' },
      es: { title: 'Tarea asignada', message: 'La tarea "{{taskName}}" del proyecto "{{projectName}}" se le ha asignado' },
      de: { title: 'Aufgabe zugewiesen', message: 'Die Aufgabe "{{taskName}}" im Projekt "{{projectName}}" wurde Ihnen zugewiesen' },
      nl: { title: 'Taak toegewezen', message: 'De taak "{{taskName}}" in project "{{projectName}}" is aan u toegewezen' },
      it: { title: 'Attività assegnata', message: "L'attività \"{{taskName}}\" del progetto \"{{projectName}}\" le è stata assegnata" },
      pl: { title: 'Zadanie przypisane', message: 'Zadanie "{{taskName}}" w projekcie "{{projectName}}" zostało do Ciebie przypisane' },
    },
  },
  {
    templateName: 'task-comment-added',
    subtypeName: 'task-comment-added',
    translations: {
      en: { title: 'New Task Comment', message: '{{authorName}} added a comment to task "{{taskName}}"' },
      pl: { title: 'Nowy komentarz do zadania', message: '{{authorName}} dodał(a) komentarz do zadania "{{taskName}}"' },
    },
  },
  {
    templateName: 'milestone-completed',
    subtypeName: 'milestone-completed',
    translations: {
      en: { title: 'Milestone Completed', message: 'Milestone "{{milestoneName}}" in project "{{projectName}}" has been completed' },
      fr: { title: 'Jalon terminé', message: 'Le jalon "{{milestoneName}}" du projet "{{projectName}}" est terminé' },
      es: { title: 'Hito completado', message: 'El hito "{{milestoneName}}" del proyecto "{{projectName}}" se ha completado' },
      de: { title: 'Meilenstein abgeschlossen', message: 'Der Meilenstein "{{milestoneName}}" im Projekt "{{projectName}}" wurde abgeschlossen' },
      nl: { title: 'Mijlpaal voltooid', message: 'De mijlpaal "{{milestoneName}}" in project "{{projectName}}" is voltooid' },
      it: { title: 'Traguardo completato', message: 'La milestone "{{milestoneName}}" del progetto "{{projectName}}" è stata completata' },
      pl: { title: 'Kamień milowy ukończony', message: 'Kamień milowy "{{milestoneName}}" w projekcie "{{projectName}}" został ukończony' },
    },
  },
  {
    templateName: 'task-additional-agent-assigned',
    subtypeName: 'task-additional-agent-assigned',
    translations: {
      en: { title: 'Added as Additional Agent', message: 'You have been added as an additional agent on task "{{taskName}}" in project "{{projectName}}"' },
      fr: { title: 'Ajouté comme agent supplémentaire', message: 'Vous avez été ajouté comme agent supplémentaire sur la tâche "{{taskName}}" dans le projet "{{projectName}}"' },
      es: { title: 'Agregado como agente adicional', message: 'Ha sido agregado como agente adicional en la tarea "{{taskName}}" del proyecto "{{projectName}}"' },
      de: { title: 'Als zusätzlicher Agent hinzugefügt', message: 'Sie wurden als zusätzlicher Agent zur Aufgabe "{{taskName}}" im Projekt "{{projectName}}" hinzugefügt' },
      nl: { title: 'Toegevoegd als extra agent', message: 'U bent toegevoegd als extra agent aan taak "{{taskName}}" in project "{{projectName}}"' },
      it: { title: 'Aggiunto come agente aggiuntivo', message: 'Sei stato aggiunto come agente aggiuntivo al task "{{taskName}}" nel progetto "{{projectName}}"' },
      pl: { title: 'Dodano jako dodatkowego agenta', message: 'Zostałeś(aś) dodany(a) jako dodatkowy agent do zadania "{{taskName}}" w projekcie "{{projectName}}"' },
    },
  },
  {
    templateName: 'task-additional-agent-added',
    subtypeName: 'task-additional-agent-added',
    translations: {
      en: { title: 'Additional Agent Added', message: '{{additionalAgentName}} has been added as an additional agent on your task "{{taskName}}" in project "{{projectName}}"' },
      fr: { title: 'Agent supplémentaire ajouté', message: '{{additionalAgentName}} a été ajouté comme agent supplémentaire sur votre tâche "{{taskName}}" dans le projet "{{projectName}}"' },
      es: { title: 'Agente adicional agregado', message: '{{additionalAgentName}} ha sido agregado como agente adicional en su tarea "{{taskName}}" del proyecto "{{projectName}}"' },
      de: { title: 'Zusätzlicher Agent hinzugefügt', message: '{{additionalAgentName}} wurde als zusätzlicher Agent zu Ihrer Aufgabe "{{taskName}}" im Projekt "{{projectName}}" hinzugefügt' },
      nl: { title: 'Extra agent toegevoegd', message: '{{additionalAgentName}} is toegevoegd als extra agent aan uw taak "{{taskName}}" in project "{{projectName}}"' },
      it: { title: 'Agente aggiuntivo aggiunto', message: '{{additionalAgentName}} è stato aggiunto come agente aggiuntivo al suo task "{{taskName}}" nel progetto "{{projectName}}"' },
      pl: { title: 'Dodano dodatkowego agenta', message: '{{additionalAgentName}} został(a) dodany(a) jako dodatkowy agent do Twojego zadania "{{taskName}}" w projekcie "{{projectName}}"' },
    },
  },
];

module.exports = { TEMPLATES };
