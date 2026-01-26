import fs from 'fs';
import path from 'path';
import { getAdminConnection } from '@alga-psa/db/admin';
import logger from '@alga-psa/core/logger';
import { v4 as uuidv4 } from 'uuid';

export async function updateSystemWorkflowsFromAssets() {
  logger.info('[WorkflowUpdater] Checking for system workflow updates from assets...');

  // We assume the process is running from the service root (services/workflow-worker)
  // and the assets are in dist/assets/workflows
  const assetsDir = path.resolve(process.cwd(), 'dist/assets/workflows');
  
  if (!fs.existsSync(assetsDir)) {
    logger.warn(`[WorkflowUpdater] Workflow assets directory not found at ${assetsDir}. Skipping update.`);
    return;
  }

  const enableLegacyEmailWorkflow =
    (process.env.LEGACY_SYSTEM_EMAIL_WORKFLOW_ENABLED || '').trim().toLowerCase() === 'true';

  const workflowFiles = [
    ...(enableLegacyEmailWorkflow
      ? ([
          {
            fileName: 'system-email-processing-workflow.js',
            registrationName: 'System Email Processing'
          }
        ] as const)
      : ([] as const)),
  ];

  if (!enableLegacyEmailWorkflow) {
    logger.info(
      '[WorkflowUpdater] Legacy system email workflow updates are disabled (set LEGACY_SYSTEM_EMAIL_WORKFLOW_ENABLED=true to enable).'
    );
  }

  const knex = await getAdminConnection();

  for (const wf of workflowFiles) {
    const filePath = path.join(assetsDir, wf.fileName);
    
    if (!fs.existsSync(filePath)) {
      logger.warn(`[WorkflowUpdater] Workflow asset file not found: ${wf.fileName}`);
      continue;
    }

    try {
      const newCode = fs.readFileSync(filePath, 'utf8');
      
      // Find registration
      const registration = await knex('system_workflow_registrations')
        .where({ name: wf.registrationName })
        .first();
      
      if (!registration) {
        logger.warn(`[WorkflowUpdater] Registration not found for "${wf.registrationName}". Skipping.`);
        continue;
      }

      // Get current active version
      const currentVersion = await knex('system_workflow_registration_versions')
        .where({ 
          registration_id: registration.registration_id,
          is_current: true 
        })
        .first();

      // Compare code (normalize whitespace)
      const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();
      
      if (currentVersion && normalize(currentVersion.code) === normalize(newCode)) {
        logger.info(`[WorkflowUpdater] Workflow "${wf.registrationName}" is up to date.`);
        continue;
      }

      logger.info(`[WorkflowUpdater] Detecting changes in "${wf.registrationName}". Creating new version...`);

      // Calculate new version number
      const currentVerStr = registration.version || '1.0';
      const verParts = currentVerStr.split('.').map(Number);
      // Simple patch bump: 1.0 -> 1.1
      const newVerStr = `${verParts[0]}.${(verParts[1] || 0) + 1}`;

      await knex.transaction(async (trx) => {
        // Archive old versions
        await trx('system_workflow_registration_versions')
          .where({ registration_id: registration.registration_id })
          .update({ is_current: false });

        // Create new version
        await trx('system_workflow_registration_versions').insert({
          version_id: uuidv4(),
          registration_id: registration.registration_id,
          version: newVerStr,
          code: newCode,
          is_current: true,
          created_by: '00000000-0000-0000-0000-000000000000', // System user
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        // Update registration pointer
        await trx('system_workflow_registrations')
          .where({ registration_id: registration.registration_id })
          .update({ 
            version: newVerStr,
            updated_at: new Date().toISOString() 
          });
      });
      
      logger.info(`[WorkflowUpdater] Successfully deployed version ${newVerStr} of "${wf.registrationName}".`);
    } catch (error) {
      logger.error(`[WorkflowUpdater] Failed to update workflow "${wf.registrationName}":`, error);
    }
  }
}
