BEGIN;
INSERT INTO contract_templates(tenant,template_id,template_name,default_billing_frequency,template_status,template_metadata)
VALUES ('6d178771-ad9a-4d43-8809-83992745f8f9','5a1e0000-0000-4000-8000-202609279001','TAKEOVER Discount Copy 20260927','monthly','draft','{}');
INSERT INTO contract_template_lines(tenant,template_line_id,template_id,template_line_name,billing_frequency,line_type,is_active,display_order,custom_rate,billing_timing,cadence_owner)
VALUES ('6d178771-ad9a-4d43-8809-83992745f8f9','5a1e0000-0000-4000-8000-202609279002','5a1e0000-0000-4000-8000-202609279001','Takeover fixed A','monthly','Fixed',true,0,10000,'advance','client'),
('6d178771-ad9a-4d43-8809-83992745f8f9','5a1e0000-0000-4000-8000-202609279003','5a1e0000-0000-4000-8000-202609279001','Takeover fixed B','monthly','Fixed',true,1,20000,'advance','client');
COMMIT;
