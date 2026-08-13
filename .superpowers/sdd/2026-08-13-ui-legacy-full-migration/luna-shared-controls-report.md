# Luna Shared Control Migration Report

## Scope

Migrated the owned shared controls to semantic primitives while preserving Base UI behavior, callbacks, popup positioning, durations, progress widths, and runtime styles explicitly allowed by the brief.

## RED

Added `shared controls use semantic primitives and class-driven visuals` to `tests/ui-system.test.mjs` and ran:

```text
node --test tests/ui-system.test.mjs
```

The new contract failed because `CustomSelect` still consumed `input-glass`.

## GREEN

After migrating the owned JSX and adding component-specific rules to `src/styles/primitives.css`, the focused contract passed:

```text
node --test tests/ui-system.test.mjs
21 tests, 21 pass, 0 fail
```

The direct legacy-class regression expectation for `CustomSelect` was updated to `field custom-select-trigger`.

## Verification

```text
node --test tests/ui-system.test.mjs tests/regression-contracts.test.mjs tests/body-scroll-lock.test.mjs tests/pwa-install.test.mjs
173 tests, 173 pass, 0 fail

npm test
421 tests, 421 pass, 0 fail

npm run lint
exit 0, no warnings or errors

git diff --check
exit 0
```

Runtime inline styles remain only where required: `CustomSelect` external positioning, `DatePicker` measured `left/top`, `Toast` `--toast-duration`, `CacheSettings` progress width, and existing date jump sizing props.
