# Development email recipients

Local IMAPS and HTTPS OAuth fixtures must be reachable during development without weakening production address checks. Keep the exception in the shared outbound email resolution path used by provider saves, OAuth routes, connection tests and the standalone worker.

Enable exact hostname-to-IP exceptions only when `NODE_ENV` is `development` or `test` and `ALGA_EMAIL_DEV_DESTINATIONS` contains a JSON object mapping exact hostnames to nonempty arrays of literal IP addresses. Resolve hostnames normally and require every resolved address to be listed before allowing a normally blocked destination. Wildcards, CIDRs, URLs and empty entries are invalid. HTTPS and embedded-credential restrictions remain in force.

With no configuration, or in production and unknown environments, preserve existing address rejection. Production must ignore even an explicitly configured exception. This is a development operator setting, not tenant configuration. It grants host access across ports; operators must list only controlled fixture hosts and addresses.

Acceptance: behavioral tests cover default rejection, development/test exceptions, production rejection, exact identity and DNS address checks, invalid entries, and HTTPS restrictions. Build the email service from the committed revision, then exercise real OAuth and worker flows against controlled trusted-TLS fixtures. Evidence and synthetic credentials stay outside git.
