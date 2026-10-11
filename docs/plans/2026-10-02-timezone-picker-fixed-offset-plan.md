# Timezone picker: rank DST zones first and stop storing non-location zones

PSA ticket: alga-2026-0002611
Branch: `feature/timezone-picker-offers-fixed-offset-zones-for-es`
Status: design, not yet implemented

## Problem

Searching the timezone picker for `EST` during US daylight saving time returns only zones that never observe DST: America/Panama, Cancun, Jamaica, Cayman, and Coral_Harbour. America/New_York is labelled `EDT` from April to November, so the abbreviation match misses it. `CST` and `MST` fail the same way (America/Regina and America/Mexico_City; America/Phoenix). A user who picks one of these zones is one hour behind real time all summer, and nothing in the picker tells them why.

The picker's search and ranking code is in `packages/ui/src/components/TimezonePicker.tsx`:

- `:32-43` reads the zone's abbreviation for today's date only.
- `:109-118` filters by substring against the label, the region, and that one abbreviation.
- `:133-145` puts abbreviation matches first and leaves the rest in `Intl.supportedValuesOf` order.
- `:219-238` renders each row as the zone ID, a live clock, and today's abbreviation. Nothing shows whether the zone observes DST.

On the save side, nothing checks the zone's shape. `setTenantTimezone` (`packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts:407-417`) accepts anything `Intl.DateTimeFormat` accepts, including `EST`, `Etc/GMT+5`, and `US/Eastern`. `updateUser` (`packages/users/src/actions/user-actions/userActions.ts:993-1115`) writes `timezone` without any check. The REST schema (`server/src/lib/api/schemas/userSchemas.ts:42-44`) checks with a regex. The regex rejects valid zones (`UTC`, `America/Port-au-Prince`) and accepts legacy aliases (`US/Eastern`).

Zones are read through `normalizeIanaTimeZone` (`packages/db/src/lib/workDate.ts:5-13`). It accepts any ID that Temporal accepts and falls back to UTC.

## What production shows (read-only, 2026-10-02)

- **The reporting account:** the internal user's own zone is `America/New_York`, last changed 2026-07-26. The tenant default is `America/Panama`, a fixed UTC-5 zone. Users with no zone of their own fall back to that default. So does every tenant-level calculation: SLA business hours, client portal availability, billing and hour-block dates, numbering, and date triggers. Time entry reads only the user's own zone (`resolveUserTimeZone`), so this user's time entries are correct. The clock that is an hour off comes from a path that reads the tenant default. Changing the tenant default to America/New_York in Settings > General fixes the account. The reply already sent to the customer asks them to check that setting.
- **Legacy IDs across all tenants:** no row in `users.timezone` or `tenant_settings.settings.timezone` holds a non-location ID (`EST`, `Etc/GMT+5`, `US/Eastern`, and so on). Every stored value is an `Area/Location` zone.
- **Fixed-offset zones in use:** some tenants and users store fixed-offset location zones: Phoenix, Brisbane, Perth, Johannesburg, Sao_Paulo, Honolulu, Regina, Mexico_City, Cancun, Panama, and Cayenne. Most of these are real places that really do have no DST. A few may be the same mistake as in the reported ticket. The data can't tell them apart.

These numbers set the scope. The real damage comes from fixed-offset zones that are valid places. The validator can't reject those, so the picker is the main fix. Rejecting legacy IDs on save is a guard for API callers and other installs. No production data needs migrating.

## Decisions

1. **Treat every zone as having two phases.** For each zone, the picker reads abbreviations, long names, and offsets on January 15 and July 15 of the current year. Search and labels therefore don't depend on today's date. A zone observes DST if its two offsets differ. Reading both dates also covers the southern hemisphere.
2. **Search names in the user's language and in en-US.** Users type `EST` whatever their UI language. Names are displayed in the user's language.
3. **Ranking:** results are sorted by these keys, in order:
   1. match quality
   2. DST-observing zones before fixed-offset zones
   3. the primary zone for its name
   4. preferred zones
   5. alphabetical

   A search for `EST`, `est`, or `Eastern Standard Time` therefore puts America/New_York first, with Panama and the other fixed-offset matches below every DST zone. Fixed-offset zones stay in the results, because Arizona, Saskatchewan, Queensland, and Panama users need them. Ranking and labels make the difference visible.
4. **Primary and preferred zones come from the existing CLDR Windows-to-IANA defaults.** `windowsTimeZones` in `packages/core/src/lib/windowsTimeZones.ts` is CLDR's territory-001 mapping. This reuses a layer we already maintain instead of adding a hand-curated list.
   - **Primary:** a zone is the *primary zone* for its name when its en-US standard-phase long name is a key in that map and the key maps back to the zone. "Eastern Standard Time" → America/New_York, "Central Standard Time" → America/Chicago, and "Mountain Standard Time" → America/Denver. America/Grand_Turk, Indianapolis, Panama, and Phoenix share those names but are not primary.
   - **Preferred:** every value in the map, minus `Etc/*`. This is a weaker tie-break below primary.
   - Some browsers return a different name for the same zone, such as Asia/Kolkata and Asia/Calcutta. Both checks therefore compare the raw ID and its `Intl`-resolved form.
   - A prototype was run against Node 22 ICU data for both 2026-07-15 and 2026-01-15, with the same result on both dates. Top results: `EST` → New_York, `CST` → Chicago, `MST` → Denver, `PST` → Los_Angeles, and `GMT` → Europe/London. Every DST match ranked above every fixed-offset match. Without the primary key, alphabetical order put America/Grand_Turk ahead of New_York. Without the standard-phase abbreviation score (step 1 below), `GMT` put Atlantic/Azores first.
5. **Every row shows whether the zone observes DST:**
   - DST zone: generic name (`Eastern Time`), live clock, and both abbreviations (`EST / EDT`).
   - Fixed-offset zone: standard name (`Eastern Standard Time`), live clock, its single abbreviation, and a muted `Badge` reading "No DST".
   - Collapsed button: when the selected zone is fixed-offset, a small muted line under the button reads "No daylight saving time. Clocks stay at GMT-5 all year." This is a hint, not a warning, because the zone may be correct. It is how tenants already on Panama or Cancun will notice a mistaken choice.
6. **Save validation rejects non-location IDs rather than mapping them to a city.** A stored timezone must be `UTC` or an `Area/Location` ID that `Intl` recognises. The `Area` must be one of Africa, America, Antarctica, Arctic, Asia, Atlantic, Australia, Europe, Indian, or Pacific.
   - Rejected: bare names (`EST`, `MST`, `HST`, `EST5EDT`, `CET`, `Japan`), `Etc/*` other than UTC aliases, `SystemV/*`, and the backward-compatible areas `US/*`, `Canada/*`, `Mexico/*`, `Brazil/*`, and `Chile/*`.
   - The only values rewritten are UTC aliases: `Etc/UTC`, `Etc/UCT`, `Etc/Universal`, `Etc/Zulu`, `UCT`, `Universal`, `Zulu`, `GMT`, `Etc/GMT`, `Etc/GMT0`, `Etc/GMT+0`, `Etc/GMT-0`, `GMT0`, `Greenwich`, and `Etc/Greenwich` become `UTC`.
   - Why not map the rest: tzdata now treats `EST` as an alias of America/Panama. Mapping to that keeps the user's mistake. Mapping `EST` to America/New_York guesses what the user meant. Rejecting with a "choose a city" message is honest, and the picker never offers these IDs.
7. **A user timezone is checked only when it changes.** `updateUser` saves the whole profile at once. If a legacy value is still stored on another install, checking it on every save would block unrelated edits such as a phone-number change. The picker shows the stored legacy value and the server rejects any new invalid value. Tenant timezone saves are always explicit, so `setTenantTimezone` always checks.
8. **Reads stay lenient.** `normalizeIanaTimeZone` and `resolveEffectiveTimeZone` don't change. Making reads stricter would change computed `work_date` values for existing rows. No production rows need it.
9. **No migration and no backfill.** There are no legacy IDs to migrate. A fixed-offset location zone can't be safely rewritten, because Phoenix is often correct. The collapsed-button hint is how those zones get flagged.
10. **UTC is added to the picker list.** `Intl.supportedValuesOf('timeZone')` doesn't include `UTC`, but the validator accepts it and server defaults use it (`UserService.ts:1550`). It sits in the "Other" region (`timezonePicker.regions.Etc`).

## Changes, in implementation order

### 1. Shared timezone module: `packages/core/src/lib/timeZones.ts` (new)

This module is plain `Intl` code with no React. It is used by the server actions, the API schema, and the UI.

- `GEOGRAPHIC_TIME_ZONE_AREAS` and `UTC_TIME_ZONE_ALIASES`.
- `validateStorableTimeZone(input: string | null | undefined): { ok: true; timeZone: string | null } | { ok: false; reason: 'unrecognized' | 'not_location'; input: string }`. It trims the input and maps an empty string to `null`. It maps UTC aliases to `'UTC'`. It returns `unrecognized` when `new Intl.DateTimeFormat('en-US', { timeZone })` throws, and `not_location` when the ID fails decision 6. Callers decide whether `null` is allowed.
- `describeTimeZone(id, { locale, referenceDate })` returns a `TimeZoneDescriptor`:
  - `id`, `area`, `observesDst`
  - `standardOffset` and `daylightOffset` (`shortOffset` strings)
  - `abbreviations`: `short` and `shortGeneric` for both dates, in both locales, deduplicated
  - `names`: `long` and `longGeneric` for both dates, in both locales
  - `standardAbbreviation`: en-US `short` in the standard phase
  - `displayName`: `longGeneric` for DST zones and the standard-phase `long` name for fixed zones
  - `primary`, `preferred` (decision 4)

  The standard phase is the one with the smaller UTC offset. Formatters are cached by `(locale, timeZone, timeZoneName style)` at module level, and each one is reused for both dates.
- `PREFERRED_TIME_ZONES`: a `ReadonlySet<string>` built from `windowsTimeZones` values, excluding `Etc/*`, plus their `Intl`-resolved forms.
- `rankTimeZoneSearch(descriptors, query): { bestMatches: TimeZoneDescriptor[]; otherMatches: TimeZoneDescriptor[] }`
  - Normalise the query: trim, lower-case, and treat `_` as a space.
  - `bestMatches` holds zones matched by a time-zone name:
    - `standardAbbreviation` equal to the query scores 5
    - any other abbreviation equal to the query scores 4
    - a full name equal to the query scores 3
    - a name starting with the query (query of 3 or more characters) scores 2
    - a name containing the query (3 or more characters) scores 1

    Sort by score descending, then `observesDst` descending, then `primary` descending, then `preferred` descending, then `id`. Abbreviations must match exactly. Today's substring match lets a one-letter query pull in every abbreviation.
  - `otherMatches` holds zones matched only by ID, city, or region substring. The caller groups them by region, as the picker does today.
- `packages/core/package.json` exports: add `"./timeZones": { "import": "./dist/lib/timeZones.js", "types": "./src/lib/timeZones.ts" }`. Check that the tsup preset emits `dist/lib/timeZones.js`, the same way `./workSchedule` is emitted. `server/next.config.mjs:290` already aliases `@alga-psa/core/` to source.

### 2. Save-path validation

- **Tenant** (`tenantSettingsActions.ts:407-417`): replace the bare `Intl.DateTimeFormat` check with `validateStorableTimeZone`. `null` is not accepted here. Map `unrecognized` to the existing `msp/settings:errors.tenantSettings.invalidTimezone` (`server/public/locales/en/msp/settings.json:3472`). Map `not_location` to a new sibling key, `errors.tenantSettings.nonLocationTimezone`: "{{timezone}} isn't a city-based time zone. Choose a zone such as America/New_York." Save the returned `timeZone` (with UTC aliases already mapped) through `updateTenantSettings`. Check the `actionError` handling at `:48`, which matches on the `'Invalid timezone:'` message prefix, so that both reasons still show in `GeneralSettings.tsx:133-145`.
- **User** (`userActions.ts`):
  - Add `'INVALID_TIMEZONE'` to `UpdateUserErrorCode` (`:63-69`).
  - In `updateUser`, before `User.update` (`:1114`), when `'timezone' in userData`, read the stored timezone. You can extend the `select` that already runs for email (`:1087-1090`), or add a select for the case where email is unchanged. If the value differs from the stored one, run `validateStorableTimeZone`. On failure, return `{ success: false, code: 'INVALID_TIMEZONE', error }`. On success, write the returned value (`null` allowed).
  - The three `Record<typeof result.code, string>` maps fail to type-check until each has a key. Add one to each:
    - `server/src/components/settings/profile/UserProfile.tsx:274` → `profile.messages.error.invalidTimezone`
    - `packages/client-portal/src/components/profile/ClientProfile.tsx:110` → `profile.messages.invalidTimezone`
    - `server/src/components/settings/general/UserDetails.tsx:324` → `userDetails.messages.error.invalidTimezone`
  - Put the strings in the namespaces those components already use.
- **REST API** (`server/src/lib/api/schemas/userSchemas.ts:42-44`): replace the regex with a `z.string().transform/superRefine` that calls `validateStorableTimeZone`. The create and update schemas both inherit it through `createUpdateSchema`. `UserService.create` (`packages/users/src/services/UserService.ts:277`) then receives a value that is either valid or mapped to `UTC`.
- **Find any other writers:** grep for other writers of `users.timezone` and `settings.timezone`. Found so far: `updateUser`, `UserService.create`/`update`, and `setTenantTimezone`. `updateTenantSettings` is generic, and the callers found pass other keys. Any new writer that turns up gets the same validator.

### 3. Picker rewrite: `packages/ui/src/components/TimezonePicker.tsx`

- Keep the component, its props, the `cmdk` structure, the collapsed and expanded states, and the `useDateFormat` and `formatDateValue` preview clock (`:52-73`). The existing country-clock tests must keep passing.
- Build descriptors from `Intl.supportedValuesOf('timeZone')` plus `UTC`, using `describeTimeZone` with `referenceDate = new Date()`. Build them when the picker is first expanded, not on mount, and cache them at module level by `(locale, year)`. Every settings page renders a collapsed picker, so building on mount would charge every page for the build. The collapsed button needs only the selected zone's descriptor.
- Replace `filteredOptions` and `groupedOptions` (`:109-170`) with `rankTimeZoneSearch`. `bestMatches` keeps the `timezonePicker.matchingGroup` heading. `otherMatches` stays grouped by region as today.
- Row (`:219-238`):
  - zone label (`replaceAll('_', ' ')`; the current `replace` only changes the first underscore)
  - the `displayName` and clock
  - on the right: both abbreviations for a DST zone, or one abbreviation plus `<Badge variant="default-muted" size="sm">` with `timezonePicker.noDst` for a fixed zone
- Collapsed button (`:178-195`): when the selected zone is fixed-offset, show the `timezonePicker.noDaylightSavingHint` line, interpolating `{{offset}}`.
- If the stored `value` is not a zone that can be stored, show it as it is, without a crash or blank label, so that an existing legacy value can be seen and replaced.
- Locale keys: add `timezonePicker.noDst` and `timezonePicker.noDaylightSavingHint` to `server/public/locales/en/common.json:1337-1355`. Update `searchPlaceholder` to "Search by city, name, or abbreviation (e.g. New York, EST)...". Add the same keys to de, es, fr, it, nl, pl, pt, sv, and to the xx and yy pseudo-locales. Then run `node scripts/validate-translations.cjs`.

### 4. Tests

- **`packages/core/src/lib/timeZones.test.ts`** (new, next to the existing core tests):
  - Validator:
    - accepts America/New_York, America/Panama, America/Port-au-Prince, America/Argentina/Buenos_Aires, Asia/Kolkata, and Australia/Sydney
    - maps `UTC`, `Etc/UTC`, `GMT`, and `Etc/GMT+0` to `UTC`
    - rejects `EST`, `MST`, `HST`, and `EST5EDT` as `not_location`, along with `Etc/GMT+5`, `US/Eastern`, and `SystemV/EST5`
    - returns `unrecognized` for `Not/AZone`, and `null` for an empty string
  - Descriptor:
    - New_York, Denver, Chicago, and Sydney observe DST
    - Panama, Phoenix, and Regina do not
    - New_York's abbreviations include both `EST` and `EDT`
  - Ranking, run with `referenceDate` set to 2026-07-15 and again to 2026-01-15, which must give the same order:
    - `EST`, `est`, and `Eastern Standard Time` put America/New_York first, and every DST match ranks above America/Panama, Cancun, and Jamaica
    - `CST` puts America/Chicago first, with Regina and Mexico_City after every DST match
    - `MST` puts America/Denver first, with Phoenix after every DST match
    - `EDT` puts New_York first and doesn't include Panama
    - `New York` returns New_York
    - `e` produces no abbreviation best-matches
- **`packages/ui/src/components/TimezonePicker.search.test.tsx`** (new; jsdom; same i18n mock as `TimezonePicker.i18n.test.tsx`):
  - Use `vi.useFakeTimers({ toFake: ['Date'] })` at 2026-07-15 and at 2026-01-15. For each date, open the picker and type `EST`. The first option is America/New York, and America/Panama's row has the "No DST" badge.
  - The collapsed button for `America/Panama` shows the no-DST hint, and the button for `America/New_York` does not.
  - The `MST` search puts Denver above Phoenix.
- **Save-path tests:**
  - `setTenantTimezone`: next to `tenantSettingsActions.experimentalFeatures.test.ts`, mocking `updateTenantSettings`. Rejects `EST` and `Etc/GMT+5` with the right message key. Accepts `America/New_York` unchanged. Saves `Etc/UTC` as `UTC`.
  - `updateUser`: DB integration test under `server/src/test/integration/` (see the integration-testing skill).
    - Changing to `EST` returns `INVALID_TIMEZONE` and leaves the stored value as it was.
    - Changing to `America/New_York` saves.
    - When a row already holds `EST` and the update includes the same `EST` alongside a phone change, the update succeeds.
    - `null` clears the zone.
  - `userSchemas.timezoneSchema` unit test: accepts `America/Port-au-Prince` and `UTC`, and rejects `EST`, `Etc/GMT+5`, and `US/Eastern`.
- Existing suites that must stay green: `TimezonePicker.i18n.test.tsx`, `GeneralSettings.defaultClientConfirmation.test.tsx`, `ee/.../Schedules.test.tsx`, and `themeContract.test.ts`.

### 5. Leverage markers (notes only, no refactors)

Add `// LEVERAGE: pattern iana-zone-catalog` markers at the other places that build their own zone list or validate zones. Each points at `@alga-psa/core/timeZones`:

- `server/src/app/api/public/appointment-request/available-dates/route.ts:20`
- `.../available-slots/route.ts:19`
- `ee/packages/workflows/src/components/automation-hub/workflowScheduleTimezoneOptions.ts:23`
- `packages/db/src/lib/workDate.ts:5`

## What this deliberately does not do

- **Production data stays as it is.** The reporting tenant's default stays `America/Panama` until the customer changes it. Customer communication stays with Robert. The Update PSA Ticket step posts an internal note only.
- **No migration or backfill.** There are no legacy IDs in production, and fixed-offset location zones are often correct.
- **No change to read-time resolution.** That means `normalizeIanaTimeZone`, `resolveEffectiveTimeZone`, `resolveUserTimeZone`, and the browser-zone display in `packages/core/src/lib/dateTimeUtils.ts:195`.
- **No save validation for other timezone fields.** Clients (`ClientDetails.tsx`, `server/src/lib/api/schemas/client.ts`), teams, SLA business-hours schedules, appointment requester zones, and workflow and extension schedules keep their current checks. Workflow and extension schedules intentionally allow `Etc/GMT+5` through their Custom option. Every picker user still gets the new ranking and labels. Applying the validator to clients and SLA schedules is a follow-up.
- **No browser-zone suggestion.** The picker won't suggest "Your browser is in America/New_York" when the stored zone is fixed-offset. That would be a useful follow-up, but it is not needed to fix the reported bug.
- **No change to the time-entry code** (`timeEntryPeriodSelection.ts`, `timeEntryLauncher.tsx`). It already reads the user's stored zone correctly.

## Risks

- **`Intl` data varies by engine and ICU version:** canonical IDs (`Asia/Kolkata` and `Asia/Calcutta`), generic names, and en-US short names such as `GMT+1` for Europe. Tests should check structure (ordering, the DST flag, and US abbreviations, which are stable in CLDR) rather than exact strings for non-US zones. Preferred-zone matching uses both raw and resolved forms.
- **Cost of building descriptors:** the en-US prototype took about 150 ms in Node 22 with cached formatters, against about 260 ms without. A non-English locale adds a second pass. Building on first expand with a module-level cache (step 3) keeps this off page load. Measure the first open in the dev browser. If it is noticeable, build the user-locale names lazily, because only `displayName` needs them.
- **Some abbreviations never match:** en-US `short` gives offsets rather than letters for most zones outside North America and Europe (Sydney is `GMT+11`, not `AEST`). Searches like `AEST` or `IST` find nothing through abbreviations. They still match by name ("Australian Eastern", "India"). This is unchanged from today.
- **API behaviour change:** `/api/v1/users` will reject `US/Eastern`-style aliases that the old regex accepted, and will accept `UTC` and hyphenated zones that it rejected. Production has none of the newly rejected values. Mention the change in the PR.
- **Legacy values are still stored on other installs:** they keep working on read and are only rejected when changed. The collapsed picker must render a stored value that is no longer valid.
- **`core` subpath export:** consumers resolve `dist` outside the Next alias. Build `packages/core` and check that `@alga-psa/core/timeZones` resolves in `packages/ui` vitest, in `server` vitest, and in `next build`.
- **The error-key maps are exhaustive by type.** Adding `INVALID_TIMEZONE` fails the type-check until all three components map it. That is intended, but CI will catch any consumer that was missed.
