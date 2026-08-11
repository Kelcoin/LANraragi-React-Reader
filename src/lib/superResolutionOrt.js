const ortWasmModuleUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href;
const ortWasmBinaryUrl = new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href;

export async function loadOrtBackend(backend) {
  if (backend === 'webgl') return import('onnxruntime-web/webgl');

  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = {
    mjs: ortWasmModuleUrl,
    wasm: ortWasmBinaryUrl,
  };
  return ort;
}
