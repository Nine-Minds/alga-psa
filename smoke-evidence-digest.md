# Smoke evidence digest — card f2aac11d

Source directory: `/tmp/alga-smoke-evidence/security-authz-in-savecontractlineedit-20261031-062922` on host robert-X670E-Pro-RS. It exists and holds 23 files: 10 json, 1 md, 10 png, 1 vtt, 1 webm.

**`00-provenance.txt` is NOT present in this directory.** The directory has no `.txt` files at all. The `README.md` that is present is reproduced verbatim below in its place. No file was truncated, since every text file is under 200 KB.

## Commit tie-in
```
$ git rev-parse HEAD
6217f612b0830f2647033c71cf3bcb02480e4f6e
$ git branch --show-current
feature/security-authz-in-savecontractlineedit
$ git status --porcelain | wc -l
1
$ git log --oneline 450e05f46b19ff6b25c5e562801224f00074be83..HEAD
6217f612b0 fix(billing): authorize contract-line membership writes from effective state (f2aac11d)
3c43c6fa23 docs(security): design membership-write authorization (f2aac11d)
```

Changed files vs merge commit `450e05f46b19ff6b25c5e562801224f00074be83` (sha256 at HEAD):
```
363a2023a7208b10bd85fb6c67737c80e14a041494573660f643252073c1c47c  docs/plans/2026-10-29-membership-write-authz.md
1cab5516aeb0088eab99be2d4e18bc38a93363edd6aabd9884688b9dce1e95b6  packages/billing/src/actions/__tests__/contractLineSaveAction.authz.db.test.ts
818ea6425b0b531b36511f6c95c29ef5cf7c635cddd7074c4af97fc7926165b5  packages/billing/src/actions/bucketOverlayActions.ts
63fc6692cc6dddf8c62c82178eb58b48f346dbbc3eb55bddf8364a3161e55cc6  packages/billing/src/actions/contractLinePresetActions.ts
8bf45291b936227727f461246a6f9bc3d5d42c26a8848882adbc660d0a22f410  packages/billing/src/actions/contractLineSaveAction.ts
2f107349ce15dc631ff416683e0319b158c97fef2f058b662f2b056e413105d2  packages/billing/src/actions/contractLineServiceActions.ts
b7f4e5705f048ed800c85f7262ce8a174105b42a24bf29f167fb027f76c8430a  packages/billing/src/actions/contractLineServiceConfigurationActions.ts
992f4b5b519e5fec4e12581851b42d23ed328fa4b209ee9cdb3b12ce0dd4f378  packages/billing/src/actions/contractWizardActions.ts
01de89e048c56c10060ee54070b57061f9aadfd445da837c35947e48666a2ae2  packages/billing/src/lib/billing/__tests__/authorizeMembershipWrite.test.ts
7081dbd8215544f781e009a1d0cb4f8f3131a067dbabf044bc1979441c73b327  packages/billing/src/lib/billing/contractLineMembership.ts
eaec7620b6c29c527f9ff321aad2e97c4827af7b6f3d16f24000ecf09f7676c7  packages/billing/tests/contractLineServiceActions.templateNonFixed.test.ts
5e2565065bf329a969fb1bc90b0f247a560ea8fc3600ae27c07ef2a5275ea3fc  packages/billing/tests/contractLineServiceMembershipActions.test.ts
7562adfe0aeeeb839f49dc32e7e6f77a2ee242cfe206f3661f7e09351d947131  packages/billing/tests/upsertBucketConfiguration.successContract.test.ts
```

## Text files (verbatim)

### README.md
```
# Smoke: Security — authz in saveContractLineEdit (card f2aac11d), branch head 6217f612b0
Live dev stack http://feature-security-authz-in-savecontractlineedit.localhost:3862 (compose alga-psa-local-test), contract "Smoke2015 Bucket Support", line b372f34d.
Users: qa@emeraldcity.oz (Admin) and smoke-f2aac-updateonly@emeraldcity.oz (role "Smoke f1526 billing update-only": billing read/update/delete, NO create).

F1  qa enables bucket tracking on Remote Helpdesk (10h/$95) in the editor -> saved (01,02; db-01: new bucket 600 min).
F2a update-only edits that existing overlay to 12h -> saved (04,05; db-02: 720 min). Update path not over-blocked.
F2b update-only adds "Asset Tracking" via Add Item -> "Permission denied: billing:create required to attach service" (06,07; db-03 unchanged).
    (video chapter label says On-Site Support; the UI flow actually used Asset Tracking.)
F3  EXPLOIT: update-only replays saveContractLineEdit server action, added_service_ids:[] + bucket overlay for unattached On-Site Support -> permissionError (08).
F3b same via legacy upsertBucketOverlay endpoint -> permissionError (09).
    db-before-exploit == db-after-exploit == db-after-exploit-legacy (identical sha1); edit version token unchanged.
F4  CONTROL: qa sends identical payload -> status "saved", On-Site Support membership + bucket created (10; db-after-control-qa).
Cleanup: overlay buckets + On-Site membership deleted via SQL; db-99-restored == db-00-baseline.
Video: smoke-walkthrough.webm (+ .vtt chapters, .json marks).
```

### db-00-baseline.json
```
{
 "takenAt": "2026-10-31T10:31:17.607Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  }
 ],
 "contract_line_bucket_services": []
}
```

### db-01-after-qa-overlay.json
```
{
 "takenAt": "2026-10-31T10:32:11.722Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 600,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### db-02-after-update-only-edit-existing.json
```
{
 "takenAt": "2026-10-31T10:33:27.270Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### db-03-after-update-only-add-service-refused.json
```
{
 "takenAt": "2026-10-31T10:34:34.916Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### db-99-restored.json
```
{
 "takenAt": "2026-10-31T10:36:49.426Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  }
 ],
 "contract_line_bucket_services": []
}
```

### db-after-control-qa.json
```
{
 "takenAt": "2026-10-31T10:36:26.740Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "f0b47687-2af6-4210-911e-90bc7dd4a003",
   "service_name": "On-Site Support"
  },
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  },
  {
   "bucket_id": "4ca57120-79ff-42c7-853e-ec1e856e52d1",
   "total_minutes": 600,
   "overage_rate": "5000.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:36:25.505Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  },
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "4ca57120-79ff-42c7-853e-ec1e856e52d1",
   "service_id": "f0b47687-2af6-4210-911e-90bc7dd4a003",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:36:25.505Z",
   "updated_at": "2026-10-31T10:36:25.505Z"
  }
 ]
}
```

### db-after-exploit-legacy.json
```
{
 "takenAt": "2026-10-31T10:35:40.849Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### db-after-exploit.json
```
{
 "takenAt": "2026-10-31T10:35:27.505Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### db-before-exploit.json
```
{
 "takenAt": "2026-10-31T10:35:26.022Z",
 "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
 "contract_line_services": [
  {
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "service_name": "Remote Helpdesk"
  }
 ],
 "contract_line_service_configuration": [
  {
   "config_id": "6530c868-a116-4fad-b90f-81922aed5153",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "configuration_type": "Hourly",
   "updated_at": "2026-10-16T23:42:15.350Z"
  }
 ],
 "contract_line_buckets": [
  {
   "bucket_id": "c90cce27-b86f-4475-bc7b-f8cb7421f75c",
   "total_minutes": 2400,
   "overage_rate": "0.00",
   "covers_all_services": true,
   "updated_at": "2026-10-16T23:42:15.341Z"
  },
  {
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "total_minutes": 720,
   "overage_rate": "9500.00",
   "covers_all_services": false,
   "updated_at": "2026-10-31T10:33:21.123Z"
  }
 ],
 "contract_line_bucket_services": [
  {
   "tenant": "6d178771-ad9a-4d43-8809-83992745f8f9",
   "bucket_id": "bd44a447-4d3d-4ef2-9878-3e631331e7c9",
   "service_id": "c965cddb-f1aa-46df-8917-9a33fb26c93d",
   "contract_line_id": "b372f34d-a597-4ea9-be7e-25a077028ef7",
   "burn_multiplier": "1.000",
   "created_at": "2026-10-31T10:32:05.589Z",
   "updated_at": "2026-10-31T10:32:05.589Z"
  }
 ]
}
```

### smoke-walkthrough.json
```
{
  "version": 1,
  "title": "Security: authz in saveContractLineEdit smoke test",
  "paneId": "05d1e61f-9da1-460e-a4b5-7aec6ded43d1",
  "startedAt": "2026-10-31T10:31:28.159Z",
  "finishedAt": "2026-10-31T10:36:32.987Z",
  "durationMs": 116143,
  "width": 1280,
  "height": 724,
  "bytes": 4267923,
  "frames": 906,
  "marks": [
    {
      "t": 2.001,
      "label": "F1 qa (billing:create+update) edits bucket total on attached+configured service via editor - expect saved"
    },
    {
      "t": 35.358,
      "label": "F2 update-only user (billing read/update/delete, NO create) signs in"
    },
    {
      "t": 50.287,
      "label": "F2a update-only user changes bucket hours on already-configured Remote Helpdesk (billing:update path) - expect saved"
    },
    {
      "t": 62.78,
      "label": "F2b update-only user adds a new service (On-Site Support) via Add Item - expect billing:create refusal, nothing written"
    },
    {
      "t": 90.778,
      "label": "F3 EXPLOIT replay as update-only user: saveContractLineEdit with added_service_ids:[] + bucket overlay for unattached On-Site Support - expect refused, no rows"
    },
    {
      "t": 94.3,
      "label": "F3b EXPLOIT replay as update-only user via legacy upsertBucketOverlay endpoint for unattached On-Site Support - expect refused"
    },
    {
      "t": 101.604,
      "label": "F4 CONTROL: qa (has billing:create) sends the identical overlay payload - expect accepted, proving refusal is authz not a bad request"
    }
  ],
  "files": {
    "video": "smoke-walkthrough.webm",
    "chapters": "smoke-walkthrough.vtt"
  }
}
```

### smoke-walkthrough.vtt
```
WEBVTT

1
00:00:02.001 --> 00:00:35.358
F1 qa (billing:create+update) edits bucket total on attached+configured service via editor - expect saved

2
00:00:35.358 --> 00:00:50.287
F2 update-only user (billing read/update/delete, NO create) signs in

3
00:00:50.287 --> 00:01:02.780
F2a update-only user changes bucket hours on already-configured Remote Helpdesk (billing:update path) - expect saved

4
00:01:02.780 --> 00:01:30.778
F2b update-only user adds a new service (On-Site Support) via Add Item - expect billing:create refusal, nothing written

5
00:01:30.778 --> 00:01:34.300
F3 EXPLOIT replay as update-only user: saveContractLineEdit with added_service_ids:[] + bucket overlay for unattached On-Site Support - expect refused, no rows

6
00:01:34.300 --> 00:01:41.604
F3b EXPLOIT replay as update-only user via legacy upsertBucketOverlay endpoint for unattached On-Site Support - expect refused

7
00:01:41.604 --> 00:01:56.143
F4 CONTROL: qa (has billing:create) sends the identical overlay payload - expect accepted, proving refusal is authz not a bad request
```

## Binary and other files (name, size in bytes, sha256)
```
01-qa-enables-bucket-on-remote-helpdesk.png                      164524  4acfafdaad54d521440e14626a592c34776fd5ed7445bcd18eeda1805bab2daf
02-qa-save-succeeds-editor-closed.png                            176847  9226ff7897651af9ed43dd1f0a12bc2fcd0f57cb2c24bfca7f980e0cc78f6d97
03-signed-in-as-update-only-user.png                             158584  5607f34ac5c2153b54cb4b4623d8386ab8f9ff8a997cdfb1e7b69ecacd945363
04-update-only-edits-existing-overlay-to-12h.png                 161226  a57cdd216e375d00823cd3f95d31c16288646674396ec4ee5749049ecc154869
05-update-only-edit-existing-overlay-saved.png                   176280  5c5ac0c5d5af2a7af4319b5d9e47685975d68ad05828b2050bd30c4341bdbdf2
06-update-only-selects-new-service.png                           239091  34bf3b96bea4363e399cd064ada4521aacc0a872eb868e5c3c0fca5a6af370e1
07-update-only-add-service-refused-billing-create.png            191902  461c236a4a8c3b031293126bdd84bafc228b0daec951e85ba9b6ec14ec219fa5
08-exploit-saveContractLineEdit-refused.png                      230967  97185fac1ca42606c740ee9439632169a72dd040aac3035e2b2bf05d582f95c0
09-exploit-legacy-upsertBucketOverlay-refused.png                224616  45b00b766c0db5fe0eccda55b5fe497dfc2dc219d4208730c7d96a048bb1ab90
10-control-qa-same-payload-accepted.png                          253985  d03270863e6345c653fa34846186812690cd29de021eb5db855cd6bea8061e88
smoke-walkthrough.vtt                                              1071  4ee94a0167f5ebe5ef64df6eb212e6fb4810d246df169a4e5a0623f8bb416cd5
smoke-walkthrough.webm                                          4267923  0ff5f221352e23651a7f43d7e5b375ba9b628dc37ff3bfbf11f9d36dcdd11f81
```
