const ortWebGpuModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;
const ortWebGpuBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;

let webGpuShaderDiagnosticsInstalled = false;

// ORT 在 error scope 里创建 pipeline，真实的 Tint/WGSL 编译诊断会被它吞掉，
// console 只剩 "Invalid ShaderModule ... due to a previous error"。这里包装
// createShaderModule：优先用 compilationInfo() 读诊断；该 API 缺失时
// （部分 Android WebView）退回在创建前后夹一层自己的 validation error scope。
// 两种方式都仅观测，不改行为。
function installWebGpuShaderDiagnostics() {
  if (webGpuShaderDiagnosticsInstalled) return;
  const devicePrototype = globalThis.GPUDevice?.prototype;
  if (typeof devicePrototype?.createShaderModule !== 'function'
    || typeof devicePrototype.pushErrorScope !== 'function'
    || typeof devicePrototype.popErrorScope !== 'function') return;
  webGpuShaderDiagnosticsInstalled = true;
  const originalCreateShaderModule = devicePrototype.createShaderModule;
  const hasCompilationInfo = typeof globalThis.GPUShaderModule?.prototype?.compilationInfo === 'function';
  devicePrototype.createShaderModule = function createShaderModuleWithDiagnostics(descriptor) {
    if (!hasCompilationInfo) this.pushErrorScope('validation');
    const module = originalCreateShaderModule.call(this, descriptor);
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
  installWebGpuShaderDiagnostics();
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.wasmPaths = {
    mjs: ortWebGpuModuleUrl,
    wasm: ortWebGpuBinaryUrl,
  };
  ort.env.webgpu.powerPreference = 'high-performance';
  return ort;
}
