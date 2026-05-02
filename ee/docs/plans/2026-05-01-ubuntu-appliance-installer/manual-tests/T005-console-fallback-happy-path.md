# T005 Console Fallback Happy Path

1. On VM/serial console, run console setup fallback:

```bash
/usr/bin/env node /opt/alga-appliance/host-service/console-setup.mjs
```

2. Provide required values (channel/app hostname/DNS mode/repo overrides).
3. Choose DNS system mode and continue.
4. Verify setup starts and install state updates:

```bash
sudo cat /var/lib/alga-appliance/install-state.json
sudo cat /etc/alga-appliance/setup-inputs.json
```

Expected:
- same required fields as web flow are collected
- persisted setup values match entered values
- setup engine transitions out of preflight and into install phases (or explicit blocker)
