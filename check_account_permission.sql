-- SQL Query to diagnose why a user cannot see the Account option in avatar dropdown
-- Replace 'USER_EMAIL_HERE' with the user's email address, or use the user_id version below

-- ============================================================================
-- VERSION 1: Query by Email
-- ============================================================================
WITH user_info AS (
  SELECT 
    u.tenant,
    u.user_id,
    u.email,
    u.first_name,
    u.last_name,
    u.user_type,
    u.is_inactive
  FROM users u
  WHERE u.email = 'USER_EMAIL_HERE'  -- Replace with actual email
),
user_roles AS (
  SELECT DISTINCT
    ui.*,
    r.role_id,
    r.role_name,
    r.msp AS role_msp,
    r.client AS role_client
  FROM user_info ui
  INNER JOIN user_roles ur ON ur.tenant = ui.tenant AND ur.user_id = ui.user_id
  INNER JOIN roles r ON r.tenant = ur.tenant AND r.role_id = ur.role_id
),
account_permissions AS (
  SELECT DISTINCT
    ur.*,
    p.permission_id,
    p.resource,
    p.action,
    p.msp AS permission_msp,
    p.client AS permission_client
  FROM user_roles ur
  INNER JOIN role_permissions rp ON rp.tenant = ur.tenant AND rp.role_id = ur.role_id
  INNER JOIN permissions p ON p.tenant = rp.tenant AND p.permission_id = rp.permission_id
  WHERE p.resource = 'account_management' AND p.action = 'read'
)
SELECT 
  -- User Information
  ui.user_id,
  ui.email,
  ui.first_name || ' ' || ui.last_name AS full_name,
  ui.user_type,
  ui.is_inactive,
  
  -- Role Information
  COALESCE(
    string_agg(DISTINCT ur.role_name, ', ' ORDER BY ur.role_name),
    'No roles assigned'
  ) AS user_roles,
  COALESCE(
    string_agg(DISTINCT 
      CASE 
        WHEN ur.role_msp = true AND ur.role_client = false THEN ur.role_name || ' (MSP only)'
        WHEN ur.role_msp = false AND ur.role_client = true THEN ur.role_name || ' (Client only)'
        WHEN ur.role_msp = true AND ur.role_client = true THEN ur.role_name || ' (MSP & Client)'
        ELSE ur.role_name || ' (Unknown)'
      END, 
      ', ' ORDER BY ur.role_name
    ),
    'No roles'
  ) AS role_details,
  
  -- Permission Check Results
  CASE 
    WHEN COUNT(ap.permission_id) > 0 THEN 'YES - Has account_management permission'
    ELSE 'NO - Missing account_management permission'
  END AS has_account_permission,
  
  -- Detailed Permission Info
  COALESCE(
    string_agg(DISTINCT 
      ap.role_name || ' → ' || ap.resource || '.' || ap.action || 
      ' (MSP: ' || ap.permission_msp || ', Client: ' || ap.permission_client || ')',
      ' | '
    ),
    'None'
  ) AS permission_details,
  
  -- Diagnosis
  CASE 
    WHEN ui.user_type = 'client' THEN '❌ User is a CLIENT user - account_management is MSP-only'
    WHEN ui.is_inactive = true THEN '❌ User is INACTIVE'
    WHEN COUNT(ap.permission_id) = 0 AND COUNT(ur.role_id) = 0 THEN '❌ User has NO ROLES assigned'
    WHEN COUNT(ap.permission_id) = 0 AND COUNT(ur.role_id) > 0 THEN '❌ User has roles but NONE have account_management permission'
    WHEN COUNT(ap.permission_id) > 0 THEN '✅ User SHOULD see Account option - check browser console for errors'
    ELSE '⚠️ Unknown issue'
  END AS diagnosis

FROM user_info ui
LEFT JOIN user_roles ur ON ur.user_id = ui.user_id AND ur.tenant = ui.tenant
LEFT JOIN account_permissions ap ON ap.user_id = ui.user_id AND ap.tenant = ui.tenant
GROUP BY 
  ui.user_id, 
  ui.email, 
  ui.first_name, 
  ui.last_name, 
  ui.user_type, 
  ui.is_inactive;

-- ============================================================================
-- VERSION 2: Query by User ID (if you have the user_id UUID)
-- ============================================================================
/*
WITH user_info AS (
  SELECT 
    u.tenant,
    u.user_id,
    u.email,
    u.first_name,
    u.last_name,
    u.user_type,
    u.is_inactive
  FROM users u
  WHERE u.user_id = 'USER_ID_HERE'::uuid  -- Replace with actual user_id
),
user_roles AS (
  SELECT DISTINCT
    ui.*,
    r.role_id,
    r.role_name,
    r.msp AS role_msp,
    r.client AS role_client
  FROM user_info ui
  INNER JOIN user_roles ur ON ur.tenant = ui.tenant AND ur.user_id = ui.user_id
  INNER JOIN roles r ON r.tenant = ur.tenant AND r.role_id = ur.role_id
),
account_permissions AS (
  SELECT DISTINCT
    ur.*,
    p.permission_id,
    p.resource,
    p.action,
    p.msp AS permission_msp,
    p.client AS permission_client
  FROM user_roles ur
  INNER JOIN role_permissions rp ON rp.tenant = ur.tenant AND rp.role_id = ur.role_id
  INNER JOIN permissions p ON p.tenant = rp.tenant AND p.permission_id = rp.permission_id
  WHERE p.resource = 'account_management' AND p.action = 'read'
)
SELECT 
  ui.user_id,
  ui.email,
  ui.first_name || ' ' || ui.last_name AS full_name,
  ui.user_type,
  ui.is_inactive,
  COALESCE(string_agg(DISTINCT ur.role_name, ', ' ORDER BY ur.role_name), 'No roles assigned') AS user_roles,
  CASE 
    WHEN COUNT(ap.permission_id) > 0 THEN 'YES'
    ELSE 'NO'
  END AS has_account_permission,
  COALESCE(string_agg(DISTINCT ap.role_name || ' → ' || ap.resource || '.' || ap.action, ' | '), 'None') AS permission_details,
  CASE 
    WHEN ui.user_type = 'client' THEN '❌ User is a CLIENT user - account_management is MSP-only'
    WHEN ui.is_inactive = true THEN '❌ User is INACTIVE'
    WHEN COUNT(ap.permission_id) = 0 AND COUNT(ur.role_id) = 0 THEN '❌ User has NO ROLES assigned'
    WHEN COUNT(ap.permission_id) = 0 AND COUNT(ur.role_id) > 0 THEN '❌ User has roles but NONE have account_management permission'
    WHEN COUNT(ap.permission_id) > 0 THEN '✅ User SHOULD see Account option'
    ELSE '⚠️ Unknown issue'
  END AS diagnosis
FROM user_info ui
LEFT JOIN user_roles ur ON ur.user_id = ui.user_id AND ur.tenant = ui.tenant
LEFT JOIN account_permissions ap ON ap.user_id = ui.user_id AND ap.tenant = ui.tenant
GROUP BY ui.user_id, ui.email, ui.first_name, ui.last_name, ui.user_type, ui.is_inactive;
*/

-- ============================================================================
-- BONUS: Check if Admin role has the permission (for comparison)
-- ============================================================================
/*
SELECT 
  r.tenant,
  r.role_name,
  r.msp AS role_msp,
  r.client AS role_client,
  p.resource,
  p.action,
  p.msp AS permission_msp,
  p.client AS permission_client,
  CASE 
    WHEN p.permission_id IS NOT NULL THEN '✅ Has permission'
    ELSE '❌ Missing permission'
  END AS status
FROM roles r
LEFT JOIN role_permissions rp ON rp.tenant = r.tenant AND rp.role_id = r.role_id
LEFT JOIN permissions p ON p.tenant = rp.tenant AND p.permission_id = rp.permission_id 
  AND p.resource = 'account_management' AND p.action = 'read'
WHERE r.role_name = 'Admin' AND r.msp = true
ORDER BY r.tenant;
*/
