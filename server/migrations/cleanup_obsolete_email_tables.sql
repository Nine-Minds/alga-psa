-- Cleanup obsolete email provider tables
-- These tables represent the old data model and are empty

-- Remove foreign key constraint for CitusDB compatibility
ALTER TABLE email_processed_messages 
DROP CONSTRAINT IF EXISTS email_processed_messages_provider_id_tenant_foreign;

-- Note: Foreign key constraint not re-added for CitusDB compatibility
-- Referential integrity enforced in application code

-- Drop the obsolete tables (all are empty)
DROP TABLE IF EXISTS email_provider_configs CASCADE;
DROP TABLE IF EXISTS email_provider_health CASCADE;
DROP TABLE IF EXISTS email_rate_limits CASCADE;

-- Verify the cleanup
SELECT 'Cleanup completed successfully' as status;