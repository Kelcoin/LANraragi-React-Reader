const ortWebGpuModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;
const ortWebGpuBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;

let webGpuShaderCompatibilityInstalled = false;

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
// 生成的 WGSL，再创建 shader。诊断仍优先使用 compilationInfo()，缺失时
// （部分 Android WebView）退回 validation error scope。
function installWebGpuShaderCompatibility() {
  if (webGpuShaderCompatibilityInstalled) return;
  const devicePrototype = globalThis.GPUDevice?.prototype;
  if (typeof devicePrototype?.createShaderModule !== 'function'
    || typeof devicePrototype.pushErrorScope !== 'function'
    || typeof devicePrototype.popErrorScope !== 'function') return;
  webGpuShaderCompatibilityInstalled = true;
  const originalCreateShaderModule = devicePrototype.createShaderModule;
  const hasCompilationInfo = typeof globalThis.GPUShaderModule?.prototype?.compilationInfo === 'function';
  devicePrototype.createShaderModule = function createShaderModuleWithDiagnostics(descriptor) {
    if (!hasCompilationInfo) this.pushErrorScope('validation');
    const patchedDescriptor = typeof descriptor?.code === 'string'
      ? { ...descriptor, code: patchOrtSegmentedOffsetTypes(descriptor.code) }
      : descriptor;
    const module = originalCreateShaderModule.call(this, patchedDescriptor);
    const report = (lines) => {
      if (lines.length > 0) {
        console.error(
          `[SR-WGSL] shader compile failed (${descriptor?.label ?? 'unlabeled'}):`,
          lines.join(' | '),
        );
      }
    };
    if (hasCompilationInfo) {
      Promise.resolve(module.compilationInfo()).then((info) => {
        report((info?.messages ?? [])
          .filter((message) => message?.type === 'error')
          .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`));
      }).catch(() => {});
    } else {
      const device = this;
      Promise.resolve()
        .then(() => {})
        .then(() => device.popErrorScope())
        .then((error) => {
          if (error) report([error.message ?? 'unknown validation error']);
        })
        .catch(() => {});
    }
    return module;
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
