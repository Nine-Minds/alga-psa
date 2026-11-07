const { wrapEmailLayout } = require('./emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
  SUPPORTED_LANGUAGES,
} = require('./constants.cjs');

// Translated copy is embedded here, mirroring the email.ticketClosed block of
// each language's email.json in the server locale catalog. Migration and seed
// runners must stay self-contained: the setup image ships server/migrations
// without the static web assets, so builders cannot read locale JSON at
// migration time.
// server/src/test/unit/notifications/ticketClosedAudienceTemplates.test.ts
// fails if this copy drifts from the locale files.
const COPY = {
  en: {
    title: "Ticket Closed",
    subject: "Ticket Closed • {{ticket.title}}",
    intro: "A ticket for {{ticket.clientName}} has been resolved and closed. Review the resolution details below.",
    ticketNumber: "Ticket #",
    status: "Status",
    closed: "Closed",
    closedBy: "Closed By",
    assignedTo: "Assigned To",
    requester: "Requester",
    category: "Category",
    location: "Location",
    totalTimeWorked: "Total Time Worked",
    totalBillableTime: "Total Billable Time",
    remainingHours: "Remaining Hours",
    devices: "Devices",
    deviceName: "Name",
    deviceType: "Type",
    manufacturerModel: "Manufacturer / Model",
    serialNumber: "Serial #",
    timeEntries: "Time Entries",
    materials: "Materials",
    materialsTotal: "Materials Total",
    resolution: "Resolution",
    footer: "Powered by AlgaPSA",
  },
  fr: {
    title: "Ticket fermé",
    subject: "Ticket fermé • {{ticket.title}}",
    intro: "Un ticket pour {{ticket.clientName}} a été résolu et fermé. Consultez les détails de la résolution ci-dessous.",
    ticketNumber: "Ticket n°",
    status: "Statut",
    closed: "Fermé",
    closedBy: "Fermé par",
    assignedTo: "Assigné à",
    requester: "Demandeur",
    category: "Catégorie",
    location: "Emplacement",
    totalTimeWorked: "Temps total travaillé",
    totalBillableTime: "Temps total facturable",
    remainingHours: "Heures restantes",
    devices: "Appareils",
    deviceName: "Nom",
    deviceType: "Type",
    manufacturerModel: "Fabricant / Modèle",
    serialNumber: "N° de série",
    timeEntries: "Saisies de temps",
    materials: "Matériaux",
    materialsTotal: "Total des matériaux",
    resolution: "Résolution",
    footer: "Propulsé par AlgaPSA",
  },
  es: {
    title: "Ticket cerrado",
    subject: "Ticket cerrado • {{ticket.title}}",
    intro: "Se ha resuelto y cerrado un ticket para {{ticket.clientName}}. Consulta los detalles de la resolución a continuación.",
    ticketNumber: "Ticket n.º",
    status: "Estado",
    closed: "Cerrado",
    closedBy: "Cerrado por",
    assignedTo: "Asignado a",
    requester: "Solicitante",
    category: "Categoría",
    location: "Ubicación",
    totalTimeWorked: "Tiempo total trabajado",
    totalBillableTime: "Tiempo total facturable",
    remainingHours: "Horas restantes",
    devices: "Dispositivos",
    deviceName: "Nombre",
    deviceType: "Tipo",
    manufacturerModel: "Fabricante / Modelo",
    serialNumber: "N.º de serie",
    timeEntries: "Registros de tiempo",
    materials: "Materiales",
    materialsTotal: "Total de materiales",
    resolution: "Resolución",
    footer: "Desarrollado por AlgaPSA",
  },
  de: {
    title: "Ticket geschlossen",
    subject: "Ticket geschlossen • {{ticket.title}}",
    intro: "Ein Ticket für {{ticket.clientName}} wurde gelöst und geschlossen. Die Details zur Lösung finden Sie unten.",
    ticketNumber: "Ticket-Nr. ",
    status: "Status",
    closed: "Geschlossen",
    closedBy: "Geschlossen von",
    assignedTo: "Zugewiesen an",
    requester: "Anforderer",
    category: "Kategorie",
    location: "Standort",
    totalTimeWorked: "Gesamte Arbeitszeit",
    totalBillableTime: "Gesamte abrechenbare Zeit",
    remainingHours: "Verbleibende Stunden",
    devices: "Geräte",
    deviceName: "Name",
    deviceType: "Typ",
    manufacturerModel: "Hersteller / Modell",
    serialNumber: "Seriennummer",
    timeEntries: "Zeiteinträge",
    materials: "Materialien",
    materialsTotal: "Materialkosten insgesamt",
    resolution: "Lösung",
    footer: "Betrieben von AlgaPSA",
  },
  nl: {
    title: "Ticket gesloten",
    subject: "Ticket gesloten • {{ticket.title}}",
    intro: "Een ticket voor {{ticket.clientName}} is opgelost en gesloten. Bekijk de oplossingsdetails hieronder.",
    ticketNumber: "Ticket #",
    status: "Status",
    closed: "Gesloten",
    closedBy: "Gesloten door",
    assignedTo: "Toegewezen aan",
    requester: "Aanvrager",
    category: "Categorie",
    location: "Locatie",
    totalTimeWorked: "Totale gewerkte tijd",
    totalBillableTime: "Totale factureerbare tijd",
    remainingHours: "Resterende uren",
    devices: "Apparaten",
    deviceName: "Naam",
    deviceType: "Type",
    manufacturerModel: "Fabrikant / Model",
    serialNumber: "Serienummer",
    timeEntries: "Tijdregistraties",
    materials: "Materialen",
    materialsTotal: "Totaal materialen",
    resolution: "Oplossing",
    footer: "Mogelijk gemaakt door AlgaPSA",
  },
  it: {
    title: "Ticket chiuso",
    subject: "Ticket chiuso • {{ticket.title}}",
    intro: "Un ticket per {{ticket.clientName}} è stato risolto e chiuso. Consulta i dettagli della risoluzione di seguito.",
    ticketNumber: "Ticket n.",
    status: "Stato",
    closed: "Chiuso",
    closedBy: "Chiuso da",
    assignedTo: "Assegnato a",
    requester: "Richiedente",
    category: "Categoria",
    location: "Sede",
    totalTimeWorked: "Tempo totale lavorato",
    totalBillableTime: "Tempo totale fatturabile",
    remainingHours: "Ore rimanenti",
    devices: "Dispositivi",
    deviceName: "Nome",
    deviceType: "Tipo",
    manufacturerModel: "Produttore / Modello",
    serialNumber: "N. di serie",
    timeEntries: "Registrazioni del tempo",
    materials: "Materiali",
    materialsTotal: "Totale materiali",
    resolution: "Risoluzione",
    footer: "Realizzato con AlgaPSA",
  },
  pl: {
    title: "Zgłoszenie zamknięte",
    subject: "Zgłoszenie zamknięte • {{ticket.title}}",
    intro: "Zgłoszenie dla {{ticket.clientName}} zostało rozwiązane i zamknięte. Szczegóły rozwiązania znajdują się poniżej.",
    ticketNumber: "Zgłoszenie nr ",
    status: "Status",
    closed: "Zamknięte",
    closedBy: "Zamknięte przez",
    assignedTo: "Przypisane do",
    requester: "Zgłaszający",
    category: "Kategoria",
    location: "Lokalizacja",
    totalTimeWorked: "Łączny czas pracy",
    totalBillableTime: "Łączny czas rozliczany",
    remainingHours: "Pozostałe godziny",
    devices: "Urządzenia",
    deviceName: "Nazwa",
    deviceType: "Typ",
    manufacturerModel: "Producent / Model",
    serialNumber: "Numer seryjny",
    timeEntries: "Wpisy czasu",
    materials: "Materiały",
    materialsTotal: "Łączny koszt materiałów",
    resolution: "Rozwiązanie",
    footer: "Obsługiwane przez AlgaPSA",
  },
  pt: {
    title: "Ticket encerrado",
    subject: "Ticket encerrado • {{ticket.title}}",
    intro: "Um ticket para {{ticket.clientName}} foi resolvido e encerrado. Revise os detalhes da resolução abaixo.",
    ticketNumber: "Ticket nº ",
    status: "Status",
    closed: "Encerrado",
    closedBy: "Encerrado por",
    assignedTo: "Atribuído a",
    requester: "Solicitante",
    category: "Categoria",
    location: "Localização",
    totalTimeWorked: "Tempo total trabalhado",
    totalBillableTime: "Tempo total faturável",
    remainingHours: "Horas restantes",
    devices: "Dispositivos",
    deviceName: "Nome",
    deviceType: "Tipo",
    manufacturerModel: "Fabricante / Modelo",
    serialNumber: "Nº de série",
    timeEntries: "Registros de tempo",
    materials: "Materiais",
    materialsTotal: "Total de materiais",
    resolution: "Resolução",
    footer: "Desenvolvido por AlgaPSA",
  },
  sv: {
    title: "Ärende stängt",
    subject: "Ärende stängt • {{ticket.title}}",
    intro: "Ett ärende för {{ticket.clientName}} har lösts och stängts. Granska lösningen nedan.",
    ticketNumber: "Ärende #",
    status: "Status",
    closed: "Stängt",
    closedBy: "Stängt av",
    assignedTo: "Tilldelat till",
    requester: "Beställare",
    category: "Kategori",
    location: "Plats",
    totalTimeWorked: "Total arbetad tid",
    totalBillableTime: "Total debiterbar tid",
    remainingHours: "Återstående timmar",
    devices: "Enheter",
    deviceName: "Namn",
    deviceType: "Typ",
    manufacturerModel: "Tillverkare / Modell",
    serialNumber: "Serienummer",
    timeEntries: "Tidsregistreringar",
    materials: "Material",
    materialsTotal: "Totalt materialbelopp",
    resolution: "Lösning",
    footer: "Drivs av AlgaPSA",
  },
};

function copyFor(language) {
  const copy = COPY[language];
  if (!copy) {
    throw new Error(`Missing ticketClosed copy for ${language}`);
  }
  return copy;
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${label}</td>
    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${value}</td>
  </tr>`;
}

function optionalRow(path, label) {
  return `{{#if ${path}}}${detailRow(label, `{{${path}}}`)}{{/if}}`;
}

function devicesHtml(copy) {
  const header = (text) => `<th scope="col" style="text-align:left;padding:6px 10px;border-bottom:2px solid rgba(146,64,14,0.25);font-weight:600;color:#1f2933;">${text}</th>`;
  const cell = (value) => `<td style="padding:6px 10px;border-bottom:1px solid rgba(146,64,14,0.15);color:#1f2933;word-break:break-word;">${value}</td>`;
  return `{{#if ticket.assets}}
  <div style="margin:24px 0 0 0;">
    <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.devices}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0;font-size:13px;">
      <thead><tr>${header(copy.deviceName)}${header(copy.deviceType)}${header(copy.manufacturerModel)}${header(copy.serialNumber)}</tr></thead>
      <tbody>{{#each ticket.assets}}<tr>${cell('{{name}}')}${cell('{{assetType}}')}${cell('{{manufacturer}} {{model}}')}${cell('{{serialNumber}}')}</tr>{{/each}}</tbody>
    </table>
  </div>
  {{/if}}`;
}

function buildHtml(copy, internal) {
  const internalDetails = internal ? `
  {{#if ticket.timeHtml}}
  <div style="margin:24px 0 0 0;"><div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.timeEntries}</div>{{{ticket.timeHtml}}}</div>
  {{/if}}
  {{#if ticket.materialsHtml}}
  <div style="margin:24px 0 0 0;"><div style="font-weight:600;color:${BRAND_DARK};margin-bottom:12px;">${copy.materials}</div>{{{ticket.materialsHtml}}}</div>
  {{/if}}
  {{#if ticket.materialsTotal}}<p><strong>${copy.materialsTotal}:</strong> {{ticket.materialsTotal}}</p>{{/if}}` : '';

  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${copy.intro}</p>
  <div style="margin-bottom:24px;"><div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;">${copy.ticketNumber}{{ticket.id}}</div></div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
    ${detailRow(copy.status, `<span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${BRAND_PRIMARY};color:#ffffff;font-weight:600;">${copy.closed}</span>`)}
    ${detailRow(copy.closedBy, '{{ticket.closedBy}}')}
    ${detailRow(copy.assignedTo, '<div style="font-weight:600;">{{ticket.assignedToName}}</div><div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>')}
    ${detailRow(copy.requester, '<div style="font-weight:600;">{{ticket.requesterName}}</div><div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>')}
    ${detailRow(copy.category, '{{ticket.categoryDetails}}')}
    ${detailRow(copy.location, '{{ticket.locationSummary}}')}
    ${optionalRow('ticket.totalTimeWorked', copy.totalTimeWorked)}
    ${optionalRow('ticket.totalTimeBillable', copy.totalBillableTime)}
    ${optionalRow('ticket.remainingBlockHours', copy.remainingHours)}
  </table>
  ${devicesHtml(copy)}
  ${internalDetails}
  <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
    <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${copy.resolution}</div>
    <div style="color:#475467;line-height:1.5;">{{{ticket.resolution}}}</div>
  </div>`;
}

function buildText(copy, internal) {
  return `${copy.title}

${copy.ticketNumber}{{ticket.id}} · {{ticket.priority}} · ${copy.closed}
${copy.closedBy}: {{ticket.closedBy}}
${copy.status}: ${copy.closed}
${copy.assignedTo}: {{ticket.assignedDetails}}
${copy.requester}: {{ticket.requesterDetails}}
${copy.category}: {{ticket.categoryDetails}}
${copy.location}: {{ticket.locationSummary}}
{{#if ticket.totalTimeWorked}}${copy.totalTimeWorked}: {{ticket.totalTimeWorked}}
{{/if}}{{#if ticket.totalTimeBillable}}${copy.totalBillableTime}: {{ticket.totalTimeBillable}}
{{/if}}{{#if ticket.remainingBlockHours}}${copy.remainingHours}: {{ticket.remainingBlockHours}}
{{/if}}{{#if ticket.assets}}
${copy.devices}:
{{#each ticket.assets}}${copy.deviceName}: {{name}}
${copy.deviceType}: {{assetType}}
${copy.manufacturerModel}: {{manufacturer}} {{model}}
${copy.serialNumber}: {{serialNumber}}

{{/each}}{{/if}}${internal ? `{{#if ticket.materialsTotal}}${copy.materialsTotal}: {{ticket.materialsTotal}}
{{/if}}` : ''}
${copy.resolution}:
{{{ticket.resolution}}}`;
}

function getTemplate(internal) {
  return {
    templateName: internal ? 'ticket-closed-internal' : 'ticket-closed-client',
    subtypeName: internal ? 'Ticket Closed Internal' : 'Ticket Closed Client',
    translations: SUPPORTED_LANGUAGES.map((language) => {
      const copy = copyFor(language);
      return {
        language,
        subject: copy.subject,
        htmlContent: wrapEmailLayout({
          language,
          headerLabel: copy.title,
          headerTitle: '{{ticket.title}}',
          headerMeta: `${copy.ticketNumber}{{ticket.id}} · {{ticket.priority}} · ${copy.closed}`,
          bodyHtml: buildHtml(copy, internal),
          footerText: copy.footer,
        }),
        textContent: buildText(copy, internal),
      };
    }),
  };
}

module.exports = {
  getClientTemplate: () => getTemplate(false),
  getInternalTemplate: () => getTemplate(true),
};
