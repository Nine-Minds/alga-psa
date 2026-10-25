// Refresh every published page's provenance banner, the overview/collection coverage
// tables and the acceptance page from the third-pass ledger. Each guide is labelled
// with the build it was recorded on.
const fs=require('fs'),path=require('path');
const {JSDOM}=require(path.join(process.cwd(),'node_modules/jsdom'));
const {base,packet,publication,regenerate}=require('./ledger.cjs');
const g=JSON.parse(fs.readFileSync(path.join(base,'guide-coverage.json')));
g.notReached=[];
g.openProductDefects=[];
g.resolvedProductDefects=[
 {id:'native-comment-unknown-response-clears-composer',commit:'1c431798ba',guide:'guides/07-conversations-and-files.html',fix:'An unconfirmed comment publish keeps the composer, draft and staged files; retry reuses the same operation.',regression:'packages/tickets/src/components/ticket/__tests__/TicketDetailsContainer.unconfirmedComment.test.tsx',evidence:'07-composer-draft-recovery-56e7'},
 {id:'late-layout-preference-unmounts-entry-composer',commit:'3e423f3133',guide:'guides/07-conversations-and-files.html',fix:'A stored ticket layout preference that loads after the user chose a layout no longer switches layouts (which unmounted an open Entry composer and its draft).',regression:'packages/tickets/src/components/ticket/__tests__/TicketDetails.remoteUpdates.test.tsx',evidence:'07-grid-parity-and-file-limits-56e7'},
 {id:'co-managed-time-missing-from-billing-client-lookups',commit:'c31dc3bfad',guide:'guides/09-time-and-billing.html',fix:'The unresolved-charge review, the Automatic Invoices period filter and recurring approval blockers resolve the client through the billing work context, so co-managed catalog time can be reviewed and invoiced and unapproved co-managed time blocks its line.',regression:'server/src/test/integration/billing/{unresolvedCatalogPricing,billingProfileAttribution}.integration.test.ts, server/src/test/integration/billingInvoiceTiming.integration.test.ts',evidence:'09-catalog-pricing-reconciliation-56e7'},
 {id:'shared-ticket-hides-customer-assignee',commit:'33ae41dcae',guide:'index.html',fix:'The MSP sees the customer assignee by name (never its identity) in Entry and Grid.',regression:'packages/tickets/src/lib/assigneeDisplay.test.ts, TicketInfo.sharedEntryGating, BentoHero.unsavedChanges, coManagedSharedTicketData',evidence:'00-overview-native-walkthrough-56e7'},
 {id:'billing-dashboard-review-excludes-today',commit:'91c9b27009',guide:'guides/09-time-and-billing.html',fix:'The client billing dashboard reviews the last 30 days including today.',regression:'packages/clients/src/components/clients/ClientContractLineDashboard.reviewWindow.test.tsx',evidence:'09-catalog-pricing-reconciliation-56e7'},
 {id:'ended-customer-workspace-offers-failing-edits',commit:'56e708a31b',guide:'guides/10-departure-and-archives.html',fix:'An ended (or pending) co-managed workspace renders its native ticket screen read-only, never shows the denied native time panel, and ticket writes return the real read-only message.',regression:'server/src/test/unit/product/coManagedLocalTicketDataSource.test.tsx, packages/tickets/src/actions/ticketActionErrors.lifecycle.test.ts',evidence:'10-departure-c-cutoff-56e7'}];
g.preExistingIssuesObserved=[
 {where:'server/src/components/layout/Header.tsx (TenantBadge)',issue:'The header shows the active tenant UUID as a badge.',scope:'Present on origin/main; not changed here.'},
 {where:'packages/scheduling/src/components/time-management/time-entry/time-sheet/ContractInfoBanner.tsx',issue:'Says uncovered time "will be routed to the system-managed default contract", but contract eligibility excludes that contract; such time is billed as unresolved work at the catalog rate.',scope:'Present on origin/main; not changed here.'},
 {where:'packages/reporting/src/actions/report-actions/getHoursByServiceType.ts',issue:'Filters work_item_type on "Ticket"/"Project Task", which the time_entries check constraint never allows, so "Hours by service" is always empty (and ignores co-managed work).',scope:'Present on origin/main; not changed here.'}];
regenerate(g);
const slug=e=>e.guide==='index.html'?'overview':e.guide==='guides/index.html'?'collection':path.basename(e.guide,'.html');
const cur=g.applicationSourceRevision;
const banner=e=>{const on=e.build?.sourceRevision===cur;
 return `Recorded on ${e.build?.sourceRevision}, ${e.build?.buildId}${on?' (the current application)':' (an earlier build; the current application is '+cur+', '+g.buildId+')'}. Guide scenario: ${e.coverageStatus}${e.blockedExternal?' — see the unblock record for the missing resource and the action that unblocks it':''}. ${g.coveredGuides} covered on the current build / ${g.partialGuides} partial / ${g.blockedGuides} blocked-external. Playback verified for ${g.playbackVerifiedGuides} of ${g.requiredGuides}. reviewReady=false.`};
const table=d=>{const section=d.createElement('section');section.id='current-guide-coverage';
 const h=d.createElement('h2');h.textContent='Current guide coverage';section.append(h);
 const p=d.createElement('p');p.textContent=`${g.coveredGuides} covered on ${cur.slice(0,10)} (${g.buildId}) / ${g.partialGuides} partial / ${g.blockedGuides} blocked-external. Playback and chapter seeking verified for ${g.playbackVerifiedGuides} of ${g.requiredGuides}. recordingReady=${g.recordingReady}; reviewReady=false: ${g.reviewReadyReason}`;section.append(p);
 const t=d.createElement('table'),head=d.createElement('tr');for(const label of ['Guide','Scenario outcome','Recorded on','Remaining limitation','Playback']){const th=d.createElement('th');th.textContent=label;head.append(th)}t.append(head);
 for(const e of g.guides){const row=d.createElement('tr'),name=d.createElement('td'),a=d.createElement('a');a.href='/'+e.guide;a.textContent=e.guide;name.append(a);row.append(name);
  for(const text of[e.coverageStatus,`${(e.build?.sourceRevision||'').slice(0,10)} ${e.build?.buildId||''}`,e.remaining||'Covered guide scenario.']){const td=d.createElement('td');td.textContent=text;row.append(td)}
  const proof=d.createElement('td'),link=d.createElement('a');link.textContent='Playback and seek proof';link.href='/evidence/implement-20261025/current-'+e.build?.sourceRevision+'/'+slug(e)+'/playback-verification.json';proof.append(link);row.append(proof);t.append(row)}
 section.append(t);return section};
for(const e of g.guides){const file=path.join(publication,e.guide),d=new JSDOM(fs.readFileSync(file,'utf8')).window.document;
 const b=d.querySelector('#current-acceptance');if(b)b.textContent=banner(e);
 if(['index.html','guides/index.html'].includes(e.guide)){d.querySelector('#current-guide-coverage')?.remove();d.querySelector('main').append(table(d))}
 const html='<!doctype html>\n'+d.documentElement.outerHTML;fs.writeFileSync(file,html);
 const out=path.join(packet,'third-pass/publication',slug(e));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'page.html'),html)}
const acceptance=path.join(publication,'evidence/implement-20261025/acceptance.html');
const d=new JSDOM('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Co-Managed IT current acceptance</title><link rel="stylesheet" href="/guides/styles.css"><main><h1>Co-Managed IT current acceptance</h1><p id="acceptance-summary"></p></main></html>').window.document;
d.getElementById('acceptance-summary').textContent=`Review application ${g.origin} serves ${cur} (${g.buildId}). Each guide is labelled with the build it was recorded on. Evidence commit: HEAD of the containing commit.`;
d.querySelector('main').append(table(d));const html='<!doctype html>\n'+d.documentElement.outerHTML;fs.writeFileSync(acceptance,html);fs.writeFileSync(path.join(packet,'third-pass/publication/acceptance.html'),html);
console.log({covered:g.coveredGuides,partial:g.partialGuides,blocked:g.blockedGuides,playback:g.playbackVerifiedGuides,recordingReady:g.recordingReady});
