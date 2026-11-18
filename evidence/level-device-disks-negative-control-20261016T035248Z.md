# Level disks: negative control vs fixed HEAD

- HEAD (fixed): `84b97ce9a867311b44ac02fb6f839289bf9de6b3`
- Negative control: origin/main merge-base `92a8f0b83863c5d9f69dd2a9fcbd8fa82729b7b0`, pre-fix `levelApiClient.ts` + `mappers/deviceMapper.ts` extracted with `git show` (deviceMapper sha256 prefix 9778203f8788ca63, matching git blob 9778203f8788ca63)
- Same emulator (`node packages/emulators/host/dist/cli.js serve -m @alga-psa/emulator-levelio`), same seeded device SRV-01, same probe `npx tsx /tmp/smoke-ld/probe2.mts` run from ee/server: real `LevelIoApiClient.listDevices`, then `mapLevelIoDiskUsage` and `mapLevelIoDeviceToSnapshot`. Both runs: before rc=0, after rc=0.
- Machine-readable: `evidence/level-device-disks-negative-control-20261016T035248Z.json`

## Raw request/response (shared input)
```
GET http://127.0.0.1:4080/v2/devices?include_disks=true
{"data":[{"nickname":null,"role":"workstation","group_id":"Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ","tags":[],"flag":null,"maintenance_mode":false,"online":true,"notes":null,"manufacturer":null,"model":null,"architecture":null,"serial_number":"SN-SRV01","total_memory":null,"memory_slots":null,"cpu_cores":null,"last_logged_in_user":null,"last_reboot_time":null,"last_seen_at":"2026-10-16T03:52:31.933Z","city":null,"country":null,"security_score":null,"platform":"Windows","hostname":"SRV-01","disks":[{"disk_type":"NVMe","model":"Samsung 990 PRO","serial_number":"S7KHNJ0W123456","size":2000398934016},{"disk_type":"HDD","model":"WDC WD40EFRX","serial_number":"WD-WCC7K1234567","size":4000787030016}],"id":"Z2lkOi8vbGV2ZWwvRGV2aWNlLzE"}],"has_more":false}
HTTP 200
```
## NEGATIVE CONTROL: origin/main pre-fix mapper (reads disk_partitions)
```
CLIENT listDevices -> device.disks: [{"disk_type":"NVMe","model":"Samsung 990 PRO","serial_number":"S7KHNJ0W123456","size":2000398934016},{"disk_type":"HDD","model":"WDC WD40EFRX","serial_number":"WD-WCC7K1234567","size":4000787030016}]
MAPPED mapLevelIoDiskUsage(device): []
MAPPED full snapshot: {
  "provider": "levelio",
  "integrationId": "int-smoke",
  "externalDeviceId": "Z2lkOi8vbGV2ZWwvRGV2aWNlLzE",
  "externalScopeId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ",
  "lifecycleState": "active",
  "assetType": "workstation",
  "displayName": "SRV-01",
  "serialNumber": "SN-SRV01",
  "status": "active",
  "location": null,
  "assetTag": "levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzE",
  "agentStatus": "online",
  "lastSeenAt": "2026-10-16T03:52:32.388Z",
  "extension": {
    "osType": "Windows",
    "osVersion": null,
    "currentUser": null,
    "uptimeSeconds": null,
    "lanIp": null,
    "wanIp": null,
    "antivirusStatus": null,
    "antivirusProduct": null,
    "lastRebootAt": null,
    "pendingOsPatches": null,
    "pendingPatches": null,
    "cpuModel": null,
    "cpuCores": null,
    "ramGb": null,
    "diskUsage": [],
    "systemInfo": {
      "manufacturer": null,
      "model": null,
      "fullOperatingSystem": null,
      "osEndOfLife": false,
      "securityScore": null,
      "securityRisk": null,
      "patchSecurityRisk": null,
      "maintenanceMode": false,
      "flag": null,
      "tags": [],
      "groupId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ"
    }
  },
  "metadata": {
    "hostname": "SRV-01",
    "groupId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ",
    "tags": []
  }
}
```
Result: the client receives both disks, and the mapper returns `diskUsage: []`. Disks are absent from the mapped device.

## FIXED: HEAD mapper (reads documented disks)
```
CLIENT listDevices -> device.disks: [{"disk_type":"NVMe","model":"Samsung 990 PRO","serial_number":"S7KHNJ0W123456","size":2000398934016},{"disk_type":"HDD","model":"WDC WD40EFRX","serial_number":"WD-WCC7K1234567","size":4000787030016}]
MAPPED mapLevelIoDiskUsage(device): [
  {
    "name": "NVMe Samsung 990 PRO",
    "total_gb": 1863.02
  },
  {
    "name": "HDD WDC WD40EFRX",
    "total_gb": 3726.02
  }
]
MAPPED full snapshot: {
  "provider": "levelio",
  "integrationId": "int-smoke",
  "externalDeviceId": "Z2lkOi8vbGV2ZWwvRGV2aWNlLzE",
  "externalScopeId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ",
  "lifecycleState": "active",
  "assetType": "workstation",
  "displayName": "SRV-01",
  "serialNumber": "SN-SRV01",
  "status": "active",
  "location": null,
  "assetTag": "levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzE",
  "agentStatus": "online",
  "lastSeenAt": "2026-10-16T03:52:32.821Z",
  "extension": {
    "osType": "Windows",
    "osVersion": null,
    "currentUser": null,
    "uptimeSeconds": null,
    "lanIp": null,
    "wanIp": null,
    "antivirusStatus": null,
    "antivirusProduct": null,
    "lastRebootAt": null,
    "pendingOsPatches": null,
    "pendingPatches": null,
    "cpuModel": null,
    "cpuCores": null,
    "ramGb": null,
    "diskUsage": [
      {
        "name": "NVMe Samsung 990 PRO",
        "total_gb": 1863.02
      },
      {
        "name": "HDD WDC WD40EFRX",
        "total_gb": 3726.02
      }
    ],
    "systemInfo": {
      "manufacturer": null,
      "model": null,
      "fullOperatingSystem": null,
      "osEndOfLife": false,
      "securityScore": null,
      "securityRisk": null,
      "patchSecurityRisk": null,
      "maintenanceMode": false,
      "flag": null,
      "tags": [],
      "groupId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ"
    }
  },
  "metadata": {
    "hostname": "SRV-01",
    "groupId": "Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ",
    "tags": []
  }
}
```
Result: `diskUsage: [{"name":"NVMe Samsung 990 PRO","total_gb":1863.02},{"name":"HDD WDC WD40EFRX","total_gb":3726.02}]` (2000398934016 and 4000787030016 bytes divided by 1024³).
