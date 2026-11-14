# Production mismatch counts

Read-only report at 2026-11-03 16:23 UTC, Citus coordinator `stackgres-pgvector/pgvector-coord-0`, database `server`, transaction BEGIN READ ONLY / ROLLBACK. Script from revision `6a529be497e85e4aacbc441a5dbd386d1637bf57`.

Templates, legacy and linked recurring definitions, and effective client overrides: zero priority mismatches and zero category mismatches.

Open-ticket priority mismatches: 11947 across 18 tenants.

| Tenant | Count |
|---|---:|
| 11111111-1111-1111-1111-111111111111 | 7 |
| 2ac4adb7-853a-41a2-84b5-098af3d2fa11 | 1 |
| 3adfab79-ea9a-468d-a9c5-ee96d74f4db7 | 2 |
| 43dcfef9-4d9a-49e4-bedb-630b150d4a68 | 1 |
| 46208df6-7f10-4810-ae74-0649e7a1952c | 48 |
| 56d4a2bf-14ee-43cd-8da3-a35f0c88cd91 | 25 |
| 917d38c4-092e-4577-9f2a-547d671bc9c3 | 420 |
| 999a5917-3333-4fe7-ac1b-e3d4d8f5da03 | 6 |
| a117be37-d7c3-4281-b4fd-7708eb346e21 | 1 |
| a1799bc6-8435-4e2b-9707-cc69d3fbec3f | 18 |
| a965a7be-1ce8-44e0-a281-bc60674ad267 | 11272 |
| aa649902-10f8-4c6c-88ff-e4a788f8ca3a | 1 |
| b22e6103-2763-4381-8fa7-960c3a3b7cf0 | 29 |
| b9d9fac3-dec7-4fb3-ae89-80b9d17f2cd7 | 20 |
| d863caae-7728-43f1-9e74-2e8a64d34fc8 | 1 |
| d9d10280-1259-4fb5-b372-8996cf70352a | 7 |
| dbcc04a9-d209-406f-9a16-1607403ff2f1 | 28 |
| e1ed9d62-dd49-40a1-9bd3-e1c684e1dc75 | 60 |

Informational category mismatches: 1480 across 5 tenants.

| Tenant | Count |
|---|---:|
| 5c6c48a0-9b69-4511-bd91-16991d7153aa | 2 |
| 917d38c4-092e-4577-9f2a-547d671bc9c3 | 1 |
| 999a5917-3333-4fe7-ac1b-e3d4d8f5da03 | 5 |
| a1799bc6-8435-4e2b-9707-cc69d3fbec3f | 1 |
| b9d9fac3-dec7-4fb3-ae89-80b9d17f2cd7 | 1471 |

Decision: retain this informational report and arrange a separately captain-approved cleanup assessment. Do not infer replacement priorities or rewrite customer data automatically. No production writes were performed. Category validation remains outside this card.
