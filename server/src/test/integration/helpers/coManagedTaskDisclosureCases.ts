import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';

export function registerCoManagedTaskDisclosureCases(getDb: () => Knex, fixture: (work: (f: any) => Promise<void>) => Promise<void>) {
  const run=(work:(f:any)=>Promise<void>)=>fixture(async f=>{
    const db=getDb(),domain=await import('../../../../../packages/co-managed/src/threadDisclosure'),privateDomain=await import('../../../../../packages/co-managed/src/privateThreadDisclosure');
    const conversation=await import('../../../../../packages/co-managed/src/projectTaskConversation'),files=await import('../../../../../packages/co-managed/src/conversationAttachments');
    const {StorageProviderFactory}=await import('@alga-psa/storage/StorageProviderFactory');
    const objects=new Map<string,Uint8Array>(),download=vi.fn(async(path:string)=>{const bytes=objects.get(path);if(!bytes)throw new Error('Object missing');return bytes;});
    const upload=vi.fn(async(path:string,bytes:Uint8Array)=>{objects.set(path,Buffer.from(bytes));});
    const storage=vi.spyOn(StorageProviderFactory,'createProvider').mockResolvedValue({download,upload:async(bytes:Uint8Array,path:string)=>{await upload(path,bytes);return {path,size:bytes.length};}} as any);
    const {StorageService}=await import('@alga-psa/storage/StorageService');
    const validation=vi.spyOn(StorageService,'validateFileUpload').mockResolvedValue(undefined);
    const {discloseSharedThread}=await import('../../../lib/co-managed/discloseTicketThread');
    const {retainCoManagedTaskCommentEvent}=await import('../../../../../packages/co-managed/src/projectTaskEvents');
    const {v5}=await import('uuid');
    const after=async(context:any)=>{for(const commentId of context.commentIds)await retainCoManagedTaskCommentEvent(context.trx,{tenant:context.resource.tenant,
      eventId:v5(`${context.resource.tenant}:task-thread-audience:${commentId}`,context.operationId),taskId:context.resource.id,commentId,kind:'audience'});};
    const add=async(actor:any,audience:any='shared_it',parent?:any,text='Task discussion')=>conversation.mutateCoManagedProjectTaskComment(db,actor,f.resource,
      parent?{kind:'create',operationId:randomUUID(),parent:{storeTenant:parent.storeTenant,threadId:parent.threadId,commentId:parent.commentId},expectedAudience:audience,text}:{kind:'create',operationId:randomUUID(),audience,text});
    const attach=async(actor:any,comment:any,name='evidence.txt')=>files.uploadCoManagedConversationAttachment(db,actor,f.resource,{attachmentId:randomUUID(),
      comment:{storeTenant:comment.storeTenant,threadId:comment.threadId,commentId:comment.commentId},fileName:name,mimeType:'text/plain',content:Buffer.from(name)},upload);
    const review=async(actor:any,comment:any)=> (comment.storeTenant===f.resource.tenant?domain.previewCoManagedThreadDisclosure:privateDomain.previewCoManagedPrivateThreadDisclosure)(db,actor,f.resource,{storeTenant:comment.storeTenant,threadId:comment.threadId});
    const request=(preview:any,audience:any='requester')=>({storeTenant:preview.storeTenant,threadId:preview.threadId,operationId:randomUUID(),expectedSnapshot:preview.snapshot,audience,confirmed:true as const});
    try {await work({...f,...domain,...privateDomain,...conversation,...files,db,objects,download,upload,transport:{download,upload},after,add,attach,review,request,discloseSharedThread});}
    finally {storage.mockRestore();validation.mockRestore();}
  });
  it('task thread disclosure preserves canonical identities and files, bumps revisions and emits metadata-only task invalidations',async()=>run(async f=>{
    const root=await f.add(f.customerPrincipal,'organization_private'),reply=await f.add(f.customerPrincipal,'organization_private',root,'Reply history'),file=await f.attach(f.customerPrincipal,root);
    const old=await f.customer.table('project_task_comments').where('thread_id',root.threadId).orderBy('task_comment_id');
    const preview=await f.review(f.customerPrincipal,root);expect(preview).toMatchObject({comments:2,attachments:1,pendingAttachments:0,audience:'organization_private'});
    const request=f.request(preview,'shared_it'),receipt=await f.discloseSharedThread(f.db,f.customerPrincipal,f.resource,request);
    expect(await f.discloseSharedThread(f.db,f.customerPrincipal,f.resource,request)).toEqual(receipt);
    const rows=await f.customer.table('project_task_comments').where('thread_id',root.threadId).orderBy('task_comment_id');
    expect(rows.map((row:any)=>row.task_comment_id)).toEqual(old.map((row:any)=>row.task_comment_id));
    expect(rows.map((row:any)=>row.note)).toEqual(old.map((row:any)=>row.note));expect(rows.every((row:any)=>row.collaboration_revision===2)).toBe(true);
    expect(await f.customer.table('co_management_conversation_attachments').where('attachment_id',file.attachmentId).first()).toMatchObject({project_task_id:f.resource.id,ticket_id:null});
    const visible=await f.listCoManagedConversationAttachments(f.db,f.principal,f.resource,{storeTenant:root.storeTenant,threadId:root.threadId,commentId:root.commentId});expect(visible).toHaveLength(1);
    const events=await f.customer.table('co_management_event_outbox').where('event_type','PROJECT_TASK_COMMENT_UPDATED');expect(events).toHaveLength(2);
    expect(events.every((row:any)=>row.resource_type==='project_task'&&row.publication.payload.collaboration.revision===2)).toBe(true);
    expect(JSON.stringify(events.map((row:any)=>row.publication))).not.toMatch(/Reply history|Task discussion|evidence.txt/);
    expect(await f.customer.table('audit_logs').where('audit_id',request.operationId).first()).toMatchObject({operation:'co_managed_task_thread_audience',record_id:root.commentId});
    await expect(f.mutateCoManagedProjectTaskComment(f.db,f.customerPrincipal,f.resource,{kind:'edit',operationId:randomUUID(),comment:{storeTenant:reply.storeTenant,threadId:reply.threadId,commentId:reply.commentId},expectedRevision:1,text:'Stale edit'})).rejects.toMatchObject({code:'TASK_COMMENT_CONFLICT'});
  }));
  it('task thread disclosure requires the root author and a current full snapshot, including pending attachments',async()=>run(async f=>{
    const root=await f.add(f.customerPrincipal),preview=await f.review(f.customerPrincipal,root),request=f.request(preview);
    await expect(f.review(f.principal,root)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    await f.add(f.principal,'shared_it',root,'A concurrent reply');
    await expect(f.discloseCoManagedThread(f.db,f.customerPrincipal,f.resource,request,f.after)).rejects.toMatchObject({code:'THREAD_DISCLOSURE_CONFLICT'});
    const comment={storeTenant:root.storeTenant,threadId:root.threadId,commentId:root.commentId};
    await expect(f.uploadCoManagedConversationAttachment(f.db,f.customerPrincipal,f.resource,{attachmentId:randomUUID(),comment,fileName:'pending.txt',mimeType:'text/plain',content:Buffer.from('pending')},async()=>{throw new Error('Pending upload');})).rejects.toThrow('Pending upload');
    const pending=await f.review(f.customerPrincipal,root);expect(pending.pendingAttachments).toBe(1);
    await expect(f.discloseCoManagedThread(f.db,f.customerPrincipal,f.resource,f.request(pending),f.after)).rejects.toMatchObject({code:'THREAD_DISCLOSURE_CONFLICT'});
    expect((await f.customer.table('comment_threads').where('thread_id',root.threadId).first()).collaboration_audience).toBe('shared_it');
  }));
  it('task thread private disclosure copies posted files with historical authors and tombstones and retries one canonical publication',async()=>run(async f=>{
    const root=await f.add(f.principal,'organization_private'),reply=await f.add(f.principal,'organization_private',root,'Removed private response');
    const rootFile=await f.attach(f.principal,root,'private-evidence.txt');await f.attach(f.principal,reply,'deleted-evidence.txt');
    await f.mutateCoManagedProjectTaskComment(f.db,f.principal,f.resource,{kind:'delete',operationId:randomUUID(),comment:{storeTenant:reply.storeTenant,threadId:reply.threadId,commentId:reply.commentId},expectedRevision:1});
    const preview=await f.review(f.principal,root);expect(preview).toMatchObject({comments:1,attachments:1,pendingAttachments:0});const request=f.request(preview);
    const receipt=await f.discloseSharedThread(f.db,f.principal,f.resource,request);
    expect(await f.discloseSharedThread(f.db,f.principal,f.resource,request)).toEqual(receipt);
    const ledger=await f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).first();expect(ledger).toMatchObject({ticket_id:null,project_task_id:f.resource.id,status:'published'});
    const comments=await f.customer.table('project_task_comments').where('thread_id',receipt.threadId);expect(comments).toHaveLength(2);
    expect(comments.every((row:any)=>row.user_id===null&&row.actor_reference_id)).toBe(true);
    const tombstone=comments.find((row:any)=>row.deleted_at);expect(tombstone).toMatchObject({note:'',markdown_content:'',collaboration_revision:2});
    const copied=await f.customer.table('co_management_conversation_attachments').where('disclosure_operation_id',request.operationId);expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ticket_id:null,project_task_id:f.resource.id,file_name:'private-evidence.txt',content_hash:createHash('sha256').update('private-evidence.txt').digest('hex')});
    expect(copied[0].storage_path).toContain('/task-disclosures/');expect(f.objects.get(copied[0].storage_path)).toEqual(Buffer.from('private-evidence.txt'));
    const downloaded=await f.downloadCoManagedConversationAttachment(f.db,f.customerPrincipal,f.resource,{storeTenant:f.resource.tenant,threadId:receipt.threadId,commentId:copied[0].comment_id,attachmentId:copied[0].attachment_id},f.download);
    expect(downloaded.content).toEqual(Buffer.from('private-evidence.txt'));
    expect((await f.customer.table('co_management_event_outbox').where('event_type','PROJECT_TASK_COMMENT_UPDATED')).length).toBe(2);
    await expect(f.listCoManagedConversationAttachments(f.db,f.principal,f.resource,{storeTenant:rootFile.storeTenant,threadId:rootFile.threadId,commentId:rootFile.commentId})).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    const canonical=await f.getCoManagedProjectTaskConversation(f.db,f.customerPrincipal,f.resource);expect(canonical.items.filter((row:any)=>row.threadId===receipt.threadId)).toHaveLength(2);
  }));
  it('task thread private disclosure resumes failed byte transfer and cleans only abandoned task disclosure objects',async()=>run(async f=>{
    const root=await f.add(f.principal,'organization_private');await f.attach(f.principal,root);const request=f.request(await f.review(f.principal,root));
    const upload=vi.fn(async(path:string,bytes:Uint8Array)=>{f.objects.set(path,Buffer.from(bytes));throw new Error('Upload acknowledgment lost');});
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,request,{download:f.download,upload},f.after)).rejects.toThrow('Upload acknowledgment lost');
    expect(await f.customer.table('project_task_comments').where('thread_id',request.operationId)).toEqual([]);
    const prepared=await f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).first(),path=prepared.manifest[0].path;
    expect(prepared.status).toBe('prepared');expect(prepared.manifest[0].copied).toBe(false);
    const receipt=await f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,request,f.transport,f.after);expect(receipt.threadId).toBe(request.operationId);
    expect((await f.customer.table('co_management_conversation_attachments').where('disclosure_operation_id',request.operationId).first()).storage_path).toBe(path);
    const second=await f.add(f.principal,'organization_private');await f.attach(f.principal,second);const abandoned=f.request(await f.review(f.principal,second));
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,abandoned,{download:f.download,upload},f.after)).rejects.toThrow('Upload acknowledgment lost');
    await f.sponsor.table('co_management_thread_transfers').where('operation_id',abandoned.operationId).update({last_activity_at:new Date(Date.now()-31*86400000)});
    const {cleanupCoManagedThreadTransfers}=await import('../../../../../packages/co-managed/src/privateThreadTransferCleanup');const remove=vi.fn(async(objectPath:string)=>{f.objects.delete(objectPath);});
    expect(await cleanupCoManagedThreadTransfers(f.db,f.principal.tenant,remove)).toMatchObject({abandonedTransfers:1,cleanedTransfers:1});
    expect(remove).toHaveBeenCalledTimes(1);expect(remove.mock.calls[0][0]).toContain('/task-disclosures/');expect(remove.mock.calls[0][0]).not.toBe(path);expect(f.objects.has(path)).toBe(true);
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,abandoned,f.transport,f.after)).rejects.toMatchObject({code:'THREAD_DISCLOSURE_CONFLICT'});
  }));

  it('task thread private disclosure refuses corrupted bytes and forged transfer paths without canonical publication',async()=>run(async f=>{
    const root=await f.add(f.principal,'organization_private');await f.attach(f.principal,root);const request=f.request(await f.review(f.principal,root));
    const upload=vi.fn();
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,request,{download:async()=>Buffer.from('corrupted'),upload},f.after)).rejects.toMatchObject({code:'THREAD_DISCLOSURE_CONFLICT'});
    expect(upload).not.toHaveBeenCalled();expect(await f.customer.table('project_task_comments').where('thread_id',request.operationId)).toEqual([]);
    const row=await f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).first();
    await expect(f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).update({ticket_id:f.resource.id,project_task_id:null})).rejects.toThrow('immutable');
    const manifest=structuredClone(row.manifest);manifest[0].path=manifest[0].path.replace('/task-disclosures/','/disclosures/');
    await f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).update({manifest:JSON.stringify(manifest)});
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,request,f.transport,f.after)).rejects.toMatchObject({code:'THREAD_DISCLOSURE_CONFLICT'});
    expect(await f.customer.table('co_management_conversation_attachments').where('disclosure_operation_id',request.operationId)).toEqual([]);
  }));
  it('task thread disclosure removes MSP live visibility while preserving prior participation and attachment history',async()=>run(async f=>{
    const root=await f.add(f.customerPrincipal),reply=await f.add(f.principal,'shared_it',root,'Retained joint response'),file=await f.attach(f.customerPrincipal,root);
    const request=f.request(await f.review(f.customerPrincipal,root),'organization_private');await f.discloseSharedThread(f.db,f.customerPrincipal,f.resource,request);
    expect((await f.getCoManagedProjectTaskConversation(f.db,f.principal,f.resource)).items.filter((row:any)=>row.threadId===root.threadId)).toEqual([]);
    await expect(f.listCoManagedConversationAttachments(f.db,f.principal,f.resource,{storeTenant:root.storeTenant,threadId:root.threadId,commentId:root.commentId})).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    const history=await f.sponsor.table('co_managed_participation_evidence').where({resource_type:'project_task',resource_id:f.resource.id,operation_id:request.operationId});
    expect(history.some((row:any)=>row.payload.commentId===reply.commentId&&row.payload.note.includes('Retained joint response'))).toBe(true);
    expect(await f.sponsor.table('co_managed_archive_files').where({project_task_id:f.resource.id,attachment_id:file.attachmentId}).first()).toBeTruthy();
  }));
  it('task thread private disclosure rechecks the session after transport before publishing any customer content',async()=>run(async f=>{
    const root=await f.add(f.principal,'organization_private');await f.attach(f.principal,root);const request=f.request(await f.review(f.principal,root));
    await f.sponsor.table('sessions').where('session_id',f.principal.sessionId).update({expires_at:new Date(Date.now()+500)});
    await expect(f.discloseCoManagedPrivateThread(f.db,f.principal,f.resource,request,{download:f.download,upload:async(path:string,bytes:Uint8Array)=>{f.objects.set(path,bytes);await new Promise(resolve=>setTimeout(resolve,650));}},f.after)).rejects.toMatchObject({code:'CO_MANAGED_SHARED_WORK_FORBIDDEN'});
    expect(await f.customer.table('project_task_comments').where('thread_id',request.operationId)).toEqual([]);
    const row=await f.sponsor.table('co_management_thread_transfers').where('operation_id',request.operationId).first();expect(row.status).toBe('prepared');expect(row.manifest[0].copied).toBe(false);
  }));
}
