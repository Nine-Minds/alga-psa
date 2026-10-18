-- Safe only for the uniquely owned invoice ID created by controlled-fixture-create.sql.
begin;
delete from invoice_adjustment_operations where invoice_id='5a1e0000-0000-4000-8000-202609270001';
delete from invoice_charges where invoice_id='5a1e0000-0000-4000-8000-202609270001';
delete from invoices where invoice_id='5a1e0000-0000-4000-8000-202609270001';
commit;
