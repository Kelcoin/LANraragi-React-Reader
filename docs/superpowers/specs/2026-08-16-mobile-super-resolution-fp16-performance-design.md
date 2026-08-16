# Mobile Super-resolution FP16 Performance Design

## Goal

Make Waifu2x complete an uncached 800x1130 page in under 4 seconds on the reference Android device without making foreground reading less responsive. Reuse the same precision work for Real-CUGAN only when it produces real compute savings and passes compatibility and image-quality checks.

The performance measurement starts when an initialized Worker receives the page processing request and ends when it produces the enhanced Blob. The source image may be cached, but the derived super-resolution entry must be evicted. On the USB reference device, with thermal status 0, five fresh runs must have a median below 4 seconds. Model download and first session compilation are reported separately.

## Evidence and Constraints

- The reference device exposes a 128 MiB `maxStorageBufferBindingSize`, supports `shader-f16`, and showed no thermal throttling.
- A 1058x1500 page currently takes about 8.05 seconds with 70 Waifu2x 224x224 runs. Waifu2x also causes a 4950 ms GPU frame P99 during Android swipes, while Real-CUGAN stays near 13 ms.
- Returning to 384x384 FP32 input exceeds the Adreno storage-binding limit. Increasing the square input to 240 leaves only about 1.44 MiB of headroom and does not reduce enough tiles.
- Rectangular tiles reduce repeated padding and run count, but reduce total convolution pixels by only about 15 percent. They cannot independently guarantee a twofold speedup.
- Mihon's useful precedents are FP16 storage/packing, serial tile execution, tile-boundary abort, and configurable tile gaps. Its native ncnn/Vulkan threading and conversion pipeline do not transfer directly to the browser.

## Considered Approaches

1. **FP16 CUNet plus measured adaptive tile profiles (selected first):** preserves the current Waifu2x network and should reduce memory bandwidth and binding pressure. It has the smallest quality change, but the speed target must be proven on-device.
2. **Waifu2x UpConv7 fast profile (conditional):** has the best chance of comfortably beating 4 seconds, but reconstructs difficult textures less strongly than CUNet. Add it as an explicit fast option only if FP16 CUNet misses the target.
3. **Native ncnn/Vulkan bridge (deferred):** offers the greatest Android control but creates a separate Capacitor runtime, ABI assets, lifecycle, and web fallback. Consider only if both WebGPU profiles fail.

Parallel Workers, parallel tiles, unsafe FP32 tile growth, and INT8 conversion are excluded. They respectively increase GPU contention, memory pressure, binding failures, or quality and operator-coverage risk.

## Design

### FP16 Waifu2x Asset

- Convert the pinned CUNet ONNX graph to FP16 while keeping a separately identified FP32 asset as the compatibility fallback.
- Give the FP16 graph its own checksum and model/cache identity. A precision change must never reuse a derived result from another graph.
- Select FP16 only after both `shader-f16` capability and a real session initialization succeed. Any shader, binding, output-validation, or device-loss error falls back once to the FP32-safe profile; repeated failures disable the current enhancement through the existing error path.
- Do not treat a smaller model file as proof of faster inference. The USB benchmark must show that the WebGPU execution itself uses a faster path.

### Tile Profiles

- Extend tiling to accept independent core width and height while keeping the existing scalar geometry as the default.
- Evaluate a small fixed set of FP16 square and portrait-oriented rectangular profiles. A profile is eligible only when its largest observed binding remains comfortably below the adapter limit, its output geometry is correct, and it improves whole-page time.
- Keep FP32 224x224 input with a 152x152 core as the universal fallback.
- Do not infer safety from total tensor size alone. ORT operator-specific buffers and the Android segmented-buffer path must be exercised on the real device before a profile ships.
- Tile geometry does not change semantic output identity; precision and model graph do.

### Foreground Scheduling

- Replace interaction-triggered whole-page restart with Worker-side pause/resume at tile boundaries. Completed tile output remains in the active request.
- Pause for touch, pointer movement, wheel/scroll, zoom, and keyboard page navigation. Resume from the next tile after about 650 ms of quiet time.
- Page changes, model changes, disabling enhancement, errors, and leaving the applicable Reader context still perform a true cancellation and release partial output.
- Add a short Waifu2x tile gap, initially 8 ms, to let Android compositing submit work. A faster profile is accepted only if it also improves interaction measurements; larger tiles may not trade responsiveness for throughput.

### Conditional UpConv7 Profile

- If FP16 CUNet fails the 4-second gate, integrate a pinned and licensed UpConv7 ONNX asset as a separately named `Waifu2x Fast` option.
- Do not silently choose a different network under the existing Waifu2x label. Cache identity, model description, and benchmark results remain separate.
- UpConv7 must pass the same geometry, seam, cancellation, compatibility, and interaction tests. Representative line art, gradients, text, screentones, and compressed pages receive side-by-side visual review.

### Real-CUGAN FP16

- Start only after the Waifu2x path and scheduling changes are stable.
- Determine whether TensorFlow.js WebGPU keeps FP16 weights and activations on the GPU. Weight-only float16 quantization that expands back to FP32 at runtime is an asset-size optimization, not an inference optimization, and is insufficient.
- Keep the existing FP32 model as fallback. Adopt FP16 only if the same device shows a material median speed improvement, no new WebGPU errors, no worse interaction frame times, and no visible color or reconstruction regression.
- Give the FP16 graph and weights distinct checksums and cache identity.

## Verification

### Automated

- RED tests first for FP16 capability selection and FP32 fallback, independent tile axes, cache identity, pause/resume without tile recomputation, and true cancellation on page/context changes.
- Existing output geometry, crop, seam, stale-result, queue priority, error handling, and object URL lifecycle tests remain green.
- Full test, lint, check, production build, and `git diff --check` gates run before completion.

### USB Device

- Five uncached 800x1130 Waifu2x runs with a warm session: median below 4 seconds; report all samples and first-session compilation separately.
- Re-run the 1058x1500 comparison to expose scaling behavior rather than optimizing only one size.
- During three scripted swipes, collect Android Activity and GPU frame percentiles. The accepted profile must remove the multi-second compositor queue and keep interaction visibly responsive.
- Verify pause/resume continues from the next tile, sustained interaction does not commit stale output, and page changes release partial work.
- Confirm no storage-binding, shader compilation, pipeline-cache, device-loss, seam, or corrupt-output failures.
- Compare FP16 CUNet with FP32 CUNet on representative pages. Numerical differences may be small, but visible lines, screentones, gradients, colors, and text must remain equivalent at normal reading zoom.

## Delivery Gates

1. Ship FP16 CUNet only if it meets performance, stability, interaction, and image-quality gates.
2. If it misses only the 4-second performance gate, keep it experimental and evaluate the explicit UpConv7 fast option.
3. Quantize Real-CUGAN only after Waifu2x delivery is stable and only if true GPU inference improves.
4. Do not claim the task complete based on synthetic tensor timing, model size, or a single successful page.
