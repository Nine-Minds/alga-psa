-- Configure the owned draft clone for the local internal tax engine so a
-- per-line tax-rate override can be calculated without an external tax vendor.
-- The genuine source invoice INV-000039 remains unchanged with its prior mode.
UPDATE invoices
SET tax_source='internal', updated_at=now()
WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
  AND invoice_id='5a1e0000-0000-4000-8000-202609270002'
  AND invoice_number='SMOKE-ADJ-CURRENT-20260927'
  AND status='draft';
