-- Owned draft fixture cloned from generated INV-000039 (3 recurring products).
-- Remaps invoice, charges, canonical period-detail IDs, and any fixed-detail rows.
-- Execute once against database server through host port 5472.
BEGIN;
CREATE TEMP TABLE smoke_item_map(old_id uuid PRIMARY KEY, new_id uuid NOT NULL UNIQUE) ON COMMIT DROP;
INSERT INTO smoke_item_map(old_id,new_id)
SELECT item_id, gen_random_uuid()
FROM invoice_charges
WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
  AND invoice_id='d8816325-32a7-4a58-b000-ff987b99f6fe';
INSERT INTO invoices
SELECT (jsonb_populate_record(i, to_jsonb(i) || jsonb_build_object(
  'invoice_id','5a1e0000-0000-4000-8000-202609279004'::uuid,
  'invoice_number','TAKEOVER-POSTED-20260927',
  'status','draft',
  'created_at',now(), 'updated_at',now(), 'finalized_at',NULL,
  'draft_adjustment_revision',0
))).*
FROM invoices i
WHERE i.tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
  AND i.invoice_id='d8816325-32a7-4a58-b000-ff987b99f6fe';
INSERT INTO invoice_charges
SELECT (jsonb_populate_record(c, to_jsonb(c) || jsonb_build_object(
  'item_id',m.new_id,
  'invoice_id','5a1e0000-0000-4000-8000-202609279004'::uuid,
  'applies_to_item_id',coalesce(remapped.new_id,c.applies_to_item_id),
  'created_at',now(), 'updated_at',now()
))).*
FROM invoice_charges c
JOIN smoke_item_map m ON m.old_id=c.item_id
LEFT JOIN smoke_item_map remapped ON remapped.old_id=c.applies_to_item_id;
CREATE TEMP TABLE smoke_detail_map(old_id uuid PRIMARY KEY, new_id uuid NOT NULL UNIQUE) ON COMMIT DROP;
INSERT INTO smoke_detail_map(old_id,new_id)
SELECT item_detail_id,gen_random_uuid()
FROM invoice_charge_details
WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9'
  AND item_id IN (SELECT old_id FROM smoke_item_map);
INSERT INTO invoice_charge_details
SELECT (jsonb_populate_record(d, to_jsonb(d) || jsonb_build_object(
  'item_detail_id',dm.new_id,'item_id',im.new_id,'created_at',now(),'updated_at',now()
))).*
FROM invoice_charge_details d
JOIN smoke_detail_map dm ON dm.old_id=d.item_detail_id
JOIN smoke_item_map im ON im.old_id=d.item_id;
INSERT INTO invoice_charge_fixed_details
SELECT (jsonb_populate_record(f, to_jsonb(f) || jsonb_build_object('item_detail_id',dm.new_id))).*
FROM invoice_charge_fixed_details f
JOIN smoke_detail_map dm ON dm.old_id=f.item_detail_id;
INSERT INTO transactions(tenant,transaction_id,client_id,invoice_id,type,status,amount,balance_after,created_at,currency_code,description)
SELECT i.tenant,'5a1e0000-0000-4000-8000-202609279005',i.client_id,i.invoice_id,'invoice_generated','completed',i.total_amount,
coalesce((SELECT balance_after FROM transactions t WHERE t.tenant=i.tenant AND t.client_id=i.client_id ORDER BY created_at DESC LIMIT 1),0)+i.total_amount,
clock_timestamp(),i.currency_code,'Owned takeover fixture generation'
FROM invoices i WHERE tenant='6d178771-ad9a-4d43-8809-83992745f8f9' AND invoice_id='5a1e0000-0000-4000-8000-202609279004';
COMMIT;
