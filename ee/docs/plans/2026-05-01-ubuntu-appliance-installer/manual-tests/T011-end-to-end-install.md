# T011 End-to-End Install (VM)

1. Complete T002 install and reboot validation.
2. Run T004 web setup path with `stable` channel.
3. Wait for setup workflow completion and status convergence.
4. Verify status tiers include `loginReady=true`.
5. Open configured app URL and confirm login page response.

Evidence:
- status JSON from `GET /api/status?token=<token>`
- screenshot of app login screen
- install-state and release-selection snapshots
