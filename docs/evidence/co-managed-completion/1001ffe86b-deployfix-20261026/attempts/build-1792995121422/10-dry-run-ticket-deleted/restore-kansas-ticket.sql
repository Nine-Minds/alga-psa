-- Restore the Kansas Farms IT fixture ticket deleted at 2026-10-26T06:44:01Z by a dry-run direct
-- deleteTicket server-action POST (the defect: ticket deletion bypassed the read-only lifecycle).
-- Values come from the original TICKET_CREATED / TAG_APPLIED / OUTBOUND_EMAIL_SENT workflow events,
-- the pre-deletion DB reads of this session and the 8c96987ab5 tag receipt.
begin;
insert into tickets (tenant, ticket_id, ticket_number, title, status_id, priority_id, entered_by, entered_at, updated_at,
  is_closed, attributes, email_metadata, board_id, client_id, source, ticket_origin, status_changed_at, escalated, sla_total_pause_minutes)
values ('3261f313-8e04-45df-94bc-0343e92ba454', '0a767ca1-0f61-4817-a1af-e8d4183ff402', '000001', 'Kansas Farms barn Wi-Fi drops',
  'edd6e44e-45b6-496d-b5d3-d14dc79d8086', '9aea4856-4120-4f98-a0c1-e25b5a4fcb8e', '6d4bb919-9ac4-470a-8928-314043d1a613',
  '2026-10-26T00:11:55.165Z', '2026-10-26T00:12:03.642Z', false,
  '{"description": "[{\"type\":\"paragraph\",\"props\":{\"textAlignment\":\"left\",\"backgroundColor\":\"default\",\"textColor\":\"default\"},\"content\":[{\"type\":\"text\",\"text\":\"\",\"styles\":{}}]}]"}'::jsonb,
  '{"references": ["<4677dc52-a274-413a-9262-53bc959edc85@alga.test>", "<7f46ceac-6ae9-4f16-b387-95f59f06dd4e@alga.test>"], "threadRoot": "<ticket-0a767ca1-0f61-4817-a1af-e8d4183ff402@alga.test>"}'::jsonb,
  '0e1ee331-287e-4359-8b2f-bc83259767d7', '75dda991-66ad-4ecd-8329-7f7dd9f75c25', 'web_app', 'internal', '2026-10-26T00:11:55.165Z', false, 0);
insert into ticket_audit_logs (tenant, audit_id, ticket_id, event_type, entity_type, entity_id, actor_type, actor_user_id, actor_display_name, source, occurred_at, changes, details, created_at)
values ('3261f313-8e04-45df-94bc-0343e92ba454', gen_random_uuid(), '0a767ca1-0f61-4817-a1af-e8d4183ff402', 'TICKET_CREATED', 'ticket', '0a767ca1-0f61-4817-a1af-e8d4183ff402',
  'user', '6d4bb919-9ac4-470a-8928-314043d1a613', 'Dorothy Gale', 'ui', '2026-10-26T00:11:55.165Z', '{}'::jsonb,
  '{"title": "Kansas Farms barn Wi-Fi drops", "board_id": "0e1ee331-287e-4359-8b2f-bc83259767d7", "client_id": "75dda991-66ad-4ecd-8329-7f7dd9f75c25", "status_id": "edd6e44e-45b6-496d-b5d3-d14dc79d8086", "assigned_to": null, "priority_id": "9aea4856-4120-4f98-a0c1-e25b5a4fcb8e", "ticket_origin": "internal"}'::jsonb,
  '2026-10-26T00:11:55.17Z');
insert into tag_definitions (tenant, tag_id, tag_text, tagged_type, background_color, text_color, created_at, board_id)
values ('3261f313-8e04-45df-94bc-0343e92ba454', '89821814-ea4d-4568-a152-ccccf909dbe4', 'Barn network', 'ticket', '#d9ddfc', '#061479', '2026-10-26T00:12:03.634382+00:00', null);
insert into tag_mappings (tenant, mapping_id, tag_id, tagged_id, tagged_type, created_at, created_by)
values ('3261f313-8e04-45df-94bc-0343e92ba454', '04f57bd8-f312-4d7d-a4cc-8673ecd6a775', '89821814-ea4d-4568-a152-ccccf909dbe4', '0a767ca1-0f61-4817-a1af-e8d4183ff402', 'ticket', '2026-10-26T00:12:03.634382+00:00', '6d4bb919-9ac4-470a-8928-314043d1a613');
commit;
