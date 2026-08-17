const ortWebGpuModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;
const ortWebGpuBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;

let webGpuShaderCompatibilityInstalled = false;
let webGpuProbePromise = null;

// A 1x1 float Identity graph. Creating this session forces ORT to load its
// WebAssembly bootstrap and register the WebGPU execution provider.
const WEBGPU_PROBE_MODEL = new Uint8Array([
  0x08, 0x08, 0x42, 0x02, 0x10, 0x0d, 0x3a, 0x3b,
  0x0a, 0x10, 0x0a, 0x01, 0x58, 0x12, 0x01, 0x59,
  0x22, 0x08, 0x49, 0x64, 0x65, 0x6e, 0x74, 0x69,
  0x74, 0x79, 0x12, 0x05, 0x70, 0x72, 0x6f, 0x62,
  0x65, 0x5a, 0x0f, 0x0a, 0x01, 0x58, 0x12, 0x0a,
  0x0a, 0x08, 0x08, 0x01, 0x12, 0x04, 0x0a, 0x02,
  0x08, 0x01, 0x62, 0x0f, 0x0a, 0x01, 0x59, 0x12,
  0x0a, 0x0a, 0x08, 0x08, 0x01, 0x12, 0x04, 0x0a,
  0x02, 0x08, 0x01,
]);

export function patchOrtSegmentedOffsetTypes(source) {
  if (typeof source !== 'string' || !source.includes('_by_offset')) return source;
  const accessors = new Set(Array.from(
    source.matchAll(/\bfn\s+(get_[A-Za-z0-9_]+_by_offset)\s*\(\s*global_offset\s*:\s*u32\b/g),
    (match) => match[1],
  ));
  let patched = source;

  for (const accessor of accessors) {
    const opening = `${accessor}(`;
    let cursor = 0;
    let output = '';
    while (cursor < patched.length) {
      const callStart = patched.indexOf(opening, cursor);
      if (callStart < 0) break;
      const argumentStart = callStart + opening.length;
      let depth = 1;
      let argumentEnd = argumentStart;
      while (argumentEnd < patched.length && depth > 0) {
        const character = patched[argumentEnd];
        if (character === '(') depth += 1;
        else if (character === ')') depth -= 1;
        argumentEnd += 1;
      }
      if (depth !== 0) break;

      const argument = patched.slice(argumentStart, argumentEnd - 1);
      const isDeclaration = /^\s*global_offset\s*:\s*u32\s*$/.test(argument);
      const isAlreadyUint = /^\s*u32\s*\(/.test(argument);
      output += patched.slice(cursor, argumentStart);
      output += isDeclaration || isAlreadyUint ? argument : `u32(${argument})`;
      cursor = argumentEnd - 1;
    }
    if (output) patched = output + patched.slice(cursor);
  }

  return patched;
}

// ORT 1.27 的分段 buffer accessor 接收 u32，但 Conv2dMM 会传入 i32；先修补
// 生成的 WGSL，再创建 shader。
function installWebGpuShaderCompatibility() {
  if (webGpuShaderCompatibilityInstalled) return;
  const devicePrototype = globalThis.GPUDevice?.prototype;
  if (typeof devicePrototype?.createShaderModule !== 'function') return;
  webGpuShaderCompatibilityInstalled = true;
  const originalCreateShaderModule = devicePrototype.createShaderModule;
  devicePrototype.createShaderModule = function createShaderModuleWithCompatibility(descriptor) {
    const patchedDescriptor = typeof descriptor?.code === 'string'
      ? { ...descriptor, code: patchOrtSegmentedOffsetTypes(descriptor.code) }
      : descriptor;
    return originalCreateShaderModule.call(this, patchedDescriptor);
  };
}

export async function loadOrtBackend(backend) {
  if (backend !== 'webgpu') throw new Error(`Unsupported ONNX Runtime backend: ${backend}`);
  installWebGpuShaderCompatibility();
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.wasmPaths = {
    mjs: ortWebGpuModuleUrl,
    wasm: ortWebGpuBinaryUrl,
  };
  ort.env.webgpu.powerPreference = 'high-performance';
  return ort;
}

export function probeOrtWebGpuBackend({ loadBackend = loadOrtBackend } = {}) {
  const probe = async () => {
    const ort = await loadBackend('webgpu');
    const session = await ort.InferenceSession.create(WEBGPU_PROBE_MODEL, {
      executionProviders: [{ name: 'webgpu', powerPreference: 'high-performance' }],
      graphOptimizationLevel: 'disabled',
    });
    if (!session) throw new Error('ONNX Runtime returned no WebGPU probe session');
    if (typeof session.release === 'function') await session.release();
  };

  if (loadBackend !== loadOrtBackend) return probe();
  if (!webGpuProbePromise) webGpuProbePromise = probe();
  return webGpuProbePromise;
}
