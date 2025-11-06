import { config } from 'dotenv';
config();
import { getSurveyTriggersForTenant } from './src/lib/actions/surveyActions';
(async () => {
  const tenantId = '8acae1f0-f00c-4942-9bb9-08bca0c2d4a5';
  const triggers = await getSurveyTriggersForTenant(tenantId);
  console.log('triggers', triggers);
  process.exit(0);
})();
