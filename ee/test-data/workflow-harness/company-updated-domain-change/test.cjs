const { runScaffoldedFixture } = require('../_lib/scaffolded-fixture.cjs');

module.exports = async function run(ctx) {
  return runScaffoldedFixture(ctx, {
    fixtureName: "company-updated-domain-change",
    eventName: "COMPANY_UPDATED",
    schemaRef: "payload.TicketCreated.v1"
  });
};
