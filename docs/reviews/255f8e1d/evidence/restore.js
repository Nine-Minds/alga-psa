const b=JSON.parse(fs.readFileSync('/tmp/delivery-route-backup.json'));
await db.transaction(async trx=>{
await trx('tenant_email_settings').where({tenant:b.sponsor}).update({provider_configs:typeof b.settings.provider_configs==='string'?b.settings.provider_configs:JSON.stringify(b.settings.provider_configs)});
await trx('users').where({tenant:b.sponsor,user_id:b.principal}).update({email:b.user.email});
await trx('authorization_bundle_rules').where({tenant:b.sponsor,rule_id:b.rule.rule_id}).update({config:JSON.stringify(b.rule.config)});
await trx('co_management_relationships').where({tenant:b.tenant,relationship_id:b.relationship}).update({redacted_fields:b.relationshipRow.redacted_fields});
await trx('co_managed_ticket_references').where({tenant:b.sponsor,ticket_id:b.ticket}).update({assigned_to:'340aa261-3f33-5eb2-8e56-36dfb1e4a02e'});
});console.log('restored fixture settings, email, policy, relationship and reference');
