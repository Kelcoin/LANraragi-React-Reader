# Theme Hue Slider Drag

## Problem

The custom theme color picker's saturation/lightness surface supports a complete pointer drag lifecycle, but the hue slider only updates on `pointerdown`. Moving a pressed mouse, touch contact, or pen therefore does not continue updating hue.

## Design

Keep the existing custom slider markup, appearance, click behavior, and arrow-key controls. Add a hue-specific element ref and dragging ref so its state cannot interfere with the saturation/lightness surface.

On hue `pointerdown`, mark the slider as dragging, capture the active pointer, and update hue from the pointer's horizontal coordinate. While captured, `pointermove` continuously recalculates hue. `pointerup`, `pointercancel`, and `lostpointercapture` clear the drag flag.

Hue remains clamped to the existing `0..359` range. Pointer capture allows dragging beyond either edge while the value remains pinned to the nearest endpoint.

## Scope

- Modify `src/components/ThemeColorPicker.jsx` only for production behavior.
- Add focused regression coverage to the existing UI contract tests.
- Do not change color conversion, palette persistence, popover positioning, CSS geometry, or the saturation/lightness control.

## Verification

- A regression test must fail against the current `pointerdown`-only implementation and pass after the complete pointer lifecycle is added.
- Existing test, lint, and production build commands must remain green.
- In the real settings panel, dragging the hue thumb left and right must continuously change its position and color, including clamping after the pointer leaves the track bounds.
- Clicking and Left/Right arrow-key adjustment must continue working.
