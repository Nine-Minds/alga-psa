-- F021 / callout fixture: clones the CURRENT state of shared ticket 000002 (escalated, unassigned) into N extra tickets.
-- Mirrors the escalation rows: tickets (White Rabbit IT), co_managed_ticket_references + co_management_ticket_work (Oz), one 'escalated' routing event.
-- Remove with fixture-down.sql (deletes by title prefix 'F021 fixture').
begin;
do $$
declare
  src uuid := 'cfff4242-7962-4100-a54c-687eaa540500';
  n int; tid uuid; wid uuid; cols text; 
begin
  for n in 1..:N loop
    tid := gen_random_uuid(); wid := gen_random_uuid();
    select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns where table_name='tickets' and table_schema='public' and is_generated='NEVER';
    execute format('create temp table _t on commit drop as select %s from tickets where ticket_id=%L', cols, src);
    update _t set ticket_id=tid, ticket_number=lpad((100+n)::text,6,'0'), title='F021 fixture '||lpad(n::text,2,'0')||' shared ticket', entered_at=now()-(n||' minutes')::interval, updated_at=now()-(n||' minutes')::interval;
    execute format('insert into tickets (%s) select %s from _t', cols, cols);
    drop table _t;

    select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns where table_name='co_managed_ticket_references' and table_schema='public' and is_generated='NEVER';
    execute format('create temp table _r on commit drop as select %s from co_managed_ticket_references where ticket_id=%L', cols, src);
    update _r set ticket_id=tid, work_id=wid, reference_id=gen_random_uuid();
    execute format('insert into co_managed_ticket_references (%s) select %s from _r', cols, cols);
    drop table _r;

    select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns where table_name='co_management_ticket_work' and table_schema='public' and is_generated='NEVER';
    execute format('create temp table _w on commit drop as select %s from co_management_ticket_work where ticket_id=%L', cols, src);
    update _w set ticket_id=tid, work_id=wid;
    execute format('insert into co_management_ticket_work (%s) select %s from _w', cols, cols);
    drop table _w;

    select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns where table_name='co_management_ticket_routing_events' and table_schema='public' and is_generated='NEVER';
    execute format('create temp table _e on commit drop as select %s from co_management_ticket_routing_events where ticket_id=%L and transition=''escalated'' and tenant=''24ac76c8-df59-4b10-8371-c56222904580'' order by work_revision limit 1', cols, src);
    update _e set ticket_id=tid, event_id=gen_random_uuid(), work_revision=1;
    execute format('insert into co_management_ticket_routing_events (%s) select %s from _e', cols, cols);
    drop table _e;
  end loop;
end $$;
commit;
