# Custom Domain Setup — Reverse Proxy Setup (self-hosted)

This guide is for operators of a **self-hosted** Alga PSA install who want to serve the
**client portal**, the **MSP/technician app**, or **both** on a branded domain (a "vanity
domain") such as `portal.acme.com` or `helpdesk.acme.com`. It applies to Community Edition,
where custom domains work out of the box, and to Enterprise Edition running as the on-premise
appliance. Nothing below needs a configuration flag as long as your reverse proxy preserves the
original `Host` header.

Unlike the hosted cloud, a self-hosted server does **not** verify DNS, issue TLS certificates,
or configure ingress for you. You bring your own reverse proxy; the server just records the
domain and runs the portal's vanity behavior (branded sign-in, cross-domain session handoff,
branded links). When you enter a domain in Settings it activates **immediately** — so wire up
DNS and your proxy *first*.

## What you provide

1. **DNS** — a record that resolves your custom domain to your reverse proxy.
2. **A reverse proxy** that terminates TLS for the custom domain and forwards to the server
   on port `3000`, **preserving the original `Host` header** and setting `X-Forwarded-Proto`.
3. **A TLS certificate** for the custom domain (your proxy's responsibility — e.g. Let's
   Encrypt on the proxy, or a certificate you already manage).

## The contract (must-haves)

For the portal's cross-domain sign-in to work, the server must see the request as arriving
on the custom host over HTTPS. Your proxy must therefore send:

- `Host: portal.acme.com` — the original host. Caddy and Traefik preserve it by default;
  nginx needs `proxy_set_header Host $host;`.
- `X-Forwarded-Proto: https` — so the server sets secure cookies and builds `https://`
  redirects (it receives plain HTTP behind your TLS-terminating proxy).

### If your proxy cannot preserve `Host`

Some proxies rewrite `Host` to the upstream address. In that case have the proxy send the
original hostname in `X-Forwarded-Host: portal.acme.com` and tell the server to trust it:

- **Community Edition:** set `TRUST_FORWARDED_HOST=true` — in `.env` for Docker Compose, or
  `trustForwardedHost: true` in your Helm values (see the
  [configuration guide](../../getting-started/configuration_guide.md#reverse-proxy-host-trust-trust_forwarded_host)).
- **Enterprise Edition appliance:** nothing to set; `DEPLOYMENT_PROFILE=appliance` already
  trusts the header.

Read the security note below before enabling it.

## Security: the proxy is the trust boundary

Prefer forwarding `Host` unchanged and leaving forwarded-host trust off; the server then never
trusts a forwarded host header. With trust enabled, the server takes the first value of
`X-Forwarded-Host` as the request host. That is the only way to recover the original host when
a proxy rewrites `Host`, but it also means anyone who can send that header directly to the
server can pick which tenant's branded portal they are served. If you enable it, keep the
trust at your proxy:

- The proxy must **set** `Host` / `X-Forwarded-Host` itself (nginx `proxy_set_header`, Caddy
  `header_up`), which replaces whatever the client sent. Never configure it to append to or
  pass through a client-supplied `X-Forwarded-Host`.
- Port `3000` must be reachable **only from the proxy** (firewall, private network, or a
  container network that is not published).
- Do not enable forwarded-host trust on an install that is exposed without a proxy.

## Example: nginx

```nginx
server {
    listen 443 ssl;
    server_name portal.acme.com;

    ssl_certificate     /etc/ssl/portal.acme.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/portal.acme.com/privkey.pem;

    location / {
        proxy_pass http://SERVER_IP:3000;
        proxy_set_header Host              $host;        # preserve the original Host
        proxy_set_header X-Forwarded-Proto https;        # original scheme was HTTPS
        proxy_set_header X-Forwarded-Host  $host;        # belt-and-suspenders
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

## Example: Caddy

```caddy
portal.acme.com {
    reverse_proxy http://SERVER_IP:3000 {
        header_up Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
    }
}
```

(Caddy obtains and renews the TLS certificate automatically.)

## Activating the domain

1. Confirm DNS resolves your custom hostname to your proxy and the proxy reaches the server.
2. In Alga: **Settings → Security → Custom Domains** (or **Settings → Client Portal →
   Custom Domain** on older appliance versions), enter the hostname and save.
3. Choose the **Surface** the domain should serve:
   - **Client portal** — serves only the client-facing portal (original behavior).
   - **MSP** — serves only the MSP/technician app (`/msp/*` and `/auth/signin`).
   - **Both** — serves both the client portal and the MSP app on the same host.
4. For a domain with surface **MSP** or **Both**, confirm the Google/Microsoft OAuth
   redirect URIs in the settings card. The domain stays in **pending_redirect_uri** status
   (requests fail closed to the main host) until this confirmation is saved.
5. The status shows **Active** immediately after confirmation. Portal links in emails and
   invitations switch to the new domain right away — which is why DNS + proxy must already
   be live.

To stop using the domain, click **Remove Domain**; the record is deleted and traffic reverts
to the default host. You can then retire the DNS record and proxy server block.

## Troubleshooting

**"No requests have reached portal.acme.com yet" warning in Settings.**
The server has not observed any traffic arriving on the custom host. Almost always this
means your proxy is **not forwarding the `Host` header** (or `X-Forwarded-Host` with
forwarded-host trust enabled). Re-check the `proxy_set_header Host $host;` (nginx) /
`header_up Host {host}` (Caddy) line and that DNS points at the proxy. Note: if the proxy
rewrites `Host` *and* sends no trusted `X-Forwarded-Host`, the server cannot detect the
original host at all — so always send at least one of them.

**Visiting the domain bounces to the default host and never signs in.**
Same root cause: the server saw the request as the canonical host because `Host` was
rewritten. Forward `Host` (or `X-Forwarded-Host` with forwarded-host trust enabled).

**Sign-in succeeds but immediately logs out / "insecure cookie" behavior.**
Your proxy is not sending `X-Forwarded-Proto: https`. The server then treats the request as
HTTP and won't set a secure session cookie. Add the header.

**MSP (internal) staff hitting the domain get redirected to the main host.**
Expected for a domain with surface **Client portal** — the MSP app is not served there, so
MSP staff are sent back to the main host. For a domain with surface **MSP** or **Both**, MSP
staff sign in and land on `/msp/dashboard` on the custom host directly.

## How it works (for the curious)

The server keeps serving on its primary host (`NEXTAUTH_URL`, e.g. `https://alga.acme.com`).
When a request arrives on a registered custom domain (one that has an active `portal_domains`
row), edge middleware checks the domain's configured **surface**:

- **Client portal** surface: client-portal paths are served in place; MSP paths (`/msp/*`,
  `/auth/signin`) redirect to the main host.
- **MSP** surface: MSP paths are served in place; client-portal paths redirect to the
  same-host sign-in or `/msp/dashboard`.
- **Both** surface: all paths are served in place on the custom host.

For client-portal sign-in, the sign-in page resolves the tenant from the host server-side,
authenticates on the canonical host scoped to that tenant, and a short-lived one-time token
hands the session back to the custom domain (cookies can't cross domains). For MSP sign-in on
a custom host, the auth layer runs directly against the custom host (with a host-scoped cookie)
and ties the session to the tenant that owns the domain — users from another tenant are denied
at sign-in. An unknown or inactive domain falls through to the tenant-discovery form.

The only thing that makes all of this work end-to-end is your proxy preserving the `Host`
header.
