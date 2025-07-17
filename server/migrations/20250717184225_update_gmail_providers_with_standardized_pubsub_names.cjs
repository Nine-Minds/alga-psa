/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Updating Gmail providers with standardized Pub/Sub names...');
  
  // Update all Google email provider configurations to use standardized naming
  const googleProviders = await knex('google_email_provider_config')
    .select('email_provider_id', 'tenant', 'pubsub_topic_name', 'pubsub_subscription_name');
  
  console.log(`Found ${googleProviders.length} Google email providers to update`);
  
  for (const provider of googleProviders) {
    const standardizedTopicName = `gmail-notifications-${provider.tenant}`;
    const standardizedSubscriptionName = `gmail-webhook-${provider.tenant}`;
    
    // Only update if the names are different from the standardized format
    if (provider.pubsub_topic_name !== standardizedTopicName || 
        provider.pubsub_subscription_name !== standardizedSubscriptionName) {
      
      await knex('google_email_provider_config')
        .where({ email_provider_id: provider.email_provider_id, tenant: provider.tenant })
        .update({
          pubsub_topic_name: standardizedTopicName,
          pubsub_subscription_name: standardizedSubscriptionName,
          updated_at: knex.fn.now()
        });
      
      console.log(`Updated provider ${provider.email_provider_id} with standardized Pub/Sub names`);
    }
  }
  
  console.log('Gmail provider Pub/Sub names standardization completed');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('Reverting Gmail provider Pub/Sub names standardization...');
  
  // Note: This rollback sets generic names, not the original ones
  // In a production scenario, you might want to store the original names first
  await knex('google_email_provider_config')
    .update({
      pubsub_topic_name: 'gmail-notifications',
      pubsub_subscription_name: 'gmail-webhook-subscription',
      updated_at: knex.fn.now()
    });
  
  console.log('Gmail provider Pub/Sub names rollback completed');
};