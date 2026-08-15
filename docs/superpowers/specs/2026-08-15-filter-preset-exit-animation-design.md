# Filter Preset Exit Animation

## Scope

Add a closing animation to the filter preset menu in both implementations:

- the Home archive filter in `src/pages/Home.jsx`
- the shared search box in `src/components/ArchiveSearchBox.jsx`

The existing opening animation and outside-interaction behavior remain unchanged.

## Behavior

The menu has three lifecycle states: unmounted, open, and closing. A close request moves an open menu into the closing state instead of immediately unmounting it. The closing menu receives an `is-closing` class and remains non-interactive until its CSS animation completes. `animationend` then unmounts it.

Opening while a close is pending cancels the closing state and keeps one menu instance. When reduced motion is requested, the closing animation duration becomes effectively immediate while preserving the same lifecycle.

## Presentation

The exit motion reverses the existing entrance language: opacity decreases while the menu moves slightly upward and scales down. Duration is approximately 140 ms so dismissal feels responsive. The menu keeps its top-center transform origin.

## Verification

Regression coverage must verify both menu implementations retain the menu during closing, attach `is-closing`, and unmount on `animationend`. Browser verification must confirm outside pointer and focus dismissal visibly animate before the menu disappears.
