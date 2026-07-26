# Category Filtering And Context Menu Design

## Scope

- Make category buttons compatible with LANraragi static and dynamic categories.
- Pin `🔖 Favorites` first while keeping its server-side name unchanged.
- Unify watchlist and Favorites context-menu copy and remove idle spacing.

## API Contract

LANraragi `GET /api/categories` returns `CategoryMetadataJson` entries. Static categories expose archive IDs through `archives`; dynamic categories expose a `search` expression and leave `archives` empty.

No category mutation is part of filtering. Existing authenticated Favorites add/remove endpoints remain unchanged.

## Category Behavior

Clicking a category clears the current text filter and resets archive pagination.

- Static category: slice its `archives` IDs for the requested page or scroll batch, then reuse the existing concurrent metadata loader. Preserve API archive order.
- Dynamic category: send its `search` expression to the existing archive search API.
- Re-click selected category: clear category selection and restore the full archive catalog.
- Untagged: retain its existing `/api/archives/untagged` path.

After a category is active, applying a text filter keeps that category selected and adds the input as a narrower condition:

- Static or dynamic category: call `/api/search` with both `category=<id>` and `filter=<input>`.
- Untagged: call `/api/search` with `untaggedonly=true` and `filter=<input>`.
- Clearing the input restores the full active category instead of clearing category selection.

The archive search response cache includes the category and untagged restriction so results cannot leak between scopes.

Favorites is sorted before every other category in the button row. Other category order remains unchanged.

## Context Menu

Use parallel labels and neutral styling:

- `加入收藏夹` / `移出收藏夹`
- `加入待看` / `移出待看`

Only destructive archive/history actions use danger styling. Loading text replaces the Favorites button label while work is active. The live-status region must not reserve visible height when empty; visible inline status appears only for errors.

## Error Handling

- Missing static archives produce the existing empty category state.
- Missing archive metadata is skipped using the existing `ignoreMissing` behavior.
- Dynamic-category and metadata failures use the existing archive load error surface.
- Favorites failures keep the menu open and show the existing inline error.

## Tests

- Category helper distinguishes static and dynamic loading data.
- Favorites sorts first without mutating the source list.
- Home routes static categories through archive IDs and dynamic categories through `search`.
- Active category searches preserve category selection and send the documented category or untagged restriction.
- Context-menu contracts enforce unified labels, neutral removal styling, conditional error status, and no idle status spacing.
- Run full unit tests, lint, production build, and browser layout checks.
