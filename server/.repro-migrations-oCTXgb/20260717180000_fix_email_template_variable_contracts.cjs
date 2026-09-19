const {
  upsertEmailTemplate,
} = require("./utils/templates/_shared/upsertEmailTemplates.cjs");
const {
  getTemplate: getCreditExpiration,
} = require("./utils/templates/email/billing/creditExpiration.cjs");
const {
  getTemplate: getSurveyTicketClosed,
} = require("./utils/templates/email/surveys/surveyTicketClosed.cjs");
const {
  getTemplate: getTicketAssigned,
} = require("./utils/templates/email/tickets/ticketAssigned.cjs");
const {
  getTemplate: getTicketClosed,
} = require("./utils/templates/email/tickets/ticketClosed.cjs");
const {
  getTemplate: getTicketCommentAdded,
} = require("./utils/templates/email/tickets/ticketCommentAdded.cjs");
const {
  getTemplate: getTicketCreated,
} = require("./utils/templates/email/tickets/ticketCreated.cjs");
const {
  getTemplate: getTicketTeamAssigned,
} = require("./utils/templates/email/tickets/ticketTeamAssigned.cjs");
const {
  getTemplate: getTicketUpdated,
} = require("./utils/templates/email/tickets/ticketUpdated.cjs");

const FIXED_TEMPLATES = [
  getCreditExpiration,
  getSurveyTicketClosed,
  getTicketAssigned,
  getTicketClosed,
  getTicketCommentAdded,
  getTicketCreated,
  getTicketTeamAssigned,
  getTicketUpdated,
];

exports.up = async function up(knex) {
  for (const getTemplate of FIXED_TEMPLATES) {
    await upsertEmailTemplate(knex, getTemplate());
  }
};

exports.down = async function down() {
  // No-op: email template migrations are forward-only content corrections.
};
