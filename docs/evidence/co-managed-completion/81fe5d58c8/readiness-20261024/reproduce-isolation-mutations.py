from pathlib import Path
import subprocess,hashlib,json,difflib
root=Path.cwd(); out=Path('/tmp/co-managed-readiness-mutations')
command=['npx','vitest','run','../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts','-t','isolates sibling customers and MSP data']
summary=root/'packages/co-managed/src/sharedWorkRead.ts'
customer=root/'packages/co-managed/src/customerWork.ts'
mutants=[('foreign-read-admission',summary,"  return actor?.tenant === resource?.tenant && resource?.kind === 'ticket'",'''  if (actor?.tenant !== resource?.tenant && (await tenantDb(db, actor.tenant).table('tenants').first('product_code'))?.product_code === 'co_managed') {
    return db.transaction(trx => readSummary({ trx, actor, resource, sessionId: actor.sessionId, action: 'read', revision: 0, redactedFields: [] }));
  }
  return actor?.tenant === resource?.tenant && resource?.kind === 'ticket' '''),
('foreign-write-admission',customer,"  return withCoManagedCustomerWork(db, actor, resource, action, command);",'''  if (action === 'update' && actor.tenant !== resource.tenant) {
    return withTransaction(db, trx => command({ trx, actor, resource, sessionId: actor.sessionId, action, revision: 0, redactedFields: [] }));
  }
  return withCoManagedCustomerWork(db, actor, resource, action, command);''')]
results=[]
for name,path,needle,replacement in mutants:
 original=path.read_text()
 if needle not in original: raise RuntimeError('Mutation site missing '+name)
 changed=original.replace(needle,replacement,1)
 (out/(name+'.patch')).write_text(''.join(difflib.unified_diff(original.splitlines(True),changed.splitlines(True),fromfile=str(path.relative_to(root)),tofile=str(path.relative_to(root)))))
 try:
  path.write_text(changed)
  run=subprocess.run(command,cwd=root/'server',text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120)
  (out/(name+'.txt')).write_text(run.stdout)
  expected=run.returncode==1 and 'promise resolved' in run.stdout and ('Sibling confidential issue' in run.stdout or 'Unauthorized overwrite' in run.stdout)
  results.append({'mutation':name,'file':str(path.relative_to(root)),'exitCode':run.returncode,'detectedActualBoundaryBypass':expected})
  print(name,results[-1],flush=True)
 finally:
  path.write_text(original)
 if not expected: raise RuntimeError('Mutation failed for an unrelated reason: '+name)
run=subprocess.run(command,cwd=root/'server',text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120)
(out/'restored.txt').write_text(run.stdout)
results.append({'mutation':'restored-boundaries','exitCode':run.returncode,'passed':run.returncode==0})
(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
if run.returncode: raise RuntimeError('Restored test did not pass')
print('Restored boundaries: PASS',flush=True)
