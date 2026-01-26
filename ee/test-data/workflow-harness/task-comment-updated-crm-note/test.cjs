const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "task-comment-updated-crm-note",
    eventName: "TASK_COMMENT_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
