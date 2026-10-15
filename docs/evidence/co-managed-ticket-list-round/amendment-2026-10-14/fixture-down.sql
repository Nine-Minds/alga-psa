begin;
create temp table _ids on commit drop as select ticket_id from tickets where title like 'F021 fixture%';
delete from co_management_ticket_routing_events where ticket_id in (select ticket_id from _ids);
delete from co_management_ticket_work where ticket_id in (select ticket_id from _ids);
delete from co_managed_ticket_references where ticket_id in (select ticket_id from _ids);
delete from tickets where ticket_id in (select ticket_id from _ids);
commit;
