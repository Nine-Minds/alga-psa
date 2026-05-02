# T004 Web Setup Happy Path

1. Boot fresh Ubuntu appliance VM and obtain setup token from console.
2. Open `http://<node-ip>:8080/setup?token=<token>`.
3. Submit:
   - channel: `stable`
   - app hostname
   - DNS mode: `Use DHCP/system resolvers`
   - no custom DNS
4. Confirm request returns success path (or setup-progress transition).
5. Validate persisted setup file:

```bash
sudo cat /etc/alga-appliance/setup-inputs.json
```

Expected:
- `channel` is `stable`.
- `dnsMode` is `system`.
- `dnsServers` is empty unless explicitly provided.
- setup workflow state file advances and does not silently inject public DNS.
