# Google Cloud Prerequisites for Gmail Inbound Email

Gmail delivers inbound mail to Alga by publishing a notification to a Pub/Sub topic, which pushes an HTTPS request to this instance. Six things have to be true in Google Cloud before that chain works. Alga provisions the topic and subscription itself; everything below is what it cannot create on your behalf.

Work through this before adding a Gmail provider under **Settings → Email Providers**. If a mailbox is already connected and mail has stopped, run **Run Gmail Delivery Diagnostics** from the provider card menu — it checks each item here against live Google state and names the one that is wrong.

## 1. A Google Cloud project with two APIs enabled

Create or pick a project, then enable:

- **Gmail API** — for the mailbox watch and message reads.
- **Cloud Pub/Sub API** — for the topic and push subscription.

Note the **project ID** (not the display name). Alga stores it per tenant and uses it to address every resource below.

## 2. An OAuth client for the mailbox

Create an **OAuth 2.0 Client ID** of type *Web application*. Its authorized redirect URI must exactly match the one shown in **Settings → Integrations → Providers** — typically `https://<your-alga-host>/api/auth/google/callback`.

Keep the client ID and client secret; both go into the Google integration screen.

## 3. A published consent screen

Configure the OAuth consent screen and then **publish** it.

This is the single most common cause of a Gmail provider that works for a week and then dies. While the consent screen is in **Testing**, Google expires refresh tokens after **seven days**. When that happens the mailbox stops ingesting and the provider reports an authentication failure that no amount of reconnecting will fix for longer than another week.

An internal-only consent screen (available on Google Workspace) is published by definition and does not have this limit.

## 4. A service account key for Pub/Sub provisioning

Create a service account in the same project and download a **JSON key**. Alga authenticates as this service account to create the topic and subscription, and Google signs each push with its identity.

Grant it on the project:

- `roles/pubsub.admin` — or, if you prefer narrower grants, permissions covering `pubsub.topics.create`, `pubsub.topics.get`, `pubsub.topics.getIamPolicy`, `pubsub.topics.setIamPolicy`, `pubsub.subscriptions.create`, `pubsub.subscriptions.get`, and `pubsub.subscriptions.update`.

The `setIamPolicy` permissions matter more than they look: Alga uses them to complete step 5, and setup fails outright without them.

## 5. Publisher rights for Gmail's own service account

Gmail publishes as `gmail-api-push@system.gserviceaccount.com`. That account needs `roles/pubsub.publisher` on the tenant's topic (`gmail-notifications-<tenant-id>`).

Alga grants this automatically during setup using the key from step 4. Grant it by hand only if you have deliberately withheld `setIamPolicy` from that service account.

Without this binding, Gmail rejects the watch registration and no notification is ever published — the mailbox looks configured and stays empty.

## 6. A publicly reachable HTTPS address for this Alga instance

Pub/Sub push only delivers to a public HTTPS endpoint with a resolvable name. Alga derives that address from the first of these that is set, checking both the environment and the app secret store:

1. `NGROK_URL`
2. `NEXT_PUBLIC_BASE_URL`
3. `NEXTAUTH_URL`
4. `PUBLIC_WEBHOOK_BASE_URL`

The resolved value becomes both the push endpoint and the OIDC audience Google signs its token with — and the audience this instance checks that token against. The two are generated from the same normalization (lowercase scheme and host, no default port, no trailing slash), so they agree as long as the address itself is right.

Change the address later and existing subscriptions keep pushing to the old one, where every request is rejected as unauthorized. After any hostname change, run **Refresh Pub/Sub & Watch** on each Gmail provider.

Setup refuses to provision against `localhost`, a private network address, or a plain-HTTP URL, because Google could never deliver there. For local development, an ngrok tunnel in `NGROK_URL` is a supported way to get a real public address.

## Keeping delivery alive

A Gmail watch expires **seven days** after it is registered. Enterprise Edition renews watches on a schedule. Community Edition does not: the provider card warns as expiry approaches and again once it has passed, and **Refresh Pub/Sub & Watch** re-registers it. Plan on doing that weekly, or watch for the warning.

## When something is wrong

**Run Gmail Delivery Diagnostics** (provider card menu) reports each of the following as pass, warn, or fail, with what to do about it:

- the public base URL this instance resolved, and where it came from
- the tenant's service account key
- the Pub/Sub topic
- the publisher binding for `gmail-api-push@system.gserviceaccount.com`
- the subscription's push endpoint and OIDC audience, showing expected and actual values side by side when they differ
- the Gmail watch and its expiry
- when a push was last accepted
