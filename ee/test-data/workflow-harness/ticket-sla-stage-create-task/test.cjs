const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-sla-stage-create-task",
    eventName: "TICKET_SLA_STAGE_ENTERED",
    schemaRef: "payload.TicketSlaStageEntered.v1"
  });
};
