# Tanium Asset Enrichment Design

Date: 2026-04-15

## Goal

Enrich Tanium-synced assets so the Alga asset detail page surfaces materially more of the data Tanium already provides, with a strict and explicit mapping.

Target improvements:
- current user
- LAN IP
- WAN/NAT IP
- uptime
- manufacturer/model
- CPU/RAM/storage details
- installed software inventory

## Current Gap

The current Tanium sync only maps a narrow subset of endpoint fields into the normalized RMM snapshot. As a result, the asset detail page shows a connected Tanium device but still renders sparse panels (`N/A`, `None`, missing model, empty software tab) even though Tanium already has the data.

## Design

### 1. Tanium-native enrichment first

Extend the Tanium endpoint query to include supported native GraphQL fields:
- `manufacturer`
- `model`
- `ipAddresses`
- `macAddresses`
- `memory`
- `processor`
- `disks`
- `discover { natIpAddress }`
- `installedApplications`
- existing user / OS / IP / serial fields

These fields become the primary source of truth for Tanium asset enrichment.

### 2. Single explicit sensor for uptime

Use a single Tanium sensor for uptime-related enrichment:
- `Last Reboot`

We will derive `uptimeSeconds` from `lastRebootAt`.

Guardrail:
- if the sensor query fails or returns an invalid timestamp, leave uptime null
- do not fail the entire inventory sync over uptime enrichment

### 3. Extend normalized RMM snapshot

Add optional normalized extension fields so Tanium can pass richer hardware/software data through the shared ingestion path:
- `cpuModel`
- `cpuCores`
- `ramGb`
- `diskUsage`
- `installedSoftware`

Continue using `systemInfo` for manufacturer/model/chassis/reporting URL/IP lists and other Tanium-specific details that do not have first-class normalized columns yet.

### 4. Persist through shared asset ingestion

Update shared RMM asset ingestion so workstation/server extension rows can store:
- `cpu_model`
- `cpu_cores`
- `ram_gb`
- `disk_usage`
- `installed_software`
- existing cached live fields (`current_user`, `lan_ip`, `wan_ip`, `uptime_seconds`, `last_reboot_at`, etc.)
- `system_info`

Important behavior:
- only write optional hardware/software fields when the snapshot explicitly provides them
- avoid wiping unrelated values for providers that do not supply those fields

### 5. UI refresh coherence

The asset detail refresh flow should refresh both:
- cached RMM data
- the main asset payload

This avoids a stale page state where RMM vitals refresh but model/software/hardware remain hidden until a full reload.

## Expected Result

For the current Tanium Mac endpoint, the asset detail page should populate:
- Current User: `roberisaacs`
- LAN IP: `192.168.254.190`
- WAN IP: `10.0.156.6`
- Uptime: derived from `Last Reboot`
- Model: `Mac16,5`
- CPU: `Apple M4 Max 2.4GHz`
- RAM: `48 GB`
- Storage: populated from Tanium disks
- Software tab: installed applications from Tanium

## Non-Goals

- broad sensor fishing
- dynamic schema fallback logic
- provider-coupled live UI fetches from asset detail
- making sync success depend on optional uptime enrichment

## Validation

- focused unit tests for Tanium gateway mapping
- focused unit tests for shared ingestion persistence
- live sync and browser validation on the existing Tanium test asset
