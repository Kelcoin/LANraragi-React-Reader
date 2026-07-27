# Favorites, Filter Count, and Worker Visibility Design

## Goal

Add LANraragi Favorites actions to archive context menus, preserve valid filtered result totals across reader navigation, and hide Worker-dependent controls when Worker configuration is incomplete or invalid.

## LANraragi Favorites

- The server-side category name remains exactly `🔖 Favorites`.
- The UI displays that category as `⭐收藏夹` everywhere it renders category names.
- Context menus show `添加到收藏夹` when the archive is absent and `从收藏夹移除` when present.
- The action is available in the shared archive menu and the deduplicate-page archive menu.
- Category state comes from `GET /api/categories`, whose static category objects include an `archives` array.
- If `🔖 Favorites` does not exist, create it with `PUT /api/categories` using `application/x-www-form-urlencoded`, then add the archive with `PUT /api/categories/{id}/{archive}`.
- Remove membership with `DELETE /api/categories/{id}/{archive}`.
- Every protected request uses the existing Base64 Bearer authorization helper. API keys and headers are never logged.
- Successful mutations update the existing category cache and notify mounted UI. Failures keep the menu open and expose an actionable status message.

## Filter Count Fix

LANraragi search responses may contain `null` or empty total fields. JavaScript converts both to numeric zero, so the current total resolver can replace a valid snapshot total with `0` after returning from the reader.

The shared total resolver accepts only non-empty finite values. When no valid total exists, it preserves the previous valid total; an empty result reports zero only when no previous total exists. Snapshot normalization also distinguishes `null` from numeric zero.

## Worker Visibility

A Worker configuration is usable only when:

- Worker URL parses as an HTTP(S) URL.
- Sync Token is non-empty after trimming.

When unusable, hide rather than disable:

- Remote history and watchlist refresh buttons.
- E-Hentai synchronized favorite-deletion setting and per-delete option.
- Deduplicate-page whole-group selection, ignored-pair loading, related warnings, and mark-as-not-duplicate execution.

Local history, local watchlist, archive deletion, duplicate detection, and archive-level deletion selection remain available.

## Testing

- Unit-test Worker configuration validation.
- Unit-test total normalization with `null`, empty strings, zero, and previous totals.
- Unit-test Favorites category lookup, display mapping, creation, add, remove, and cache updates through dependency-injected request behavior.
- Add UI contract checks for both context-menu labels and Worker-based conditional rendering.
- Run full tests, lint, build, and a browser UI check at desktop and mobile widths.
