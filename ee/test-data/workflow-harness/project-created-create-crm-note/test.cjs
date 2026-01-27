const { runProjectTaskFixture } = require('../_lib/biz-fixture.cjs');

module.exports = async function run(ctx) {
  return runProjectTaskFixture(ctx, {
    fixtureName: "project-created-create-crm-note",
    eventName: "PROJECT_CREATED",
    schemaRef: "payload.ProjectCreated.v1"
  });
};
