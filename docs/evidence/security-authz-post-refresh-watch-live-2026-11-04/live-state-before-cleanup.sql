select count(*) filter (where id::text like '31000000-%') as provider_fixture_rows from email_providers;
select count(*) filter (where user_id::text in ('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000012')) as session_fixture_rows from sessions;
select id, provider_type, is_active, status from email_providers where id::text in ('31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000003');
