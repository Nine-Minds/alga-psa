# Appliance Initial Tenant Setup

## Problem

Ubuntu/k3s appliance setup can finish with healthy Flux/Helm infrastructure but no tenant or admin user. The onboarding seed set expects a tenant to exist, so first boot is not login-ready.

## Goals

- Require first tenant/admin details during appliance setup.
- Require the installer to capture an admin password chosen by the user.
- Persist setup inputs securely on the host and pass them to Kubernetes bootstrap.
- Create the initial tenant/admin before onboarding seeds run.
- Fail bootstrap clearly if no user exists and required initial tenant inputs are missing.

## Non-goals

- Reintroduce demo/dev seed data.
- Build a general multi-tenant management UI.
- Generate or display a temporary password after setup.

## Primary Flow

1. User opens the appliance setup URL with the setup token.
2. User enters app/network settings plus company name and admin credentials.
3. Host service validates and stores setup inputs root-only.
4. Host service creates a Kubernetes Secret for initial tenant bootstrap.
5. Helm bootstrap Job runs migrations, creates the tenant/admin when users are absent, then runs onboarding seeds.
6. User logs in with the admin email/password they supplied.

## Acceptance Criteria

- Setup UI requires company/admin fields and confirms password before submission.
- Host service rejects missing/invalid tenant/admin inputs.
- Password is not written to install-state status data.
- Bootstrap Job creates a tenant and admin user when `users` is empty.
- Onboarding seeds run after tenant creation.
- Existing installations with users skip initial tenant creation.
