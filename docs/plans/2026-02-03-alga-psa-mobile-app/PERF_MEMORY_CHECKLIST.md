# Mobile Perf/Memory Checklist (Large Lists)

This checklist is for preventing and diagnosing memory leaks and performance regressions in the mobile ticket list and other large virtualized lists.

## Guardrails (code)

- Use `FlatList`/`SectionList` virtualization props (`windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`) and keep them stable.
- Avoid re-render storms:
  - Memoize row components (`React.memo`) and pass stable callbacks (`useCallback`).
  - Avoid creating inline objects/functions in `renderItem`/rows where practical.
- Prefer incremental pagination over “load everything”.
- Avoid retaining large arrays in module-level singletons; cache with TTL and explicit clear actions.

## Profiling checklist (manual)

### iOS

- Use Xcode Instruments:
  - **Leaks**: verify no growth while scrolling up/down for 2–3 minutes.
  - **Allocations**: look for steadily increasing allocations while list is idle.
  - **Time Profiler**: look for hot components during fast scroll.

### Android

- Use Android Studio Profiler:
  - **Memory**: watch for heap growth that doesn’t return after GC.
  - **CPU**: confirm smooth scrolling (no repeated long JS frames).

### Common scenarios to test

- Typing into ticket search quickly (ensure request cancellation + no UI jank).
- Switching filters repeatedly, then scrolling.
- Opening/closing ticket detail repeatedly from the list.
- Background → foreground resume with refresh enabled.

## Regression indicators

- Memory baseline increases continuously across repeated list scroll passes.
- “White screen” pauses or dropped frames during scroll.
- Increased API request fan-out (duplicate concurrent GETs).

