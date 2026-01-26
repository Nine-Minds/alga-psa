const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "task-comment-added-blocked-notify",
    eventName: "TASK_COMMENT_ADDED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
