const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "project-created-create-linked-ticket",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
