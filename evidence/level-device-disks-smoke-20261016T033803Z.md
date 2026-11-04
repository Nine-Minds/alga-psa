# Smoke evidence: Map Level device disks from the documented disks field

- Card: e388aa0a-ac47-4fc1-a2bc-bc7a8b300f1d (PSA alga-2026-0002733)
- Branch: feature/map-level-device-disks-from-the-documented-disks
- HEAD: 84b97ce9a867311b44ac02fb6f839289bf9de6b3
- Run at: 2026-10-16T03:38:03Z
- Dev server :3835: GET / answered 307 -> http://feature-map-level-device-disks-from-the-documented-disks.localhost:3835/msp/dashboard

## Contract/smoke suite

| # | Suite | Command | Result | Exit |
|---|-------|---------|--------|------|
| 1 | Level device mapper unit (documented `disks` shape) | `cd ee/server && npx vitest run --config vitest.unit.config.ts src/__tests__/unit/integrations/levelioDeviceMapper.test.ts` | 1 file, 20/20 passed | 0 |
| 2 | algasim Level emulator package, including restConsumer: Alga's `mapLevelIoDiskUsage` run against the emulator's live HTTP `/v2/devices?include_disks=true` payload | `cd packages/emulators/levelio && npx vitest run` | 3 files, 22/22 passed | 0 |
| 3 | Emulator suite registry + bundled Level scenarios | `cd packages/emulators/suite && npx vitest run` | 1 file, 6/6 passed | 0 |

Total: 48/48 tests passed across 5 files; every command exited 0.

Suite 3 imports the sibling emulators through their built `dist/` entries. To run it, the unbuilt sibling packages (qbo, webhook-sink, xero, threecx, suite) were built first with `npx tsup`. The output is gitignored (`packages/**/dist/`), and no tracked file changed.

## Key assertion (suite 2, restConsumer.test.ts:106)

The emulator serves `disks` only when `include_disks=true` is sent, and the mapper turns that into
`[{ name: 'NVMe Samsung', total_gb: 476.84 }]`. This shows the mapper reads Level's documented `disks` field (disk_type/model/serial_number/size) end to end over HTTP.

## Raw tails
```
-- suite 1
 Test Files  1 passed (1)
      Tests  20 passed (20)
-- suite 2
 Test Files  3 passed (3)
      Tests  22 passed (22)
-- suite 3
 Test Files  1 passed (1)
      Tests  6 passed (6)
```
