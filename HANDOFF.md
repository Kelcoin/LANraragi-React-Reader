# Readoshi 超分与推荐栏修复交接（2026-08-16）

仓库：`E:\Document\OneDrive\文档\GitHub\Lanraragi-React-Reader`

分支：`dev`

报告基于已推送到 `origin/dev` 的修复，并已补充调试代码清理状态。

## 当前状态

| 项目 | 状态 |
|---|---|
| Android Waifu2x 无法启用 | **已修复并通过 USB 真机验证**，commit `072a33a` |
| Android Real-CUGAN 被 fallback adapter 回归阻断 | 已在 `d414ec3` 撤销错误配置，恢复原生 adapter |
| 推荐栏“同作者”右侧空白 | 根因与代码修复已完成，commit `d414ec3`；仍建议用新版 APK 对含多个宽幅卡的档案复核 |
| iOS Waifu2x 长时间阅读后页面刷新 | 已修复，commit `bc9b689` |
| 首次双击放大无动画、双指复位抽搐 | 已修复，commit `5311f5b` |
| 评论区操作按钮偏心/字重观感不一 | 已统一按钮字体、行高与文本居中，并移除隐藏图标残留间距；本次变更 |
| 超分错误或退出沉浸后仍保持开启 | 已统一关闭当前档案超分并取消可见任务；本次变更 |
| 超大页面误启用超分 | 已复用 6400 万输出像素上限弹出二级确认，超大页保持原图；本次变更 |
| 首页待看档案增删反馈 | 新增卡片使用 280ms 入场动画；成功移出后使用 220ms 退场动画，减少动态效果时禁用；本次变更 |

## Android Waifu2x 根因链

### 第一阶段：WGSL i32/u32 类型不匹配

Android WebView 150 首次运行 Waifu2x 时，ORT `Conv2dMM` shader 编译失败：

```text
type mismatch for argument 1 in call to 'get_x_by_offset', expected 'u32', got 'i32'
```

ORT 1.27 在大 buffer 分段路径生成 `fn get_*_by_offset(global_offset: u32)`，但部分 Conv2dMM 调用点传入 i32 表达式。桌面 Chromium 151 可运行，Android WebView 150 的 Tint 严格拒绝。

`d414ec3` 在 `src/lib/superResolutionOrt.js` 的 `GPUDevice.createShaderModule` 包装层修补这些分段 accessor 调用。该修复消除了 shader 类型错误，但真机继续暴露了第二个 ORT 问题。定位完成后，临时 shader 编译诊断与 error-scope 探针已清理，兼容性修补保留。

### 第二阶段：分段 pipeline cache collision

修补 WGSL 后的新错误为：

```text
binding index 4 not present
```

真机 WebGPU adapter 实测：

```text
maxStorageBufferBindingSize = 134217728
```

即 `128 MiB`。Waifu2x CUNet 原 `384x384` tile 的最大满分辨率 Conv2dMM 展开 buffer 超过该限制，ORT 将物理 buffer 分段。ORT 1.27 的 pipeline cache key 未覆盖物理分段差异，后续复用旧 pipeline 时，包含 binding `[0,1,2,3,4]` 的 bind group 被用于只声明 `[0,1]` 的 layout，触发错误。

Waifu2x ONNX 输入尺寸是动态的，因此无需修改模型或 ORT。最小且稳定的修复是限制 tile，使最大 Conv2dMM buffer 保持在设备 binding limit 内，不进入分段路径。

## 最终修复（`072a33a`）

`src/lib/superResolution.js` 中 Waifu2x 几何参数由：

```text
input: 384x384
tileCore: 312
output: 696x696
```

改为：

```text
input: 224x224
tileCore: 152
padding: 36
outputInset: 18
output: 376x376
```

模型最大满分辨率通道数为 64，最大 Conv2dMM 展开 buffer：

```text
224 * 224 * 64 * 3 * 3 * 4 = 115,605,504 bytes
```

低于设备的 `134,217,728 bytes` 限制，不再触发 ORT 分段/cache collision。代价是 tile 数增加，但不改变输出倍率或最终图像几何。

回归测试覆盖：

- production manifest 固定为 `224x224` / `tileCore=152`
- 最大展开 buffer 必须小于 `128 MiB`
- worker 接受 `[1,3,224,224]` 输入与 `[1,3,376,376]` 输出
- 旧 `384x384` 断言在修改前按预期失败，修改后通过

## USB 真机验证

设备：

- ADB serial：`HA23M9ZS`
- 型号：小米 `24091RPADC` / `turner`
- Android 16
- Android System WebView `150.0.7871.181`
- GPU：Adreno 7xx

验证构建：

- 产品 commit：`072a33a8dec89850f3ab1ee69e14e2fe7e2b99c8`
- 旁装包：`com.kelcoin.readoshi.debug` / `Readoshi Debug`
- 正式包 `com.kelcoin.readoshi` 未覆盖、未卸载、未清数据

由于设备屏幕保持锁定，UI 验证通过 WebView CDP 完成。CDP 的 WebSocket 客户端必须省略 `Origin`；发送 `Origin: http://localhost` 会被 WebView 150 以 HTTP 403 拒绝。

验证结果：

1. 旁装版读取到原配置，`srEnabled=true`、`srModel=waifu2x`、`srAuto=false`。
2. 导航至同一档案，阅读器加载完成，`navigator.gpu` 可用。
3. 进入沉浸模式，按钮显示“为当前档案启用超分”。
4. 点击后 1 秒内，当前主图由 `800x1130` blob 变为 `1600x2260` blob。
5. 按钮状态切换为“关闭当前档案超分”，说明档案级超分保持启用。
6. 页面未显示超分初始化/运行失败；捕获错误数为 0。
7. logcat 正则筛选未发现 `binding index 4`、`not present`、`Uncaught` 或超分错误。

这证明 Waifu2x 在目标 Android/WebView/Adreno 组合上完成了一整页 2x 推理与显示。

## 推荐栏右侧空白

### 根因

“同作者”推荐容器使用 `width: max-content`，其中宽幅档案卡继承全局规则：

```css
width: min(var(--archive-wide-card-width), 100%);
max-width: 100%;
```

子项百分比宽度参与父级固有宽度计算，形成循环依赖。浏览器为每张宽幅卡高估 scrollWidth，因此右侧空白随宽幅卡数量累积。普通卡和“猜你喜欢”不触发该问题。

### 修复（`d414ec3`）

推荐栏内宽幅卡使用确定值 `--archive-wide-card-width` 作为 `flex-basis` 与 `width`，并设 `max-width: none`，不再使用百分比 `min()`。回归合同禁止该局部规则重新引入百分比宽度。

用于定位尾随空白的临时滚动监听、定时器与控制台探针已清理。新版 APK 最终复核标准：含多个宽幅卡的“同作者”栏滑到最右，仅剩正常约 `14-20px` padding。

## 已排除或不要恢复的方案

- 不要恢复 `c6bf3c7` 的 `ort.env.webgpu.forceFallbackAdapter = true`。该设备没有可用 fallback adapter，会报 `Failed to get GPU adapter`，同时阻断模型切换。
- 不要降级 ORT 1.26/1.25：相关 Conv2dMM/shader 生成路径没有解决这些问题。
- 不要使用 WebGL EP 回退：该模型在当前 ORT WebGL 加载路径失败。
- 不要删除 `superResolutionOrt.js` 的 i32/u32 WGSL 修补。224px tile 避开当前 Adreno 的分段路径，但修补仍保护其他设备/限制组合。
- 不要把生产 localStorage/API key 写入共享 `/sdcard` 或 world-writable 临时目录。此次旁装配置转移使用设备 `127.0.0.1` loopback 的 `run-as + tar + nc` 内存流，不落盘、不输出值。

## 验证与 Git

### 2026-08-16 当前待提交改动

- 全局 `.btn` 显式继承完整字体并统一 `line-height`、文本居中；评论区隐藏图标不再留下 `gap`。
- 非取消类超分处理错误关闭当前档案超分；退出沉浸模式同样关闭并取消任务，不修改全局超分开关。
- 当前页超分输出将超过 `SUPER_RESOLUTION_MAX_INFERENCE_PIXELS` 时先显示 `ConfirmDialog`；确认后仅尺寸合适的页面参与超分。
- 首页通过前后待看列表 ID 差异识别真正新增项，只为新增卡片播放一次 280ms 淡入/上浮动画。
- 首页同样识别成功移出的 ID，旧卡片保留 220ms 完成淡出/下沉后再提交新列表；删除失败不触发动画。
- 首页继续阅读复用同一组 280ms 入场与 220ms 退场动画；手动移出、阅读完成及开启“隐藏已读”均在成功更新后退场，首次历史水合不播放动画，减少动态效果时立即更新。
- 最新验证：`npm test` 502/502，`npm run lint`、`npm run check`、`npm run build`、`git diff --check` 全部通过。

本次调试探针清理已通过：

- `npm test`：483/483
- `npm run lint`
- `npm run check`
- `npm run build`
- `git diff --check`

GitHub Actions 未从本机会话触发：`gh` Actions API 返回 HTTP 401，但 `git push origin dev` 正常。

本次同时清理 `Recommendations.jsx` 的尾随空白诊断监听，以及 `superResolutionOrt.js` 的 shader 编译诊断；两处均有回归合同防止重新引入。临时 Android worktree 与旁装调试产物不属于产品提交。

## 后续建议

1. 用正式 CI 生成包含 `072a33a` 的 APK，覆盖安装正式包后再手动确认 Waifu2x 开关体验。
2. 用含多个宽幅卡的档案复核“同作者”推荐栏 trailing；若仍异常，记录档案 ID、卡片数量与屏幕截图后重新诊断。
3. ORT 上游若修复 segmented pipeline cache key，可评估恢复更大 tile；恢复前必须在 `128 MiB` Adreno 设备回归。
