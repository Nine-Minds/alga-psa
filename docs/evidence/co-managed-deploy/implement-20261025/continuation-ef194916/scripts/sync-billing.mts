import { createRequire } from 'node:module';
import fs from 'node:fs';
import { syncRecurringServicePeriodsForContractLine } from '/home/robert/alga-copies/feature-co-managed-it/packages/billing/dist/actions/recurringServicePeriodSync.mjs';
const require=createRequire('/home/robert/alga-copies/feature-co-managed-it/package.json');
const knex=require('knex');
const root='/tmp/alga-smoke-evidence/co-managed-it-implement-20261025/continuation-ef194916';
const f=JSON.parse(fs.readFileSync(root+'/billing-fixture.json','utf8'));
const db=knex({client:'pg',connection:{host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER_ADMIN||'postgres',password:process.env.DB_PASSWORD_ADMIN,database:'server_co_managed'}});
(async()=>{try{
 await db.transaction(trx=>syncRecurringServicePeriodsForContractLine(trx,{tenant:f.tenant,contractLineId:f.lineId,sourceRunPrefix:'co-managed-continuation-acceptance'}));
 const rows=await db('recurring_service_periods').where({tenant:f.tenant,obligation_id:f.lineId}).select('record_id','period_key','schedule_key','service_period_start','service_period_end','invoice_window_start','invoice_window_end','lifecycle_state');
 fs.writeFileSync(root+'/billing-service-periods.json',JSON.stringify({setup:'Operator calls real recurring materializer; no invoice or time creation',tenant:f.tenant,lineId:f.lineId,rows},null,2));
 console.log(JSON.stringify({lineId:f.lineId,periods:rows.length}));
}finally{await db.destroy()}})().catch(error=>{console.error(error.message);process.exitCode=1});
