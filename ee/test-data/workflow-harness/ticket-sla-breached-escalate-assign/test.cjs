const { runTicketCommentFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runTicketCommentFixture(ctx, {
    fixtureName: "ticket-sla-breached-escalate-assign",
    eventName: "TICKET_SLA_STAGE_BREACHED",
    schemaRef: "payload.TicketSlaStageBreached.v1"
  });
};
