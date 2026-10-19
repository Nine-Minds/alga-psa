# Raw smoke: Level disks → Alga mapper (HEAD 84b97ce9a867311b44ac02fb6f839289bf9de6b3)

Emulator: `node packages/emulators/host/dist/cli.js serve -m @alga-psa/emulator-levelio` (vendor :4080, control :9500)

Seeded device SRV-01 in group Acme Corp with documented `disks` (NVMe Samsung 990 PRO 2000398934016 B; HDD WDC WD40EFRX 4000787030016 B).

## Raw request/response
```
GET http://127.0.0.1:4080/v2/devices?include_disks=true   (authorization: algasim-level-key)
{"data":[{"nickname":null,"role":"workstation","group_id":"Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ","tags":[],"flag":null,"maintenance_mode":false,"online":true,"notes":null,"manufacturer":null,"model":null,"architecture":null,"serial_number":"SN-SRV01","total_memory":null,"memory_slots":null,"cpu_cores":null,"last_logged_in_user":null,"last_reboot_time":null,"last_seen_at":"2026-10-16T03:46:50.477Z","city":null,"country":null,"security_score":null,"platform":"Windows","hostname":"SRV-01","disks":[{"disk_type":"NVMe","model":"Samsung 990 PRO","serial_number":"S7KHNJ0W123456","size":2000398934016},{"disk_type":"HDD","model":"WDC WD40EFRX","serial_number":"WD-WCC7K1234567","size":4000787030016}],"id":"Z2lkOi8vbGV2ZWwvRGV2aWNlLzE"}],"has_more":false}
HTTP 200
```
Without include_disks=true, data[0] has "disks": false (the section is omitted).

## Alga LevelIoApiClient.listDevices + deviceMapper output (npx tsx probe, exit 0)
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
  "lastSeenAt": "2026-10-16T03:47:10.382Z",
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
GiB check: 2000398934016/1024^3 = 1863.02, 4000787030016/1024^3 = 3726.02.
