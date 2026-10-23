BEGIN;
INSERT INTO contract_template_line_services(tenant,template_line_id,service_id,quantity,custom_rate,display_order)
VALUES('6d178771-ad9a-4d43-8809-83992745f8f9','5a1e0000-0000-4000-8000-202609279002','eea664f8-6928-4bed-86b1-b83855f2d81c',1,10000,0),
('6d178771-ad9a-4d43-8809-83992745f8f9','5a1e0000-0000-4000-8000-202609279003','f075c46d-7a54-423e-809e-6a79c28dba1c',1,20000,0);
INSERT INTO contract_template_line_service_configuration(tenant,config_id,template_line_id,service_id,configuration_type,custom_rate,quantity)
SELECT tenant,gen_random_uuid(),template_line_id,service_id,'Fixed',custom_rate,quantity FROM contract_template_line_services WHERE template_line_id IN ('5a1e0000-0000-4000-8000-202609279002','5a1e0000-0000-4000-8000-202609279003');
UPDATE contract_templates SET template_status='published' WHERE template_id='5a1e0000-0000-4000-8000-202609279001';
COMMIT;
