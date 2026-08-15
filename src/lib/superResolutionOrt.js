const ortWebGpuModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;
const ortWebGpuBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;

let webGpuShaderDiagnosticsInstalled = false;

// ORT 在 error scope 里创建 pipeline，真实的 Tint/WGSL 编译诊断会被它吞掉，
// console 只剩 "Invalid ShaderModule ... due to a previous error"。这里包装
// createShaderModule 用 compilationInfo() 把编译错误打出来（仅观测，不改行为），
// 让 Android WebView 等环境可以通过 logcat / Capacitor Console 看到根因。
function installWebGpuShaderDiagnostics() {
  if (webGpuShaderDiagnosticsInstalled) return;
  const devicePrototype = globalThis.GPUDevice?.prototype;
  if (typeof devicePrototype?.createShaderModule !== 'function'
    || typeof globalThis.GPUShaderModule?.prototype?.compilationInfo !== 'function') return;
  webGpuShaderDiagnosticsInstalled = true;
  const originalCreateShaderModule = devicePrototype.createShaderModule;
  devicePrototype.createShaderModule = function createShaderModuleWithDiagnostics(descriptor) {
    const module = originalCreateShaderModule.call(this, descriptor);
    Promise.resolve(module.compilationInfo()).then((info) => {
      const errors = (info?.messages ?? []).filter((message) => message?.type === 'error');
      if (errors.length > 0) {
        console.error(
          `[SR-WGSL] shader compile failed (${descriptor?.label ?? 'unlabeled'}):`,
          JSON.stringify(errors),
        );
      }
    }).catch(() => {});
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
