select 'users' as fixture,count(*) from users where user_id in ('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000012') union all
select 'roles',count(*) from roles where role_id in ('31000000-0000-4000-8000-000000000010','31000000-0000-4000-8000-000000000013') union all
select 'providers',count(*) from email_providers where id::text in ('31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003') union all
select 'google_config',count(*) from google_email_provider_config where email_provider_id::text in ('31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003') union all
select 'sessions',count(*) from sessions where user_id in ('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000012') union all
select 'user_preferences',count(*) from user_preferences where user_id in ('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000012');
