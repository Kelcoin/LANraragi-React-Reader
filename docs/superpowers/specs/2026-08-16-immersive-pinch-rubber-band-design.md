# Immersive Pinch Rubber-Band Design

## Goal

Make immersive-reader pinch zoom feel elastic at both scale limits without changing normal zoom behavior.

## Behavior

- Keep direct distance-to-scale mapping from `1.0` through `3.0`.
- Below `1.0`, apply continuous resistance that approaches `0.90`.
- Above `3.0`, apply continuous resistance that approaches `3.35`.
- On gesture release, snap any lower overshoot to `1.0` and any upper overshoot to `3.0`.
- Preserve the release-position focal point and existing `0.15s ease-out` transform animation.
- Do not change double-tap zoom, wheel zoom, panning, page swiping, or Webtoon mode.

## Mapping

Use one pure helper with a piecewise rational rubber-band curve:

```text
inside bounds: visual = raw
below minimum: visual = min - excess / (1 + excess / lowerRange)
above maximum: visual = max + excess / (1 + excess / upperRange)
```

Where `min = 1.0`, `max = 3.0`, `lowerRange = 0.10`, and `upperRange = 0.35`.
The curve is continuous with unit slope at each boundary, then progressively resists further movement.

## Integration

Add the helper to `readerUiState.js` beside existing immersive zoom math. `Reader.jsx` converts raw pinch distance to raw scale, passes it through the helper, and applies the returned visual scale. `applyZoomAtPoint` must allow the helper's temporary lower overshoot while keeping other callers bounded.

## Tests

- Values inside `1.0-3.0` remain unchanged.
- Lower overshoot stays between `0.90` and `1.0` and shows diminishing movement.
- Upper overshoot stays between `3.0` and `3.35` and shows diminishing movement.
- Reader uses the helper for pinch gestures and retains release snap targets.
