# Recovering the missing Nine Minds support-portal user

Use this runbook when a customer who should have Nine Minds Support Portal
access has a contact record in the management tenant but no linked portal
login. The known incident is the CloudVBS onboarding (card
`276a5f54-a4e4-45b5-b500-76e93cb0841e`), where tenant creation skipped the
portal step because the customer's client already existed.

The code fix in `ee/temporal-workflows` makes future onboardings create or
reuse the portal user correctly. This procedure is **for a human operator to
run against the production management tenant, later** — it repairs the
already-provisioned customer and is not part of the code change. **Do not fold
it into a deploy, and do not run it from an automated step.** The incident
remains open until the affected user has signed in successfully; only then is
it resolved.

## Target (confirmed)

| What | Value |
| --- | --- |
| Management tenant (`Nine Minds LLC`) | `55f6a1b8-8ad9-42c7-ba39-a508dcaecd37` |
| Client | `8785fc7c-5004-4413-902a-aa96c364c051` |
| Contact | `d78d1809-ad15-479c-97da-a167329ff6d5` |

Every step below is scoped to that tenant. Do not run anything against other
tenants, and do not use unscoped queries.

## Guardrails

- Create only. Never update an existing portal user's `hashed_password`, role
  grants, or activation state.
- Re-runnable. Running the procedure twice must be a no-op the second time.
- Do not delete or roll back unrelated records.
- Do not paste temporary passwords into tickets, chat, or logs. Deliver them
  through the incident channel and have the user change the password at first
  sign-in.

## Preflight (read-only)

Run these first. All three queries must be tenant-scoped.

```sql
-- 1. Confirm the contact and capture its email.
SELECT contact_name_id, full_name, email, client_id
FROM contacts
WHERE tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37'
  AND contact_name_id = 'd78d1809-ad15-479c-97da-a167329ff6d5'
  AND client_id = '8785fc7c-5004-4413-902a-aa96c364c051';

-- 2. Is a client-portal user already present for that email?
SELECT user_id, email, user_type, is_inactive, contact_id
FROM users
WHERE tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37'
  AND user_type = 'client'
  AND lower(email) = lower('<email from query 1>');

-- 3. Which role will the portal user receive?
SELECT role_id, role_name
FROM roles
WHERE tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37'
  AND client = true
  AND msp = false
  AND lower(role_name) = 'admin';
```

If query 2 returns a row, the portal account already exists. Do not run the
recovery; go straight to verification and investigate why the customer could
not sign in.

## Procedure

`ee/temporal-workflows/src/scripts/recover-nineminds-portal-user.ts` performs
the recovery using the same shared model the application uses, so password
hashing and role selection match production. It refuses to run without an
explicit confirmation flag, checks for an existing portal user first, and only
touches the configured tenant.

From `ee/temporal-workflows`, with the production database environment loaded:

```bash
CONFIRM_NINEMINDS_PORTAL_RECOVERY=yes npx tsx src/scripts/recover-nineminds-portal-user.ts
```

Expected output:

- A portal user that already exists: prints the existing `user_id` and makes no
  changes.
- No portal user: prints the new `user_id` and a one-time temporary password.

The password shown is the one the customer uses for their first sign-in. If
they cannot use it, use the standard portal password-reset flow rather than
editing the database.

### If the script cannot be run

Create and link the portal user through the management tenant admin UI instead:
open the client, open the contact, and use the portal-access action. That path
produces the same user row and role grant. Do not hand-edit `users` or
`user_roles`; the password hash is not reproducible outside the application.

## Verification

Do not close the incident on the script's output alone.

1. Confirm the user row exists, is active, and is linked to the contact:

   ```sql
   SELECT u.user_id, u.email, u.is_inactive, u.contact_id, ur.role_id
   FROM users u
   JOIN user_roles ur ON ur.user_id = u.user_id AND ur.tenant = u.tenant
   WHERE u.tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37'
     AND u.user_type = 'client'
     AND u.contact_id = 'd78d1809-ad15-479c-97da-a167329ff6d5';
   ```

2. Have the customer sign in to `https://portal.nineminds.com/auth/client-portal/signin`
   with the portal credentials. A successful sign-in and password change is the
   acceptance signal.

3. Record the verification (time, who verified, outcome) on the incident.

## Rollback

Only if the recovery created the wrong account, delete exactly that new user
and its role link — never a pre-existing account:

```sql
-- Replace :new_user_id with the user_id printed by the recovery.
DELETE FROM user_roles
WHERE user_id = :new_user_id
  AND tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37';

DELETE FROM users
WHERE user_id = :new_user_id
  AND tenant = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37'
  AND user_type = 'client';
```

## Do not rerun the whole onboarding

Rerunning tenant creation is **not** a recovery path. The customer tenant and
its admin user already exist, so `createAdminUser` fails with the internal-user
email uniqueness error (*"Each internal user email must be unique across all
tenants."*). That failure is not classified as non-retryable, so the workflow
retries it until the run times out
and never reaches customer tracking — it neither reuses the management-tenant
client nor provisions the portal user. Use the targeted recovery procedure
above instead.

## Onboarding refusals an operator must resolve

Two deliberate refusals mean the workflow declined to link a customer rather
than guess. Both leave tenant creation successful (the customer's own workspace
still exists); only the Nine Minds Support Portal step is left unprovisioned.
Neither is fixed by rerunning the onboarding.

### `UnverifiedCustomerMatchError`

The management tenant already has a client with the exact onboarding company
name, but nothing ties it to this onboarding admin: no contact or portal user
with the admin's email, and no `onboarding_association` marker in the client's
`properties` whose `admin_email` (or `tenant_uuid`) matches this run. The
workflow refuses because a bare name match is how an
unrelated signup could be linked to — and granted portal access under — a
stranger's record (the Harbor Point name-collision incident).

A retry of an older partial onboarding can also land here: a client created
before the association marker existed, with no contact yet, presents no trusted
association and is refused. That is intentional; do not "fix" it by loosening
the trust rule.

Operator procedure:

1. Confirm out-of-band that the existing client is in fact this signup's
   company: check the signup domain/email against the client's contacts and
   contract. Do not trust the name alone.
2. If it is the same company, link the association: open the existing client in
   the management-tenant admin UI and add the onboarding admin as a contact
   (same email), or record the `onboarding_association.admin_email` marker in
   the client's `properties`. Then run the targeted recovery above.
3. If it is genuinely a different company with a colliding name, the signup
   needs its own client. Resolve the collision first (rename the incoming
   tenant/client or the existing record as appropriate) before retrying the
   onboarding.

### `PortalUserIdentityMismatchError`

A client-portal account already exists for the admin email, but it is linked to
a different contact and client than the ones this run resolved. The workflow
refuses to return that account as the customer's access because doing so would
report working portal access for a different customer. Nothing is mutated: no
password reset, no role change.

Operator procedure:

1. Read the existing account's linkage (query 2 in Preflight, plus its
   `contact_id`).
2. If the email legitimately belongs to this customer, reconcile the linkage
   out-of-band — point the existing account at the resolved contact/client, or
   move the contact to the correct client — then run the targeted recovery.
3. If the email belongs to another customer, do not repoint it. Give this
   signup a distinct admin email and retry, or provision a fresh portal account
   through the recovery script under the resolved contact.

