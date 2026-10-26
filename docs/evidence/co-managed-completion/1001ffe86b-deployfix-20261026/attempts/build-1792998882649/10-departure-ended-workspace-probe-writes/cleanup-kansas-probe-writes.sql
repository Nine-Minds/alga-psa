-- Remove the three rows the guide 10 direct-write probe created in the ended Kansas Farms workspace on
-- build-1792998882649 (checklist item, external link, organization-private comment + thread) and their audit
-- and outbox rows. The defect (no lifecycle admission on these writers) is fixed in the following commit.
-- workflow_runtime_events are kept as the trail of what happened.
begin;
delete from ticket_audit_logs where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and created_at > '2026-10-26T07:34:00Z'
  and audit_id in ('1b5ea8f4-20b0-4bb4-a9f9-f903a4de430b','1c9267b8-9859-497f-b38b-d8d6c382af3e');
delete from co_management_event_consumers where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and event_id in (select event_id from co_management_event_outbox where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and comment_id='a022fd44-d025-42af-b4e3-1e32cee83921');
delete from co_management_event_outbox where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and comment_id='a022fd44-d025-42af-b4e3-1e32cee83921';
delete from ticket_checklist_items where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and checklist_item_id='8b578a73-8d42-40d3-bb58-92676269762c';
delete from external_entity_links where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and link_id='1c95765a-a482-4349-80ac-41083d6dd49e';
delete from comments where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and comment_id='a022fd44-d025-42af-b4e3-1e32cee83921';
delete from comment_threads where tenant='3261f313-8e04-45df-94bc-0343e92ba454' and thread_id='6116a87f-42cc-4948-ad95-5538e64c34d6';
commit;
