const b=JSON.parse(fs.readFileSync('/tmp/delivery-route-backup.json'));
await db('tenant_email_settings').where({tenant:b.sponsor}).update({provider_configs:typeof b.settings.provider_configs==='string'?b.settings.provider_configs:JSON.stringify(b.settings.provider_configs)});
await db('users').where({tenant:b.sponsor,user_id:b.principal}).update({email:' CM.NOTIFICATION.CURRENT.1943@NOTIFICATION.TEST '});
const config=typeof b.rule.config==='string'?JSON.parse(b.rule.config):b.rule.config;config.redactedFields=['tickets.title','actor_organization_name'];
await db('authorization_bundle_rules').where({tenant:b.sponsor,rule_id:b.rule.rule_id}).update({config:JSON.stringify(config)});
await db('co_management_relationships').where({tenant:b.tenant,relationship_id:b.relationship}).update({redacted_fields:['ticket_number','actor_display_name']});
await db('co_management_deliveries').insert({tenant:b.tenant,delivery_kind:'routing_in_app',source_id:b.source,recipient:b.principal,recipient_kind:'msp_user',state:'pending',attempts:0,payload:(await db('co_management_deliveries').where({tenant:b.tenant,source_id:b.source}).first()).payload});
console.log('Restored SMTP; changed email with whitespace/case; tightened relationship ticket-number/actor and home-policy title/organization redactions.');
