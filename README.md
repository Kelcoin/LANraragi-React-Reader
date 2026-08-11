<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-white.png">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-black.png">
    <img src="public/logo-black.png" alt="Readoshi Logo" width="180">
  </picture>
</p>

<h1 align="center">Readoshi</h1>

Readoshi 是一个面向 [LANraragi](https://github.com/Difegue/LANraragi) 的现代漫画阅读器，支持浏览、阅读、管理和多设备同步。使用前需要可访问的 LANraragi 实例及其 API Key；Cloudflare Worker 和 E-Hentai 功能均为可选增强。

## 功能

### 浏览与发现

- 搜索标题或标签，支持多标签组合、命名空间、中文翻译和拼音检索。
- 支持 LANraragi 静态和动态分类；激活分类后可继续叠加标签筛选并保存常用筛选方案。
- 支持滚动加载或分页浏览、随机漫游和基于标签与分类的相似内容推荐。
- 首页集中展示继续阅读、待看档案、随机内容和全部档案。

### 阅读

- 单页、双页、Webtoon 和自动检测布局。
- 支持键盘、滚轮和触控翻页，以及页码跳转、缩略图抽屉、图片预加载和自动翻页。
- 沉浸模式、裁白边、宽页拆分或旋转、缩放模式、阅读方向和页码指示器均可调整。
- 支持从档案菜单进入无痕阅读；无痕阅读不会保存本次阅读进度。
- 沉浸模式下点击屏幕底部边缘可唤出侧边控制按钮，2.5 秒无操作自动隐藏。
- 支持基于 WebGL/WASM 的图片超分：Waifu2x 适合通用动漫插画，Real-CUGAN 更适合压缩、模糊或低质量原图。
- 超分会先显示已解码的原图，处理完成后再替换；结果会缓存并复用，模型文件会校验完整性后缓存。
- 可将当前页设为档案封面；配置 Worker 后可在其他设备继续上次阅读位置。

### 档案管理

- 阅读历史与待看列表支持搜索、筛选、批量选择和删除。
- 档案右键菜单可加入或移出 LANraragi 收藏夹与待看列表。
- 上传 ZIP、CBZ、RAR、CBR、7Z、PDF，或通过 URL 调用 LANraragi 下载插件。
- 编辑标题、摘要和标签，支持标签建议、翻译和 LANraragi 元数据插件。
- 按封面相似度检测疑似重复档案，可保存检测结果并标记非重复组合。

### 可选增强

- Cloudflare Worker：同步阅读历史、待看列表和非重复标记，并提供 KV 导入/导出。
- E-Hentai：读取、排序、回复、编辑和投票评论；删除档案时可同步移除收藏。
- PWA：支持安装、离线打开已缓存页面和更新提示。
- Android：`main` 分支版本通过 GitHub Releases 发布 APK，`dev` 分支构建产物可从 Actions 下载。
- 深色、浅色和跟随系统主题；可自定义强调色、次要色与背景色，自定义背景保留所选色相并自动约束亮度保证可读性。
- 支持图片缓存上限与自动清理。
- 页面操作结果、错误和后台同步状态统一通过 Toast 通知显示。
- 配置可导入或导出，便于设备迁移；导出时按服务器地址与 API Key、Worker 端点与访问 Token、E-Hentai Cookie 与评论、阅读器与档案、已读状态与筛选条件、主题与自定义配色、图片缓存上限类别选择。

## 快速开始

1. 准备可访问的 LANraragi 地址和 API Key。
2. 部署 Readoshi，或安装 GitHub Releases 提供的 Android APK。
3. 首次打开时填写 LANraragi 地址和 LANraragi API Key。
4. 如需多设备同步或 E-Hentai 增强，再配置 Cloudflare Worker。

> [!WARNING]
> 导出的配置包含服务器地址、API Key、Worker Token 和 E-Hentai Cookie。请勿分享配置或导入陌生来源的配置。

## Docker 部署

### 镜像标签

| 分支 | Docker 标签 | 说明 |
|------|-------------|------|
| `main` | `latest` | 稳定版本 |
| `dev` | `beta` | 开发测试版本 |

启动稳定版本：

```bash
docker run -d \
  --name readoshi \
  -p 8080:80 \
  -e LRR_SERVER_HOST=host.docker.internal \
  -e LRR_SERVER_PORT=3000 \
  kelcoin/readoshi:latest
```

打开 `http://localhost:8080`。如需测试版，将镜像标签改为 `kelcoin/readoshi:beta`。

### Docker Compose

```yaml
services:
  reader:
    image: kelcoin/readoshi:latest
    container_name: readoshi
    ports:
      - "8080:80"
    environment:
      LRR_SERVER_HOST: host.docker.internal
      LRR_SERVER_PORT: 3000
      NGINX_PORT: 80
    restart: unless-stopped
```

如果 LANraragi 位于同一 Compose 项目，将 `LRR_SERVER_HOST` 改为 LANraragi 服务名：

```yaml
services:
  lanraragi:
    image: difegue/lanraragi:latest
    container_name: lanraragi
    ports:
      - "3000:3000"
    restart: unless-stopped

  reader:
    image: kelcoin/readoshi:latest
    container_name: readoshi
    ports:
      - "8080:80"
    environment:
      LRR_SERVER_HOST: lanraragi
      LRR_SERVER_PORT: 3000
      NGINX_PORT: 80
    depends_on:
      - lanraragi
    restart: unless-stopped
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NGINX_PORT` | `80` | 容器内 Nginx 监听端口 |
| `LRR_SERVER` | 自动生成 | LANraragi 完整地址；设置后覆盖下面三个拆分变量 |
| `LRR_SERVER_PROTO` | `http` | LANraragi 协议 |
| `LRR_SERVER_HOST` | `host.docker.internal` | LANraragi 主机名或 Compose 服务名 |
| `LRR_SERVER_PORT` | `3000` | LANraragi 端口 |

如果 fork 后需要发布自己的镜像，在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，再手动运行 `Publish Docker image` workflow。

## 本地开发

需要 Node.js 18+ 和 npm 9+。

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://localhost:27789`。复制 `.env.example` 为 `.env.local` 后，可配置：

```env
VITE_ALLOWED_HOSTS=reader.example.com,lanraragi.example.com
VITE_FORCE_IPV4=false
```

- `VITE_ALLOWED_HOSTS`：允许访问开发服务器的主机名，适用于反向代理。
- `VITE_FORCE_IPV4=true`：IPv6 不可达时强制使用 IPv4。

生产构建：

```bash
npm run build
```

构建产物位于 `dist/`。

## Cloudflare Worker（可选）

项目根目录的 `worker.js` 可部署为 Cloudflare Worker，用于：

- 多设备同步阅读历史和待看列表。
- 同步重复档案检测中的非重复标记。
- 代理 E-Hentai 评论、投票和收藏夹删除请求。
- 在 Worker 状态页导入或导出同步数据。

部署要求：

1. 创建名为 `HISTORY_KV` 的 KV 绑定。
2. 在 KV 中创建 `tokens`，值为允许访问的 Token 列表：

```json
["your-sync-token"]
```

3. 在 Readoshi 登录页或设置面板填写 Worker 地址与相同 Token。

使用相同 Token 的设备会共享同步数据；不同 LANraragi 服务器的数据保持隔离。未配置 Worker 时，阅读、浏览、上传和元数据编辑仍可正常使用。

直接打开 Worker 根地址可查看运行状态，并按 Token 导入或导出阅读历史、待看列表和非重复标记。

### E-Hentai 功能

E-Hentai 评论互动和同步删除收藏需要：

- 可用的 Cloudflare Worker 地址与 Token。
- 合法的 E-Hentai Cookie。
- 档案元数据中存在对应的 E-Hentai 链接。

同步删除收藏至少需要 Cookie 中包含 `ipb_member_id` 和 `ipb_pass_hash`。条件不满足时，该开关保持禁用。

## 使用说明

### 搜索与筛选

- 输入标题、标签、中文翻译或拼音进行搜索。
- 使用 `namespace:value` 精确搜索，例如 `female:schoolgirl`。
- 多个标签使用逗号分隔。
- 激活分类后，输入条件会在该分类范围内继续筛选；清空条件仍保留当前分类。
- LANraragi 默认 Favorites 分类固定显示为“收藏夹”，并置于分类列表首位。
- 分类、标签和通用筛选条件可以组合；常用条件可保存为筛选方案。

### 阅读器

| 操作 | 方式 |
|------|------|
| 翻页 | 滚轮、Page Up/Down、方向键、空格键或触控滑动 |
| 打开缩略图抽屉 | 右键点击页面或使用工具栏按钮 |
| 跳页 | 在工具栏页码输入框输入页码并回车 |
| 切换布局 | 在阅读设置中选择单页、双页、Webtoon 或自动检测 |
| 沉浸模式 | 使用工具栏沉浸模式按钮；进入后点击屏幕底部边缘唤出控制，点击页面中部区域翻页 |
| 启用超分 | 在阅读设置的“超分”区域启用功能，选择 Waifu2x 或 Real-CUGAN；启用后可在沉浸模式中对当前档案开启超分 |
| 设为封面 | 使用工具栏“设为封面”并确认 |
| 查看历史/待看 | 使用阅读器抽屉或工具栏入口 |

阅读进度超过 80% 后，档案会自动从待看列表移除。

### 设置面板

首页右上角“设置”可调整：

- 主题、封面裁剪、档案浏览模式和进度条显示范围；主题支持自定义强调色、次要色与背景色（深浅模式可分别设置）。
- 阅读器布局、方向、缩放、裁白边、宽页处理、预加载、最大同时解码数量和自动翻页。
- 超分开关、模型和自动启用阈值；超分预处理页数与“预加载”数量一致，实际同时处理数量受“最大同时解码”限制。
- 阅读历史显示、图片缓存容量和清理方式。
- Cloudflare Worker、E-Hentai 评论与收藏同步。
- 配置导入/导出，以及上传和重复档案检测入口。导出配置按类别选择，不显示组内单项开关。

### 上传档案

从“设置”进入“上传档案”：

- 本地上传支持 ZIP、CBZ、RAR、CBR、7Z、PDF，可拖放或批量选择。
- URL 上传按一行一个 HTTP/HTTPS 地址解析；输入有效 URL 后会自动加入任务列表，可自动匹配或手动选择 LANraragi 下载插件。
- 任务列表中的 URL 和本地档案统一由“开始处理”启动；添加和清空列表均带有过渡动画。
- 每项任务独立显示等待、处理中、成功或失败，单项失败不会中断整批。
- 任务运行期间会阻止重复提交；离开或刷新页面前会显示提示。

### 阅读历史与待看

- 档案右键菜单可加入或移出待看列表。
- 历史页和待看页支持标题/标签搜索、筛选方案、批量选择和删除。
- 首页可刷新历史同步状态，并检查待看档案是否仍存在。
- 配置 Worker 后，可在多台设备间同步；同步失败时保留本地数据，恢复连接后自动回填。

### 元数据编辑

- 从档案右键菜单或阅读器进入元数据页面。
- 可修改标题、摘要和标签，并使用标签翻译、建议和元数据插件。
- 插件结果只会加入当前编辑内容，仍需点击“保存元数据”。
- 未保存时离开页面会提示；保存前发现服务器内容已变化时会要求刷新。
- 删除档案时，可按本次操作选择是否同步移除 E-Hentai 收藏。

### 重复档案检测

- 可按入库日期选择检测范围；无日期档案也会参与检测。
- 缺失封面的档案自动排除。
- 检测结果按疑似重复组合展示，可选择删除对象或将整组标记为非重复。
- 本地结果可保存、载入和删除；配置 Worker 后，非重复标记可跨设备同步。
- 智能选择优先保留带 `other:uncensored` 标签的档案，优先删除带 `other:extraneous ads` 标签的档案；条件相同时优先删除体积较小的档案。

### 图片缓存

设置面板显示缓存占用和容量上限。可自动计算安全上限、手动限制容量、智能清理较旧图片或清空全部图片缓存。

### 图片超分

超分功能在阅读设置的“超分”区域启用。当前提供两个模型：

- **Waifu2x**：动漫插画通用模型，兼顾去噪、线条和色块，画质与速度较均衡；使用 ONNX Runtime WASM。
- **Real-CUGAN**：更擅长压缩噪点、模糊线条和低质量原图，但模型更重、处理速度更慢、内存占用更高；优先使用 WebGL，失败时回退到 WASM。

启用超分后，模型、自动启用和阈值设置才可编辑。自动模式按归档每页平均体积与阈值判断是否启用当前档案，阈值默认是 500 KB；设为 0 时，所有尺寸允许的图片都会自动超分。沉浸模式中的超分按钮会在图片过大、不适合推理时隐藏。原图会先正常显示，超分完成后才替换，失败时保留原图。超分输出会在必要时降采样到不超过 3200 万像素，以降低后续解码压力；单次推理输出超过 6400 万像素时会跳过超分。

## 数据与隐私

- 浏览器本地保存 LANraragi 与 Worker 凭据、E-Hentai Cookie、界面设置、阅读历史、待看列表、筛选方案和本地去重结果。
- 仅在配置 Worker 后，最小化的阅读进度、待看 ID 和非重复标记才会上传至 Worker KV。
- Worker 的存储作用域不会使用明文 LANraragi 地址，不同服务器和 Token 的数据互相隔离。
- 上传的本地文件与 URL 不会写入 Worker KV。
- 清除浏览器站点数据会删除未同步的本地设置与记录。

## 许可

本项目采用 [MIT License](LICENSE) 许可。
