# Appliance Custom Portal Domain — Reverse Proxy Setup

This guide is for operators of the **on-premise appliance** who want to serve the client
portal on a branded domain (a "vanity domain") such as `portal.acme.com`.

Unlike the hosted cloud, the appliance does **not** verify DNS, issue TLS certificates, or
configure ingress for you. You bring your own reverse proxy; the appliance just records the
domain and runs the portal's vanity behavior (branded sign-in, cross-domain session handoff,
branded links). When you enter a domain in Settings it activates **immediately** — so wire up
DNS and your proxy *first*.

## What you provide

1. **DNS** — a record that resolves your custom domain to your reverse proxy / appliance.
2. **A reverse proxy** that terminates TLS for the custom domain and forwards to the appliance
   on port `3000`, **preserving the original `Host` header** and setting `X-Forwarded-Proto`.
3. **A TLS certificate** for the custom domain (your proxy's responsibility — e.g. Let's
   Encrypt on the proxy, or a certificate you already manage).

## The contract (must-haves)

For the portal's cross-domain sign-in to work, the appliance must see the request as arriving
on the custom host over HTTPS. Your proxy must therefore send:

- `Host: portal.acme.com` — the original host. If your proxy rewrites `Host`, set
  `X-Forwarded-Host: portal.acme.com` instead (the appliance trusts it in appliance mode).
- `X-Forwarded-Proto: https` — so the appliance sets secure cookies and builds `https://`
  redirects (it receives plain HTTP behind your TLS-terminating proxy).

## Example: nginx

```nginx
server {
    listen 443 ssl;
    server_name portal.acme.com;

    ssl_certificate     /etc/ssl/portal.acme.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/portal.acme.com/privkey.pem;

    location / {
        proxy_pass http://APPLIANCE_IP:3000;
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
    reverse_proxy http://APPLIANCE_IP:3000 {
        header_up Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {host}
    }
}
```

(Caddy obtains and renews the TLS certificate automatically.)

## Activating the domain

1. Confirm DNS resolves `portal.acme.com` to your proxy and the proxy reaches the appliance.
2. In Alga: **Settings → Client Portal → Custom Domain**, enter `portal.acme.com`, and save.
3. The status shows **Active** immediately. Portal links in emails and invitations switch to
   the new domain right away — which is why DNS + proxy must already be live.

To stop using the domain, click **Remove Domain**; the record is deleted and traffic reverts
to the default host. You can then retire the DNS record and proxy server block.

## Troubleshooting

**"No requests have reached portal.acme.com yet" warning in Settings.**
The appliance has not observed any traffic arriving on the custom host. Almost always this
means your proxy is **not forwarding the `Host` header** (or `X-Forwarded-Host`). Re-check the
`proxy_set_header Host $host;` (nginx) / `header_up Host {host}` (Caddy) line and that DNS
points at the proxy. Note: if the proxy rewrites `Host` *and* sends no `X-Forwarded-Host`, the
appliance cannot detect the original host at all — so always send at least one of them.

**Visiting the domain bounces to the default host and never signs in.**
Same root cause: the appliance saw the request as the canonical host because `Host` was
rewritten. Forward `Host` (or `X-Forwarded-Host`).

**Sign-in succeeds but immediately logs out / "insecure cookie" behavior.**
Your proxy is not sending `X-Forwarded-Proto: https`. The appliance then treats the request as
HTTP and won't set a secure session cookie. Add the header.

**MSP (internal) staff hitting the portal domain land on `/msp/dashboard`.**
Expected — internal users can't use the client portal; they're redirected to the MSP app.

## How it works (for the curious)

The appliance keeps serving on its primary host (`appUrl`, e.g. `https://alga.acme.com`). When
a request arrives on a different host, edge middleware redirects to the canonical sign-in page,
the user authenticates there, and a short-lived one-time token hands the session back to the
custom domain (cookies can't cross domains). The only thing that makes this work end-to-end is
your proxy preserving the `Host` header.
