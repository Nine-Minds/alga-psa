# T018 DNS Behavior Validation

1. Prepare VM with internal DNS resolvers in DHCP or static network config.
2. Run web setup and leave DNS mode at default (`system`).
3. Confirm setup proceeds using system resolvers.
4. Repeat setup in a disposable VM and explicitly select custom public DNS (for example `8.8.8.8,8.8.4.4`).
5. Confirm UI warning text about deliberate custom DNS selection is present.
6. Compare persisted setup inputs and resolver behavior in preflight logs/state.

Checks:

```bash
sudo cat /etc/alga-appliance/setup-inputs.json
sudo cat /var/lib/alga-appliance/install-state.json
cat /etc/resolv.conf
```

Expected:
- system/default path preserves internal resolvers
- custom path only applies when explicitly selected
- no silent DNS override occurs
