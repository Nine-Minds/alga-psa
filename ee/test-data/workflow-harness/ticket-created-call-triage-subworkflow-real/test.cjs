const { runCallWorkflowBizFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runCallWorkflowBizFixture(ctx, {
    fixtureName: "ticket-created-call-triage-subworkflow-real",
    eventName: "TICKET_CREATED",
    schemaRef: "payload.TicketCreated.v1",
    kind: "ticket_comment"
  });
};
