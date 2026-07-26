# Category Filter and SVG Logo Design

## Goal

Preserve the current archive search input when a category is selected, apply the category as an additional API filter, and replace bitmap logos shown by the website with one SVG reproduction of the existing Readoshi mark.

## Category Filtering

`Home` keeps the current query, sort field, and order when a category button is toggled. The click handler recalculates `filter.active` from the trimmed query so text already present in the input immediately participates in the request, even if the user has not pressed the filter button first.

The existing request path remains authoritative:

- The text query is sent as the LANraragi search query.
- The selected category ID is sent through the existing `category` search option.
- Clearing the category removes only the category condition.
- Static categories may still use their archive ID list when no text query is active.
- Untagged mode continues to use its dedicated API path.

No new filtering abstraction or client-side intersection is added.

## SVG Logo

Add one `public/logo.svg` that reproduces the current open-book and page-stack silhouette. The SVG contains one geometry source and an internal system-theme fill rule for favicon use.

Home and login surfaces render the SVG through a CSS mask. Their existing dimensions stay unchanged, while CSS supplies the correct foreground color from the active application theme. This replaces both black and white PNG `<img>` elements without duplicating SVG paths.

`index.html` uses the SVG as the browser favicon. Apple Touch Icon and PWA manifest icons remain PNG because those installation surfaces have less reliable SVG support. Existing PNG logo files may remain as unused compatibility/source assets; removing them is outside this change.

## Error Handling

No new network boundary is introduced. Category requests keep existing loading, abort, empty-result, and error behavior. If SVG loading fails, the adjacent `Readoshi` text remains visible.

## Tests and Acceptance

Regression tests will assert:

- Category clicks preserve query, sort, and order and activate a non-empty current query.
- Search requests combine the text query with the selected category ID.
- Home and login no longer reference bitmap logo files.
- The website and favicon reference `logo.svg`.
- Apple Touch Icon and PWA manifest keep PNG icons.

Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`. After successful verification, commit all approved working changes and push `dev` to `origin`.
