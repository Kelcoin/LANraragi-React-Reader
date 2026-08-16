# Reader Controls, Super-Resolution, And Watchlist Motion Design

## Goal

Correct the E-Hentai action-button alignment, make archive super-resolution shut down predictably, warn before enabling it for oversized pages, and give newly inserted Home watchlist cards restrained feedback.

## Decisions

- Normalize the existing `.btn` primitive and remove the inactive E-Hentai icon gap. Do not create a new button component or rewrite unrelated local button styles.
- Treat `AbortError` as silent cancellation. Every other page-processing error disables only current-archive super-resolution, cancels visible work, and keeps the global preference unchanged.
- Exiting immersive mode uses the same archive-level disable path.
- Reuse `SUPER_RESOLUTION_MAX_INFERENCE_PIXELS` as the sole oversized boundary. The toggle remains available; enabling from an oversized current page requires `ConfirmDialog` confirmation. Oversized pages remain original while eligible pages in the archive may still be processed.
- Detect watchlist insertion by comparing archive IDs before and after the existing change event. Animate only the first newly inserted card for 280ms with opacity, vertical offset, and slight scale; disable the animation under `prefers-reduced-motion`.
- Detect successful watchlist removals from the same event. Retain removed cards for a 220ms non-interactive fade/downscale exit, then commit the new list; failed removals never emit the change and therefore never animate. Reduced-motion users receive the new list immediately.
- Reuse the same 280ms entrance and 220ms successful-exit behavior for the Home continue-reading carousel. Initial history hydration remains static, history removal failures remain visible, and the shared CSS classes and ID-difference helpers use archive-generic names.

## Verification

- Pure state tests cover failure policy, oversized boundary, and insertion detection.
- UI contracts cover button normalization, confirmation wiring, immersive cleanup, card marking, keyframes, and reduced-motion behavior.
- Full test, lint, audit, build, and diff checks gate the commit.
