# Code review: Map Level device disks from the documented disks field

- HEAD: `71c36406ce181e775c637759d2fd791101cbfb3a` (PR #3750, stacked on #3746 head `b71f691b60`)
- Base (merge-base with origin/main): `92a8f0b83863c5d9f69dd2a9fcbd8fa82729b7b0`
- Raw diff: `evidence/level-device-disks-code-review-origin-main.diff` (`git diff origin/main...HEAD`; 52 files, +3688/-64, includes #3746). This card's own commits (`b71f691b60..HEAD`): 22 files, +148/-59.

## The change
- `ee/server/src/lib/integrations/levelio/levelApiClient.ts:44`: new `LevelIoDisk` with `disk_type`, `model`, `serial_number`, `size` in bytes, matching Level's documented v2 schema. It replaces `LevelIoDiskPartition`.
- `ee/server/src/lib/integrations/levelio/levelApiClient.ts:102`: `LevelIoDevice.disks?: LevelIoDisk[] | null` replaces `disk_partitions`. That field is not in Level's documented schema and nothing shows Level sends it, so no fallback was kept. The client already sends `include_disks=true`.
- `ee/server/src/lib/integrations/levelio/mappers/deviceMapper.ts:87-99`: `mapLevelIoDiskUsage` iterates `device.disks` (line 89). It skips disks whose size is missing, non-finite or not positive. Each entry is named `"<disk_type> <model>"`, or `Disk N` when both are missing, and gets `total_gb = size / 1024³` rounded to 2 places. `free_gb` and `utilization_percent` are omitted because Level does not report free space; the old code wrote 0 there. The snapshot uses it at line 160 (`extension.diskUsage`).
- `RmmStorageInfo` now has optional `free_gb` and `utilization_percent`. This is in `ee/server/src/interfaces/rmm.interfaces.ts:214-216`, `packages/types/src/interfaces/asset.interfaces.ts:201-203` and `server/src/interfaces/asset.interfaces.tsx:167-169`. The UI components that read these fields handle missing values:
  - `HardwareSpecsPanel.tsx`: shows total GB when free GB is unknown.
  - `AssetBentoLayout.tsx`: caption falls back to total GB.
  - `assetSignals.worstStorage`: unmeasured disks rank below measured ones.
  - `UtilizationBar` and `BentoGauge` already accept null.
- The new `hardwareSpecsPanel.values.totalStorage` key was added to all 11 msp/assets locales.
- `packages/emulators/PROTOCOL_PARITY.md:171`: the "Consumer drift" paragraph is marked resolved.
- The webhook route is unchanged.

## Tests
- `ee/server/src/__tests__/unit/integrations/levelioDeviceMapper.test.ts:89-155` (`describe('mapLevelIoDiskUsage')`):
  - `:92` maps documented disks to capacity-only GB entries.
  - `:112` skips zero, negative, missing and null sizes.
  - `:126` covers the name fallback.
  - `:144` returns `[]` when disks is absent, null or empty.
  - `:150` maps a payload shaped like the emulator output.
- `ee/server/src/__tests__/integration/levelioEmulatorApiClient.integration.test.ts:124`: the real client fetches from the emulator over HTTP, and the mapper returns `[{name:'NVMe Samsung', total_gb:476.84}]`.
- Run at this HEAD: `cd ee/server && npx vitest run --config vitest.unit.config.ts src/__tests__/unit/integrations/levelioDeviceMapper.test.ts` gave 1 file, 20/20 passed, exit 0.
- `packages/assets` typecheck (`npx tsc --noEmit`) exited 0.

## Findings
- Non-blocking doc nit: `PROTOCOL_PARITY.md:176-177` cites `restConsumer.test.ts`. That file no longer exists after the #3746 rebase. Coverage now lives in `packages/emulators/levelio/tests/rest.test.ts` and `ee/server/src/__tests__/integration/levelioEmulatorApiClient.integration.test.ts:124`.
- No correctness defects found.

Verdict: passed.
