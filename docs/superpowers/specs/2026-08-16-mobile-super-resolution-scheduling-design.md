# Mobile Super-resolution Scheduling Design

## Goal

Keep scrolling, swiping, zooming, page changes, and original-image decoding responsive while Waifu2x or Real-CUGAN runs on a mobile GPU. Super-resolution remains automatic, cached, cancellable, and transparent to normal reading.

## Root Cause

Super-resolution JavaScript runs in a Worker, but WebGPU inference and browser compositing share the same mobile GPU. The Worker currently submits every tile without an intentional gap. Reader also runs the enhanced-image upgrade inside the critical image decode job, so a long inference occupies a decode slot. Cancellation occurs after page changes, not when an interaction starts, and cannot interrupt an in-flight tile.

## Considered Approaches

1. **Interaction-aware background scheduling (selected):** move the enhanced upgrade to background priority, cancel it when active interaction changes the visible page, delay new work until interaction settles, and yield between tiles. Small change; preserves current runtime and cache.
2. **Persistent tile pause/resume:** retain partial output and resume at the exact tile after interaction. Avoids repeated work, but adds protocol and cache state for little expected benefit.
3. **Lower resolution or different models on mobile:** reduces load but changes output quality and model behavior. Keep as a future measured option, not this fix.

## Design

### Reader Scheduling

- Display and decode the original image first, unchanged.
- Schedule the enhanced-image upgrade at background priority rather than inheriting the page's critical decode priority.
- Treat pointer/touch gestures and Webtoon scrolling as foreground interaction.
- During interaction, cancel current visible-page super-resolution. Start the visible page again only after a short quiet period.
- Page changes keep the existing cancellation behavior. Stale results never replace the new page.
- Double-page mode keeps current behavior of processing visible spread pages; the single Worker still serializes inference.

### Worker Cooperation

- After each completed tile, yield once to the Worker event loop before starting the next tile.
- Check cancellation both before and after the yield.
- Apply the same behavior to ONNX Runtime and Real-CUGAN paths.
- Do not attempt to interrupt an active `session.run()` or `executeAsync()` call; the maximum response delay remains one tile.

### Failure and Compatibility

- No new dependency, setting, cache version, model manifest, or Worker capability requirement.
- Cached enhanced images still load immediately.
- Cancellation remains silent and retains the original image.
- Model, WebGPU, encoding, and cache failures keep existing fallback and notification behavior.

## Verification

- Unit tests prove tile loops yield and observe cancellation after the yield.
- Queue tests prove enhanced upgrades use background priority and do not block critical original-image decode work.
- Reader contracts prove interaction starts cancel visible super-resolution and quiet completion permits a retry.
- Existing super-resolution, Reader, lint, check, and production build suites remain green.
- Android manual check: enable each model, swipe/zoom/scroll during inference, confirm interaction remains usable and the visible page upgrades after settling.

## Scope

No adaptive thermal policy, frame-time telemetry, user-facing throttle control, partial-tile persistence, or model-quality change. Add these only if device testing shows interaction-aware yielding insufficient.
