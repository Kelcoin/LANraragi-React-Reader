# History Cleanup and Dedupe Usability Design

## Scope

Improve manual and automatic invalid-history cleanup, expand duplicate-group selection targets, and expose tags used by smart duplicate selection. Keep existing storage, dialogs, selection semantics, and visual system.

## History Cleanup

### Root Cause

`runHistoryExistenceCheck` respects a six-hour interval but calls non-forced history and watchlist loads during automatic checks. Cached archive metadata therefore skips LANraragi validation. Watchlist hydration also ignores its `force` option. Automatic cleanup can run without actually checking cached archives.

### Validation Flow

- Keep the existing six-hour scope-aware interval and shared in-flight promise.
- Once a scheduled check is due, force metadata validation for both history and watchlist records.
- Pass the watchlist load `force` option into archive hydration.
- Remove missing records through existing history/watchlist removal functions so local and Worker state keep their current retry behavior.
- Return the combined number of removed history and watchlist records.

### Manual Interaction

- Starting manual cleanup closes the archive context menu and sets the page to a busy state.
- While busy, disable refresh and cleanup actions and make search, multi-select controls, archive cards, and context-menu entry points inert.
- Keep the Back action enabled.
- Continue showing `检查中` on the cleanup button.
- After completion, refresh displayed history. Show the existing non-destructive notice dialog only when at least one record was removed: `已清理 N 条失效记录。`
- On failure, unlock the UI and show the error in the same notice dialog.

### Automatic Interaction

Automatic cleanup remains silent. It must not open a dialog or change page-level busy state. Errors remain caught by the timer; the last-check timestamp is written only after a successful check.

## Duplicate Groups

### Group Selection Target

- Clicking a group background, border, padding, or gap toggles the whole group for the existing "mark as non-duplicate" operation.
- Clicking an archive card continues to select that archive for deletion and must not bubble to group selection.
- The existing group header button remains the keyboard-accessible selection control and must stop propagation to avoid double toggles.
- Group selection remains unavailable when Worker-backed non-duplicate marking is unavailable.

### Smart Selection Tags

Each duplicate archive displays compact badges beside its size/page metadata when these exact tags are present:

- `other:rough translation`: `渣翻`, warning treatment.
- `other:extraneous ads`: `外部广告`, warning treatment.
- `other:uncensored`: `无修正`, positive treatment.

Tag matching remains case-insensitive and whitespace-normalized. One shared helper supplies both smart-selection scoring and badge visibility so UI labels cannot drift from actual selection rules. Archives without these tags retain the current compact metadata row without empty badge space.

## Testing

- Regression contract: HistoryPage locks all interactive content except Back while cleanup runs, reports positive removal counts, and stays silent for zero removals.
- Unit/contract coverage: scheduled maintenance forces history and watchlist validation; watchlist forwards `force` into hydration; timer callers remain silent.
- Regression contract: duplicate group container toggles group selection while archive items stop propagation.
- Unit coverage: shared smart-selection signals detect all three tags and preserve existing selection priority.
- Regression contract: all three Chinese badges render from shared signals.
- Run full tests, lint, production build, and `git diff --check`.

## Non-Goals

- No new global loading overlay or reusable badge component.
- No changes to smart-selection priority.
- No cleanup success dialog when nothing was removed.
- No automatic-cleanup notifications.
