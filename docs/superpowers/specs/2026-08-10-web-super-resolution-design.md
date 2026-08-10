# 浏览器端真实超分链路设计

## 目标

将阅读页现有的超分 UI 接入真实的浏览器端图像超分推理，同时保持阅读页当前的图片加载、解码、取消和缓存行为。首期只承诺一套许可证和运行元数据均已确认的 ONNX 模型；其余 UI 模型选项只有在存在合法且可验证的模型 manifest 时才启用。

## 运行时决策

- 运行库：`onnxruntime-web`，懒加载，避免首页首屏增加模型运行时代码。
- 执行后端：优先 WebGL；WebGL 初始化或算子执行失败时回退 WASM/CPU。
- 线程边界：WASM 推理放在 Worker；WebGL 先通过真实初始化检查，不能在 Worker 中可靠运行时由主线程执行。
- 模型分发：模型通过 manifest 配置 URL、SHA-256、许可证、scale、输入输出布局和张量名；首次使用下载并用 Cache API 缓存。未确认授权的权重不得写入仓库或作为默认 URL。
- 图像流程：Blob -> 解码为 RGBA -> RGB/Alpha 分离 -> replicate padding 分块 -> 模型推理 -> 去 padding 拼接 -> Alpha 最近邻放大 -> PNG/WebP Blob。
- 分块默认值：tile core 128，padding 18；模型 manifest 可覆盖 padding 和 scale。
- 失败策略：超分失败、取消、图片格式不适合或输出超过像素/内存门槛时保留原图，并向 Reader 返回可区分的失败/取消结果。

## 数据流

1. Reader 通过现有 `resolvePageImageSource` 获取原图 Object URL。
2. 当前页在现有 `readerImageDecodeQueue` 任务中读取 Blob，并向超分 runtime 请求结果。
3. runtime 按模型和后端复用已初始化的 session；每次请求有独立 request id 和 AbortSignal。
4. 结果 Blob 通过现有图片缓存 API 生成 Object URL并交给已有 `decodeImageSource`。
5. 页面切换或组件卸载时取消旧 request；旧 request 不能写入当前页面状态。
6. 预超分只复用相同接口，在当前页完成后按现有 preload 数量低优先级排队；首期不增加独立队列。

## 文件边界

- `src/lib/superResolution.js`：模型 manifest、能力筛选、runtime 公共 API。
- `src/lib/superResolutionTiling.js`：无 DOM 的分块计划、padding、输出裁剪和像素拼接辅助。
- `src/lib/superResolution.worker.js`：WASM runtime 的消息协议、session 生命周期和取消。
- `src/lib/superResolutionRuntime.js`：主线程 WebGL/WASM 选择、模型加载、缓存和请求封装。
- `src/pages/Reader.jsx`：仅接入当前页/预加载调用、状态和 stale request 回退。
- `tests/super-resolution.test.mjs`：manifest、分块、协议、取消和失败契约。

## 测试与验收

- 纯函数覆盖整图、小图、内部 tile、右/下边缘 tile、padding、2x/4x 输出尺寸和 Alpha。
- Worker 协议覆盖 init、process、cancel、dispose、未知 request 和错误传播。
- runtime 覆盖 WebGL 初始化失败后 WASM 回退、模型缓存命中、取消不污染后续请求。
- Reader 契约覆盖超分打开时当前页接入、关闭时原图路径不变、失败回退原图、切页取消旧结果。
- 无真实权重的 CI 只跑协议和纯函数测试；浏览器验收另行用已授权 manifest 验证真实 WebGL/WASM 推理。

## 明确不做

- 不在浏览器中实现 ncnn `.param/.bin` 解析器。
- 不同时维护手写 WebGL 神经网络和手写 WASM 神经网络。
- 不把 Mihon Android JNI/Vulkan 代码移植到前端。
- 不在首期修改 imageCache 的原图淘汰策略或引入第二套永久缓存。
