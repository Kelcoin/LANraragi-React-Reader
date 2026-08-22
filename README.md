<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-white.png">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-black.png">
    <img src="public/logo-black.png" alt="Readoshi Logo" width="180">
  </picture>

  <h1 align="center">Readoshi</h1>

  <p>面向 LANraragi 的现代漫画浏览、阅读与档案管理客户端</p>

  [![Release](https://img.shields.io/github/v/release/Kelcoin/Readoshi?style=flat-square)](https://github.com/Kelcoin/Readoshi/releases)
  [![Docker](https://img.shields.io/badge/Docker-latest%20%7C%20beta-2496ed?style=flat-square&logo=docker&logoColor=white)](https://hub.docker.com/r/kelcoin/readoshi)
  [![React](https://img.shields.io/badge/React-18-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
  [![LANraragi](https://img.shields.io/badge/LANraragi-client-5d8f66?style=flat-square)](https://github.com/Difegue/LANraragi)

  [功能](#功能概览) · [快速开始](#快速开始) · [Docker](#docker-部署) · [Worker](#cloudflare-worker可选) · [开发](#本地开发)
</div>

Readoshi 是一个独立的 LANraragi Web 客户端，覆盖档案浏览、漫画阅读、元数据编辑、上传、重复档案检测和多设备同步。核心功能只需要可访问的 LANraragi 实例及 API Key；Cloudflare Worker、E-Hentai 集成和 WebGPU 超分均为可选能力。

> [!IMPORTANT]
> Readoshi 不包含 LANraragi 服务端。开始前请先准备可访问的 [LANraragi](https://github.com/Difegue/LANraragi) 实例。

## 功能概览

### 浏览与管理

- 搜索标题、标签、命名空间、中文翻译和拼音，支持组合筛选与筛选方案。
- 支持 LANraragi 静态和动态分类；分类内可继续筛选，Favorites 分类固定显示为“收藏夹”。
- 首页提供继续阅读、待看档案、随机漫游和全部档案；支持滚动加载或分页浏览。
- 基于标签与分类生成相似内容推荐。
- 上传 ZIP、CBZ、RAR、CBR、7Z、PDF，或通过 URL 调用 LANraragi 下载插件。
- 编辑标题、摘要和标签，使用标签建议、翻译及 LANraragi 元数据插件。
- 按封面相似度检测疑似重复档案，并保存检测结果或非重复标记。
- 档案菜单支持加入或移出 LANraragi 收藏夹、待看列表和阅读历史。

### 阅读器

- 单页、双页、Webtoon 和自动检测布局，支持从左到右或从右到左阅读。
- 键盘、滚轮、触控滑动、页码跳转、缩略图抽屉、图片预加载和自动翻页。
- 沉浸模式、缩放与回弹、自动裁剪白边、宽页拆分或旋转以及页间距设置。
- 翻页时保留已显示图片，目标页解码完成后原子替换，减少黑屏和闪烁。
- 无痕阅读不写入本次阅读进度；普通阅读可在多设备间继续。
- 当前页可设为档案封面，阅读进度超过 80% 后自动移出待看列表。

### 图片超分

超分使用本地模型和 WebGPU，在后台处理已下载页面；原图始终优先显示，完成后才替换为超分结果。当前提供：

| 模型 | 定位 | 运行时 |
|------|------|--------|
| Waifu2x UpConv7 | 最轻量，优先速度 | ONNX Runtime WebGPU，FP16 |
| Waifu2x | 通用动漫插画，兼顾去噪与线条 | ONNX Runtime WebGPU，FP32 默认、FP16 候补 |
| Real-CUGAN | 低质量、压缩噪点和模糊线条 | TensorFlow.js WebGPU，FP16 |

- 当前页优先，其次按阅读方向处理预加载页面，再处理未完成的已读页。
- 翻页或暂停不会丢弃已完成的 tile，恢复后从检查点继续。
- 结果写入图片缓存并复用；模型文件使用 SHA-256 校验。
- 页面进入阅读器时会真实加载 ONNX Runtime WebGPU 后端并创建微型探测会话；环境不可用时开关保持禁用。
- 单次推理输出超过 6400 万像素时跳过；显示结果必要时约束在 3200 万像素内。

> [!NOTE]
> 超分需要浏览器、显卡驱动和 WebView 同时支持 WebGPU。应用不会回退到明显更慢的 WebGL 或 WASM 推理。

### 可选增强

- **Cloudflare Worker**：同步阅读历史、待看列表和非重复标记，提供数据导入/导出。
- **E-Hentai**：显示、排序、回复、编辑和投票评论；删除档案时可同步移除收藏。
- **PWA**：支持安装、更新提示和打开已缓存页面。
- **移动端**：GitHub Actions 构建 Android APK 和未签名 iOS IPA；`main` 构建发布到 Releases。
- **个性化**：深色、浅色、跟随系统主题，以及独立的深浅自定义配色。

## 运行要求

| 能力 | 要求 |
|------|------|
| 基础浏览与阅读 | LANraragi 地址和 API Key |
| Docker 部署 | Docker 及可从容器访问的 LANraragi |
| 多设备同步 | Cloudflare Worker、KV 绑定和访问 Token |
| E-Hentai 集成 | Worker、Token、有效 Cookie 和档案来源链接 |
| 图片超分 | 可用的 WebGPU 环境 |

## 快速开始

1. 准备 LANraragi 地址和 API Key。
2. 使用 [Docker](#docker-部署) 部署 Readoshi，或从 [GitHub Releases](https://github.com/Kelcoin/Readoshi/releases) 获取移动端构建。
3. 首次打开 Readoshi，填写 LANraragi 地址和 API Key。
4. 按需配置 Worker、E-Hentai 和超分。

> [!WARNING]
> 配置导出可能包含服务器地址、API Key、Worker Token 和 E-Hentai Cookie。不要分享导出文件，也不要导入来源不明的配置。

## Docker 部署

### 镜像标签

| 分支 | 镜像 | 用途 |
|------|------|------|
| `main` | `kelcoin/readoshi:latest` | 稳定版本 |
| `dev` | `kelcoin/readoshi:beta` | 开发测试版本 |

### Docker CLI

```bash
docker run -d \
  --name readoshi \
  -p 8080:80 \
  -e LRR_SERVER=http://host.docker.internal:3000 \
  --restart unless-stopped \
  kelcoin/readoshi:latest
```

打开 `http://localhost:8080`。Linux 环境中请将 `host.docker.internal` 换成 LANraragi 可达地址，或使用 `--add-host=host.docker.internal:host-gateway`。

### Docker Compose

LANraragi 与 Readoshi 位于同一 Compose 项目时，可直接使用服务名通信：

```yaml
services:
  lanraragi:
    image: difegue/lanraragi:latest
    ports:
      - "3000:3000"
    restart: unless-stopped

  readoshi:
    image: kelcoin/readoshi:latest
    ports:
      - "8080:80"
    environment:
      LRR_SERVER: http://lanraragi:3000
    depends_on:
      - lanraragi
    restart: unless-stopped
```

### 容器环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NGINX_PORT` | `80` | 容器内 Nginx 监听端口 |
| `LRR_SERVER` | 自动组合 | LANraragi 完整地址；设置后覆盖下面三个变量 |
| `LRR_SERVER_PROTO` | `http` | LANraragi 协议 |
| `LRR_SERVER_HOST` | `host.docker.internal` | LANraragi 主机或 Compose 服务名 |
| `LRR_SERVER_PORT` | `3000` | LANraragi 端口 |

## Cloudflare Worker（可选）

根目录的 `worker.js` 可部署为 Cloudflare Worker，负责多设备同步、E-Hentai 代理和同步数据管理。

1. 创建 KV 命名空间，并绑定为 `HISTORY_KV`。
2. 在 KV 中创建键 `tokens`，值为允许访问的 Token JSON 数组：

   ```json
   ["your-sync-token"]
   ```

3. 部署 `worker.js`。
4. 在 Readoshi 设置中填写 Worker 地址和相同 Token。

使用相同 Token 的设备共享同步数据；LANraragi 地址与 API Key 会参与作用域计算，不同服务器的数据不会混合。未配置 Worker 时，浏览、阅读、上传和元数据编辑仍可使用。

直接打开 Worker 根地址可查看状态并导入或导出阅读历史、待看列表和非重复标记。

### Worker KV 可选配置

除 `tokens` 外，Worker 还会读取以下可选 KV 键（均有 60 秒内存缓存，改动后最多一分钟生效）：

| KV 键 | 取值范围 | 默认值 | 说明 |
|-------|----------|--------|------|
| `history_retention_days` | 正整数 | `90` | 阅读历史在 Worker 中的保留天数，超期条目会被清理 |
| `max_watchlist` | `100` – `10000` | `1000` | 待看档案在 Worker 中的最大同步条数；达到上限后再添加会返回 `WATCHLIST_LIMIT_REACHED`（HTTP 409），前端以 toast 提示需先移除。键不存在或值不合法时使用默认值。重加已有条目不算新增，不受影响。 |

### E-Hentai

评论互动和同步移除收藏需要有效的 Worker 配置、E-Hentai Cookie，以及档案元数据中的 E-Hentai 来源链接。同步移除收藏至少需要 Cookie 包含 `ipb_member_id` 和 `ipb_pass_hash`。

## 常用操作

| 操作 | 入口或方式 |
|------|------------|
| 搜索标签 | 输入 `namespace:value`；多个标签使用逗号分隔 |
| 分类内筛选 | 先激活分类，再输入标题或标签；清空条件不会退出分类 |
| 翻页 | 滚轮、方向键、Page Up/Down、空格键或触控滑动 |
| 跳页 | 阅读器页码输入框输入页码并回车 |
| 打开缩略图 | 阅读器工具栏或页面右键 |
| 切换布局 | 阅读设置中的单页、双页、Webtoon 或自动检测 |
| 开启自动翻页/超分 | 阅读设置，或启用普通模式控制按钮后使用页边按钮 |
| 编辑元数据 | 档案菜单或阅读器入口 |
| 上传/重复检测 | 首页设置面板中的工具入口 |

## 本地开发

需要 Node.js 18+ 和 npm 9+。

```bash
npm install
npm run dev
```

开发服务器默认监听 `http://localhost:27789`。可将 `.env.example` 复制为 `.env.local` 并按需设置：

```env
VITE_LRR_PROXY_TARGET=http://localhost:3000
VITE_ALLOWED_HOSTS=reader.example.com,lanraragi.example.com
VITE_FORCE_IPV4=false
```

| 变量 | 说明 |
|------|------|
| `VITE_LRR_PROXY_TARGET` | 将开发环境 `/api` 代理到指定 LANraragi 来源 |
| `VITE_ALLOWED_HOSTS` | 通过反向代理访问 Vite 时允许的主机名，逗号分隔 |
| `VITE_FORCE_IPV4=true` | 出站 IPv6 不可达时强制使用 IPv4 |

### 项目脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm test` | 运行 Node 测试套件 |
| `npm run lint` | 运行 ESLint |
| `npm run check` | 运行项目审计检查 |
| `npm run build` | 生成 `dist/` 生产构建 |
| `npm run preview` | 本地预览生产构建 |

提交改动前建议运行：

```bash
npm test
npm run lint
npm run check
npm run build
```

## 数据与隐私

- 浏览器本地保存 LANraragi 与 Worker 凭据、E-Hentai Cookie、界面设置、阅读记录、筛选方案和缓存。
- 只有配置 Worker 后，阅读历史、待看 ID 和非重复标记才会写入 Worker KV。
- Worker 的存储作用域不包含明文 LANraragi 地址；不同服务器和 Token 的数据相互隔离。
- 上传的档案和 URL 不会写入 Worker KV。
- 清除浏览器站点数据会移除未同步的本地设置、记录和图片缓存。

## 常见问题

<details>
<summary>页面能打开，但无法连接 LANraragi</summary>

确认 LANraragi 地址可从浏览器或容器访问，API Key 正确，并检查反向代理是否将 `/api/` 转发到 LANraragi。Docker 环境中不要把仅容器内部可见的 `localhost` 当作宿主机地址。
</details>

<details>
<summary>超分开关为什么不可用？</summary>

Readoshi 会检查 WebAssembly、Worker、图像解码能力、WebGPU Adapter，并真实初始化 ONNX Runtime WebGPU 探测会话。任一步失败都会禁用超分；更新浏览器、Android System WebView 或显卡驱动后再试。
</details>

<details>
<summary>E-Hentai 评论为什么加载失败？</summary>

检查 Worker 地址、Token、Cookie 和档案来源链接。网络刷新失败但已有缓存评论时，Readoshi 会继续显示缓存内容；没有可用评论时才显示错误原因。
</details>

<details>
<summary>如何发布 fork 的 Docker 镜像？</summary>

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 添加 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，再触发 Docker 发布 workflow。
</details>
