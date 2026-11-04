-- Deletes only the controlled draft and its owned charge/detail rows.
BEGIN;
-- These draft-only rows were created by the historical recalculation bug;
-- remove only transactions whose invoice and description match this fixture.
DELETE FROM transactions
WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
 AND invoice_id='5a1e0000-0000-4000-8000-202609270002'
 AND type='invoice_adjustment'
 AND description='Adjusted invoice SMOKE-ADJ-CURRENT-20260927';
DELETE FROM invoice_charges
WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
 AND invoice_id='5a1e0000-0000-4000-8000-202609270002'
 AND EXISTS (SELECT 1 FROM invoices i WHERE i.tenant=invoice_charges.tenant
   AND i.invoice_id=invoice_charges.invoice_id
   AND i.invoice_number='SMOKE-ADJ-CURRENT-20260927' AND i.status='draft');
DELETE FROM invoices WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
 AND invoice_id='5a1e0000-0000-4000-8000-202609270002'
 AND invoice_number='SMOKE-ADJ-CURRENT-20260927'
 AND status='draft';
COMMIT;
