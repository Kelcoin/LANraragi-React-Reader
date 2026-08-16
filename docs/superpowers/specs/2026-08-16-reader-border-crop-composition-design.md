# Reader Border Crop Composition Design

## Goal

Place automatic border cropping with the other reading-layout controls and make it compose correctly with split-wide and rotate-wide rendering in normal and immersive readers.

## Confirmed Behavior

- The setting moves from `通用` to `阅读`, immediately before the wide-page controls.
- Without automatic border cropping, split-wide and rotate-wide behavior remains unchanged.
- With cropping enabled, a split page is divided at the horizontal midpoint of the detected content rectangle, not the original bitmap.
- Each selected content half is contained and centered within its own slot. This also applies when the reading layout is double-page.
- Rotate-wide content is cropped and centered in source-image coordinates before the 90-degree rotation.
- Split-wide takes precedence when split-wide and rotate-wide are both enabled, matching current behavior.
- Normal and immersive readers use the same crop geometry.

## Architecture

Extend the existing pure split-frame helper to accept normalized border insets and return both the full-image frame and the selected region's clip insets. Keep the existing zero-inset result byte-for-byte compatible in geometry. `PageImage` and the immersive image loader consume that helper, while non-split images continue to use the existing crop-center translation.

Immersive decoding records detected insets on its persistent image element so resize restyling and already-decoded image reuse do not repeat detection or lose crop state.

## Validation

- Pure geometry tests cover asymmetric borders on both split halves.
- Existing zero-border geometry tests remain green.
- Regression contracts cover setting placement and both render paths.
- Full test, lint, audit check, build, and diff whitespace checks run before completion.
