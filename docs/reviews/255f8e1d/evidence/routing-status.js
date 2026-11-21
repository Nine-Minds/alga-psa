const b=JSON.parse(fs.readFileSync('/tmp/delivery-route-backup.json'));console.log(JSON.stringify(await db('co_management_deliveries').where({tenant:b.tenant,source_id:b.source}),null,2));
