-- Run only after confirming the target is database server via PostgreSQL host port 5472.
-- This makes a separately owned copy. It does not update SMOKE-ADJ-1.
begin;
do $$ begin
  if exists(select 1 from invoices where invoice_number='SMOKE-ADJ-REPAIR-20260927') then
    raise exception 'controlled smoke invoice already exists';
  end if;
  if (select count(*) from invoices where invoice_id='5a1e0000-0000-4000-8000-0000000000a1') <> 1 then
    raise exception 'source fixture is not unique';
  end if;
end $$;
insert into invoices
select (jsonb_populate_record(null::invoices,
  to_jsonb(i) || jsonb_build_object(
    'invoice_id','5a1e0000-0000-4000-8000-202609270001',
    'invoice_number','SMOKE-ADJ-REPAIR-20260927',
    'created_at',now(),'updated_at',now(),'draft_adjustment_revision',0
  ))).*
from invoices i where i.invoice_id='5a1e0000-0000-4000-8000-0000000000a1';
insert into invoice_charges
select (jsonb_populate_record(null::invoice_charges,
  to_jsonb(c) || jsonb_build_object(
    'item_id',gen_random_uuid()::text,
    'invoice_id','5a1e0000-0000-4000-8000-202609270001',
    'created_at',now(),'updated_at',now()
  ))).*
from invoice_charges c where c.invoice_id='5a1e0000-0000-4000-8000-0000000000a1';
commit;
