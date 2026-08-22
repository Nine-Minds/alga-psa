# Printer Troubleshooting

Restart the **spooler** service, then *retry* the job. Run `net stop spooler`
and read the [vendor guide](https://example.com/printers) before escalating.

## Symptoms

- Jobs stay queued
- Status shows *offline*
  - Only on the third floor
- Driver reports `0x0000011b`

### Fix order

1. Restart the spooler
2. Clear `%windir%\System32\spool\PRINTERS`
3. Reinstall the driver

> Escalate to the vendor when the queue clears but printing still fails.
> Include the driver version.

```powershell
Restart-Service -Name Spooler
```

```
plain fenced block
```

| Model | Firmware | Supported |
| --- | :---: | ---: |
| LX-100 | 2.4.1 | **yes** |
| LX-200 | 3.0.0 | no |

---

Contact ~~the helpdesk~~ the vendor for RMA numbers.

![Spooler service dialog](https://example.com/img/spooler.png)

Compare ![the queue](https://example.com/img/queue.png) with the driver log.
