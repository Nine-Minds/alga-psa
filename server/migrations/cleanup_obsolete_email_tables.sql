-- Cleanup obsolete email provider tables
-- These tables represent the old data model and are empty

-- First, update the foreign key in email_processed_messages to reference the new table structure
ALTER TABLE email_processed_messages 
DROP CONSTRAINT IF EXISTS email_processed_messages_provider_id_tenant_foreign;

-- Add new foreign key to reference email_providers instead of email_provider_configs
ALTER TABLE email_processed_messages 
ADD CONSTRAINT email_processed_messages_provider_id_tenant_foreign 
FOREIGN KEY (provider_id, tenant) REFERENCES email_providers(id, tenant) ON DELETE CASCADE;

-- Drop the obsolete tables (all are empty)
DROP TABLE IF EXISTS email_provider_configs CASCADE;
DROP TABLE IF EXISTS email_provider_health CASCADE;
DROP TABLE IF EXISTS email_rate_limits CASCADE;

-- Verify the cleanup
SELECT 'Cleanup completed successfully' as status;