# Archive Bulk Actions and Deletion Feedback Design

## Scope

- Restore a visible checkbox indicator for archive-card multi-selection.
- Animate the multi-selection action row without abrupt page displacement.
- Add `收藏所选` between select-all and delete-selected.
- Show dedupe-style progress during bulk archive deletion and bulk favorites.
- Report E-Hentai favorite-removal failures after every archive deletion flow without blocking LANraragi deletion.
- Preserve existing retries for both E-Hentai and LANraragi operations.

## Shared UI

Move the existing execution progress panel and archive deletion failure report into small shared components. Dedupe, Home, History, Metadata, and Recommendations use the same progress and failure presentation instead of duplicating markup.

The failure report lists E-Hentai URLs with messages and a one-click copy action. LANraragi failures remain separately listed. Closing a report runs any page-specific follow-up navigation.

## Archive Selection

`ArchiveCard` renders a fixed checkbox indicator while selection mode is active. The whole card remains the hit target. Selection mode exposes checkbox semantics and keyboard activation; selected cards retain the current accent outline.

The action row keeps its mounted grid track while opening and closing. Its inner content animates opacity and transform, while the grid track animates between zero and full height so content below moves smoothly.

## Bulk Favorites

`收藏所选` starts immediately because adding to Favorites is reversible and non-destructive. It processes selected archive IDs through the existing `setArchiveFavorite(id, true)` API wrapper, which creates `🔖 Favorites` when missing and skips archives already present.

A modal displays current item and total progress. Completion reports success count and any per-archive failures. Current archive selection stays intact.

## Deletion Flow

All archive deletion callers use `deleteArchiveWithFavoriteSync` with `continueOnFavoriteError: true` and collect failures through `onFavoriteError`. E-Hentai failures never prevent the LANraragi delete attempt.

Bulk deletion keeps its confirmation dialog open and non-dismissible while running. Progress advances once per archive. Successful LANraragi deletions are removed from local lists; failed archives remain selected. After completion, the confirmation closes and a shared failure report opens when needed.

Single deletion flows keep current confirmation behavior. If E-Hentai removal fails but LANraragi deletion succeeds, the archive is removed and the shared report opens. Metadata navigation waits until the report closes.

Recommendations adopts the same deletion wrapper and E-Hentai confirmation switch as other archive surfaces.

## Tests and Verification

- Regression contracts cover checkbox markup/styles, animated action-row height, bulk favorite placement, progress UI, and every deletion caller's failure continuation.
- Unit tests continue covering retry and deletion ordering.
- Run full tests, lint, build, and diff checks.
- Browser verification covers checkbox states, action-row movement, bulk favorite progress, bulk deletion progress, and failure-report rendering before push.
