const {randomUUID}=require('crypto');
const tenant='96d5fbd6-c264-51a1-98cd-2c9e480cd959',sponsor='6f14cc2a-866f-51c1-9ce2-d55ca488b1f1',principal='395c61f9-6cb1-52df-944d-5829636e2136',ticket='ea90c3fe-1e02-572f-b8b8-dc43cd9af134',relationship='66cb6b8e-062f-5fd0-a48f-6092b7d5c05c';
const assignment=await db('authorization_bundle_assignments').where({tenant:sponsor,target_id:principal}).first();const rule=await db('authorization_bundle_rules').where({tenant:sponsor,bundle_id:assignment.bundle_id}).first();
const state={tenant,sponsor,principal,ticket,relationship,source:randomUUID(),settings:await db('tenant_email_settings').where({tenant:sponsor}).first(),rule,relationshipRow:await db('co_management_relationships').where({tenant,relationship_id:relationship}).first(),user:await db('users').where({tenant:sponsor,user_id:principal}).first('email')};
fs.writeFileSync('/tmp/delivery-route-backup.json',JSON.stringify(state));
const configs=typeof state.settings.provider_configs==='string'?JSON.parse(state.settings.provider_configs):state.settings.provider_configs;configs[0].config.port=1;
await db('tenant_email_settings').where({tenant:sponsor}).update({provider_configs:JSON.stringify(configs)});
await db('co_management_deliveries').insert({tenant,delivery_kind:'routing_email',source_id:state.source,recipient:state.user.email,recipient_kind:'msp_user',state:'pending',attempts:0,payload:JSON.stringify({event:'escalation_received',ticketId:ticket,relationshipId:relationship,sponsorTenant:sponsor,principalId:principal,actorName:'ROUTING-CANARY-ACTOR-1943',actorOrganization:'ROUTING-CANARY-ORG-1943'})});
console.log(JSON.stringify({source:state.source,initialRecipient:state.user.email,failure:'fixture sponsor SMTP port 1'}));
