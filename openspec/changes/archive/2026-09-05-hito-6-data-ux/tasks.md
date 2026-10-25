# Tasks: hito-6-data-ux

Estimate: 380–470 lines.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `{when}` + storage.onChanged port widening; `refresh-now` worker branch | PR 1 (base feature branch) | `npm --prefix extension run test -- src/platform/browser-api.test.ts src/background.test.ts` | N/A — MV3 worker; hermetic suite | Revert PR 1 files; periodic refresh unchanged |
| 2 | Hero %, in-bar %, keyless filter, refresh action, styles | PR 2 (base PR 1) | `npm --prefix extension run test -- src/popup/view.test.ts src/popup/controller.test.ts` | `npm --prefix extension run build`, load unpacked dist | Revert PR 2 files; hito-5 popup returns |

## Phase 1: Port widening

- [x] 1.1 RED new `extension/src/platform/browser-api.test.ts`: stubbed `chrome` — `create('refresh-now', { when })` forwards; `storage.onChanged.listen` wires via `chrome.storage.onChanged.addListener`
- [x] 1.2 RED same file: `FakeAlarms` stores `{ when }`; `FakeBrowser.storage.onChanged` fires on local `set`
- [x] 1.3 GREEN `extension/src/platform/browser-api.ts`: widen `BrowserAlarms.create` to `{ periodInMinutes } | { when }`; add `storage.onChanged` port + adapter
- [x] 1.4 GREEN `extension/src/testing/fake-browser.ts`: widen `FakeAlarms`, add `onChanged`; align `AlarmRecorder.create` in `extension/src/background.test.ts`
- [x] 1.5 Verify typecheck + suite green

## Phase 2: Worker one-shot alarm

- [x] 2.1 RED `extension/src/background.test.ts` describe: firing `refresh-now` runs one tick: badges + one snapshot write [shared tick]
- [x] 2.2 RED: `usage-refresh` stays registered, period 1, no duplicate create [periodic unchanged]
- [x] 2.3 RED: unknown alarm name → no tick, zero writes [unknown ignored]
- [x] 2.4 GREEN `extension/src/background.ts`: export `REFRESH_NOW_ALARM`; `onAlarm` routes both names to `refreshTick`; `ensureAlarm` untouched

## Phase 3: View changes

- [x] 3.1 RED `extension/src/popup/view.test.ts`: ZAI 137% renders as `hero-percentage` above all card content, uncapped; no hero on monetary/MCP cards [ZAI budget]
- [x] 3.2 RED: same 137 inside/over the 5h bar (`bar-pct`), independently assertable; fill still caps at 100 [capped fill]
- [x] 3.3 RED: keyless `kimi` renders no main card; settings keeps it; keyed-no-snapshot renders [keyless no card]
- [x] 3.4 RED: `renderMain` header carries `data-action="refresh"`; settings does not [affordance]
- [x] 3.5 GREEN `extension/src/popup/view.ts`: hero after provider name when `fiveHour.percentage` exists; `bar-pct` on the primary bar; filter on `keyStates`; header refresh button
- [x] 3.6 Update existing view tests: seed `keyStates`; adjust bar markup for `bar-pct`; determinism green [bands; errors; determinism]

## Phase 4: Controller refresh action

- [x] 4.1 RED `extension/src/popup/controller.test.ts` describe: clicking `[data-action="refresh"]` registers storage-change listener, then creates `refresh-now` with `{ when: now + 1 }` [activation]
- [x] 4.2 RED: new `SnapshotStore.write` → re-read + re-render with new data; repeated clicks add no listeners [re-read]
- [x] 4.3 GREEN `extension/src/popup/controller.ts`: `refresh` branch — module-local `REFRESH_NOW_ALARM` (AD-24: no background import), idempotent listener on local + snapshot key, re-read via `SnapshotStore`, re-render

## Phase 5: Styles + gate

- [x] 5.1 `extension/public/popup.html`: `.hero-percentage` largest/boldest; `.bar` relative + `.bar-pct` overlay; refresh reuses `.header-action`
- [x] 5.2 Gate: `npm --prefix extension run test`, `typecheck`, `build` green; `package.json` unchanged

All 14 scenarios (8+3+3) mapped.
