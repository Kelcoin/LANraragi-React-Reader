# Readoshi「档案编辑室」全站 UI 系统设计规范

## 1. 文档状态

- 日期：2026-08-12
- 状态：设计已由用户分段批准，等待书面复核
- 适用版本：React 18 + Vite 5 的现有 Readoshi Web 应用
- 设计方向：A「档案编辑室」
- 组件策略：Base UI 行为 primitive + Readoshi 自有视觉系统

## 2. 目标

将 Readoshi 收敛为安静、精确、有收藏气质的私人漫画档案馆。界面应适合高频筛选、批量管理和长时间阅读；封面与漫画内容是最大的视觉信号，容器和装饰只负责建立层级。

本次设计覆盖登录、首页、历史、待看、上传、重复检测、元数据、阅读器、设置和全部共享组件，包括浅色、深色、桌面、平板、移动端、键盘、触屏、加载、空、错误、禁用和选择状态。

## 3. 不可突破的功能边界

本次只优化 UI 层：视觉、排版、布局、响应式、反馈呈现和共享控件的行为实现。以下功能与合同必须保持：

- LANraragi API、Cloudflare Worker、认证和配置协议。
- 路由、浏览器历史、页面恢复和返回行为。
- 档案搜索、筛选、分类、随机推荐和分页语义。
- 阅读进度、待看、历史、收藏、删除、上传、去重和元数据编辑语义。
- 图片缓存、预加载、对象 URL 生命周期、超分辨率和阅读渲染管线。
- PWA 安装、Service Worker 更新和强制刷新策略。
- 键盘快捷操作、焦点返回、Escape、外部点击、长按和右键菜单语义。

组件迁移必须行为等价。任何事件时序、数据流、持久化键、API 参数、缓存键或用户可见功能变化都视为回归，不属于本设计。

## 4. 研究结论与组件库选择

### 4.1 当前实现

项目没有第三方 UI 框架，页面和共享控件由 React、Portal 和单一 `src/index.css` 构成。已有 ARIA、焦点回收、Escape、Portal 和触屏逻辑较完整，但视觉值与布局散落在 5,000 多行 CSS 和大量 inline style 中。Select、DatePicker、Dialog、Menu、Popover、Tooltip、Tabs、Switch 等行为层由项目自行维护，成本高且容易产生细小差异。

### 4.2 候选

- 用户提供的 `20forms-20designs` 是 48 套 React 设计系统的比较 playground，不是单一生产组件库。适合观察方案，不适合作为依赖。
- MUI、Ant Design、Chakra、HeroUI 等 styled system 会带入强烈预设外观和较大迁移面，不符合现有产品特质。
- React Aria Components 提供强无障碍、国际化和复杂控件能力，适合 DatePicker、ComboBox、Grid 等定点需求，但全量迁移的概念与 API 成本更高。
- Base UI 是无样式 React primitive，支持 React 17+、Vite 和 plain CSS，覆盖本项目主要浮层与表单行为。它允许保留现有 DOM 层级与视觉控制。

### 4.3 决定

采用 Base UI 作为渐进式行为层来源，视觉样式全部保留在 Readoshi。优先迁移高维护风险组件：

1. Dialog / Alert Dialog。
2. Select / Menu / Context Menu。
3. Popover / Tooltip。
4. Tabs / Switch / Toast。

DatePicker 和 TagSuggest 只有在行为等价测试覆盖后才迁移。ArchiveCard、ArchiveGrid、Reader 图像舞台和页面结构不是组件库迁移对象。

不一次性引入或替换全部组件；只安装实际使用的 Base UI 包，并以生产构建分析确认依赖成本。

## 5. 设计原则

1. 内容主导：封面、标题、进度和当前操作优先于容器装饰。
2. 信息密集但不拥挤：通过对齐、行高、留白和分隔线组织，不用 card wall。
3. 语义颜色克制：朱砂只承担主操作与选择；苔藓绿承担完成与正向状态；警告和危险有独立颜色。
4. 深浅同源：深色是同一档案室的低光版本，不是冷蓝技术终端。
5. 交互可预期：同类控件的状态、尺寸、焦点和动效一致。
6. 渐进迁移：先建立 token 和 primitive，再处理共享组件和页面，避免改变数据流。
7. 无障碍是合同：触屏目标、键盘路径、焦点管理和 reduced motion 不因视觉优化退化。

## 6. Token 架构

采用三层 token。组件不得直接引用 primitive 色值；页面不得绕过 semantic token 定义新的主题颜色。

### 6.1 Primitive

#### 浅色

| Token | 值 |
| --- | --- |
| `--stone-0` | `#FFFFFF` |
| `--stone-25` | `#FCFAF5` |
| `--stone-50` | `#F7F4EE` |
| `--stone-100` | `#F2EFE8` |
| `--stone-150` | `#E8E3D9` |
| `--stone-200` | `#D8D1C5` |
| `--stone-300` | `#BDB4A6` |
| `--stone-500` | `#756F66` |
| `--stone-700` | `#46423D` |
| `--stone-900` | `#282724` |
| `--vermilion-100` | `#F1DDD7` |
| `--vermilion-500` | `#B84A38` |
| `--vermilion-650` | `#92372A` |
| `--moss-100` | `#E3E8D7` |
| `--moss-500` | `#66734A` |
| `--moss-650` | `#4F5B37` |

#### 深色

| Token | 值 |
| --- | --- |
| `--charcoal-950` | `#0D0E0C` |
| `--charcoal-900` | `#121310` |
| `--charcoal-850` | `#171815` |
| `--charcoal-800` | `#1B1C18` |
| `--charcoal-700` | `#292A25` |
| `--charcoal-600` | `#3C3D36` |
| `--charcoal-400` | `#858176` |
| `--charcoal-200` | `#C6C0B4` |
| `--charcoal-100` | `#EEEAE0` |
| `--vermilion-dark` | `#D16A57` |
| `--moss-dark` | `#8E9A69` |

### 6.2 Semantic

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--canvas` | `#F2EFE8` | `#121310` | 页面背景 |
| `--surface` | `#FCFAF5` | `#1B1C18` | 主表面 |
| `--surface-subtle` | `#F7F4EE` | `#171815` | 次级表面 |
| `--surface-inset` | `#E8E3D9` | `#0D0E0C` | 内嵌区和封面占位 |
| `--text-primary` | `#282724` | `#EEEAE0` | 标题、正文 |
| `--text-secondary` | `#756F66` | `#C6C0B4` | 元数据、说明 |
| `--text-muted` | `#948D82` | `#858176` | 非关键弱信息 |
| `--border-subtle` | `#D8D1C5` | `#292A25` | 普通分隔和边界 |
| `--border-strong` | `#BDB4A6` | `#3C3D36` | hover、浮层边界 |
| `--accent` | `#B84A38` | `#D16A57` | 主操作、选择、焦点 |
| `--accent-hover` | `#92372A` | `#E17A65` | 主操作 hover |
| `--accent-soft` | `#F1DDD7` | `#42231D` | 选中浅底 |
| `--positive` | `#66734A` | `#8E9A69` | 完成、成功 |
| `--positive-soft` | `#E3E8D7` | `#29301F` | 成功浅底 |
| `--warning` | `#95631F` | `#D4A75D` | 警告 |
| `--danger` | `#A93F35` | `#D96B62` | 删除、失败 |
| `--focus-ring` | `#B84A38` | `#D16A57` | focus-visible |
| `--overlay` | `rgba(28,25,21,.55)` | `rgba(0,0,0,.72)` | 模态遮罩 |
| `--reader-stage` | `#050505` | `#050505` | 阅读舞台 |

自定义主题继续支持主色、辅色和底色，但生成算法必须保持语义层关系、对比度和同源深浅材质。自定义色不得改变危险、警告和 reader stage 的功能含义。

### 6.3 Component

组件 token 只引用 semantic token，例如：

```css
--button-primary-bg: var(--accent);
--button-primary-fg: var(--accent-contrast);
--field-bg: var(--surface);
--field-border: var(--border-subtle);
--dialog-bg: var(--surface);
--archive-progress: var(--positive);
```

旧 token 在迁移期映射到新 token，最终移除 `glass-*` 等不再表达真实材质的命名。

## 7. 排版

字体保持本地依赖，不增加网络字体：

```css
font-family: 'Noto Sans SC Variable', 'PingFang SC',
  'Microsoft YaHei UI', system-ui, sans-serif;
```

日文内容优先 `Noto Sans JP Variable`。字间距统一为 `0`；只有 10–11px 的短英文眉题允许 `0.04em`，中文不增加字距。

| 层级 | 字号 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| 页面标题 | 26 / 1.25 | 750 | 页面主标题 |
| 区块标题 | 18 / 1.35 | 700 | 内容带、设置组 |
| 卡片标题 | 14 / 1.45 | 650 | 档案标题 |
| 正文 | 14 / 1.6 | 450–500 | 说明、评论 |
| 控件 | 13 / 1.35 | 600 | 按钮、选择器 |
| 元数据 | 11–12 / 1.45 | 500 | 页数、日期、计数 |
| 眉题 | 10 / 1.3 | 700 | 少量英文或数量标记 |

卡片标题最多两行；工具栏标签不得被强制压缩到不可读；最长单词使用 `overflow-wrap:anywhere` 或合理截断。

## 8. 尺寸与空间

### 8.1 间距

4px 基准：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`。页面桌面边距 20–24px，平板 16–20px，移动 10–14px。页面区块垂直距离 24–40px；工具栏内部 8–12px。

### 8.2 圆角

```css
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
```

- 普通控件：6px。
- 档案封面、浮层、对话框：8px。
- 标签：4px。
- 圆形仅用于图标按钮、色点或必须为圆形的控制点。
- 禁止把普通按钮、设置行、导航和页面 section 统一做成 pill。

### 8.3 边框与阴影

- 普通 section 无框或只使用分隔线。
- 输入、卡片、工具栏使用一层 subtle border。
- 普通面板和档案卡片无常驻阴影。
- Menu、Popover、Dialog 使用单层柔和阴影：`0 16px 40px rgba(36,31,25,.14)`；深色降低黑影不透明度并增加边界。
- 移除常驻 `backdrop-filter`、大面积透明玻璃和装饰渐变。模态遮罩允许轻量 blur，但必须有纯色回退。

## 9. 动效

- 快速反馈：160ms。
- Menu / Popover：200ms。
- Dialog / Drawer：240–260ms。
- 标准曲线：`cubic-bezier(.32,.72,0,1)`。
- 只动画 `transform` 和 `opacity`；颜色与边框可短时过渡，不动画布局几何。
- 档案卡片 hover 最多上移 2px；触屏不依赖 hover。
- 页面不做大规模滚动 reveal；加载内容通过骨架和局部淡入表达。
- `prefers-reduced-motion: reduce` 关闭移动、缩放、shimmer 和非必要淡入。

## 10. 页面布局

### 10.1 登录

- 单一连接工作区，不使用营销 hero。
- 品牌、主连接字段和高级 Worker 设置形成清晰三段。
- 高级设置默认折叠行为不变；导入、主题和版本入口保留原功能。
- 主提交按钮固定为唯一高强调动作；错误继续使用 Toast，不改变连接流程。

### 10.2 首页

- 顶栏轻量化，品牌、主导航和工具入口在同一对齐轴。
- 继续阅读、待看、随机推荐为无框架内容带；标题、计数、动作与横向封面列组成一组。
- 收起行为、横向滚动、随机刷新和恢复位置保持现状。
- 全部档案是主要工作区，搜索、分类、排序、显示模式和批量操作形成稳定工具栏。
- 减少 `.glass-panel` 外壳，让封面成为最大色彩来源。

### 10.3 历史与待看

共享“页面标题 + 数量摘要 + 页面动作 + 工具栏 + 档案网格”结构。两页的功能差异通过操作和语义标签表达，不建立独立颜色主题。选择模式使用朱砂边界、复选标记和明确批量工具栏。

### 10.4 上传

采用工作台：页面标题、来源输入、文件/URL 队列、上传设置、进度和结果。拖放区为内嵌纸面区域，拖入使用苔藓浅底；不使用大渐变或大图标。队列行使用分隔线，不为每行创建卡片。

### 10.5 重复检测

控制区、执行进度、结果组和操作区建立清晰顺序。重复组可以使用有边界的工作单元，但组内卡片不再嵌套额外 card。危险删除和保留操作在位置、颜色和文案上明确区分，算法和执行流程不变。

### 10.6 元数据

桌面使用主编辑区 + 辅助标签/预览区；窄屏单列。标题、标签、分类和保存操作按编辑顺序排列。标签 chip 使用统一 namespace 规则；复制、翻译和删除状态不改变。

### 10.7 设置

- 桌面：160–200px 分组导航 + 内容区；移动：顶部可滚动 tabs。
- 设置行采用 `label + description + control` 网格，不使用每行卡片。
- 组间用 24–32px 留白和标题分隔；同组行用细分隔线。
- 自定义主题、缓存、Worker、EH 和 Reader 设置保留现有字段、默认值和存储键。
- 说明 tooltip 只补充非关键内容；必要说明必须常驻可见。

### 10.8 阅读器

- 图片舞台固定 `#050505`，不受自定义背景影响。
- 非沉浸工具栏使用低光炭黑表面、清晰图标和 44px 命中区。
- 设置抽屉、档案抽屉、缩略图、评论和页码共享同一表面层级。
- 沉浸控件降低视觉占比，保持原触发、自动隐藏和超分状态语义。
- 不修改图片尺寸、加载、翻页、预加载、Webtoon、双页、沉浸或超分逻辑。

## 11. 共享组件

### 11.1 Button

变体：`primary / secondary / quiet / danger / icon`。

- 最小高度 38px；主要触屏操作 44px。
- Icon button 命中区 44×44px，图标 16–20px。
- 每类覆盖 hover、pressed、focus-visible、disabled、loading。
- Primary 每个控制组最多一个；普通“返回”不使用 primary。
- Loading 保留按钮尺寸并提供可访问状态。

### 11.2 Field

Input、Textarea、Search、Select、DatePicker 共用标签、说明、错误和禁用结构。

- 默认高度 40px；触屏输入高度 44px。
- iOS 输入字号至少 16px。
- focus-visible 使用 2px 朱砂环，offset 2px。
- 错误位于字段下方并与控件关联；不只改变边框颜色。
- 清除、密码显示、日期入口使用内置图标按钮且布局不跳动。

### 11.3 Overlay

Dialog、Drawer、Popover、Tooltip、Menu、Context Menu 共用层级系统：

1. 页面与 sticky toolbar。
2. Menu / Popover / Tooltip。
3. Drawer / Dialog overlay。
4. Toast。

打开、关闭、Escape、外部点击、焦点锁定和焦点返回必须与当前行为一致。浮层宽度使用 trigger/viewport 约束，390px 不越界。

### 11.4 Navigation

Tabs、Segmented Control、Toolbar、Pagination 使用同一选中语义：朱砂细线、文字加重或浅底，避免大面积彩色胶囊。图标模式与文字模式的命中区一致。

### 11.5 Archive Card

- 普通和紧凑模式共享封面、标题、元数据、进度和选择状态。
- 封面保持现有比例、裁切设置、缩略图加载和失败回退。
- 标题是第一信息；页数、日期和作者为第二信息。
- 阅读进度使用 2–3px 苔藓条和可访问 progressbar。
- 待看、完成、选择和失败不改变整卡背景；用角标、边界、进度和文字表达。
- 触屏面板、右键菜单、长按和标签浮层行为保持。

### 11.6 Tag

namespace、普通、可删除、选中四类建立一致高度、4px 圆角和文本层级。namespace 使用弱底或短前缀；普通标签不逐个上色；选中和删除状态同时使用图标/结构，不只靠颜色。

### 11.7 Feedback

- Toast：短暂操作结果和全局错误。
- Inline error：阻止当前表单或内容区继续的错误。
- Progress：持续任务及可量化过程。
- Skeleton：首次加载和路由切换，不用于后台刷新。
- Empty state：说明当前为空并给出一个明确动作。
- Retry state：保留失败原因和重试入口。

同一事件不得同时出现局部提示和 Toast。自动隐藏和持久错误策略保持现状。

## 12. 响应式

验证视口：1440、1024、768、390px。

- `>1200px`：完整信息密度，页面最大宽度沿用现有内容约束。
- `769–1200px`：减少页面边距，工具栏允许两行，保留封面密度。
- `481–768px`：设置转 tabs，工作台单列，弹层使用视口宽度约束。
- `<=480px`：10–14px 页面边距；按钮和字段 44px；批量操作允许换行；对话框距离视口至少 12px。

禁止 `100vw + padding`、固定宽度长工具栏和文本挤压造成横向滚动。所有固定格式控件使用明确 grid track、min-width:0、aspect-ratio 或 min/max 约束，动态内容不得造成布局跳动。

## 13. 无障碍

- 所有交互可通过键盘到达；focus-visible 清晰且不被 overflow 裁切。
- Dialog、Menu、Listbox、Tabs、Tooltip、Slider 遵循 WAI-ARIA pattern。
- 图标按钮有 `aria-label`；装饰图标 `aria-hidden=true`。
- 状态不只依赖颜色；错误、选择、完成均有文字、图标或结构差异。
- 触屏目标不小于 44×44px。
- 正文和控件达到 WCAG AA；小字号元数据不得使用低对比 muted 色承载唯一信息。
- 保持用户缩放能力；不新增阻止缩放的 viewport 设置。

## 14. CSS 与代码组织

目标结构：

```text
src/styles/
  tokens.css
  reset.css
  primitives.css
  components/
    buttons.css
    fields.css
    overlays.css
    navigation.css
    archive.css
    feedback.css
  pages/
    login.css
    home.css
    archive-list.css
    upload.css
    deduplicate.css
    metadata.css
    reader.css
  utilities.css
```

`src/index.css` 在迁移期作为入口，按固定顺序 import。使用 CSS cascade layers：`reset, tokens, base, primitives, components, pages, utilities`。禁止新增长距离后置覆盖来修复特异性。

inline style 只保留真实运行时几何，例如进度宽度、Portal 坐标、封面尺寸、动态 transform 和 CSS 自定义变量。静态颜色、padding、字号、背景、边框、圆角和布局迁入 class。

## 15. 迁移策略

1. 建立新 token、theme 映射、cascade layer 和主题契约测试。
2. 建立 Button、Field、Surface、Toolbar、Feedback 等自有 primitive class。
3. 引入 Base UI，迁移 Dialog、Select、Menu、Popover/Tooltip，并锁定行为等价。
4. 统一 ArchiveCard、ArchiveGrid、搜索工具栏和横向内容带。
5. 重构 Home、History、Watchlist 的页面层级。
6. 重构 Upload、Deduplicate、Metadata 和登录工作台。
7. 统一 Settings 和 Reader 外围，不触及 Reader 图像/状态管线。
8. 清理旧 glass 命名、静态 inline style、重复选择器和无引用样式。
9. 完成自动化、浅/深主题、桌面/移动、键盘/触屏和真实 LANraragi 验收。

每一步必须可独立回归和回滚，不允许跨页面大爆炸式替换。

## 16. 测试与验收

### 16.1 自动化

- 现有 `npm test`、`npm run lint`、`npm run check`、`npm run build` 全部保持通过。
- 新增 token 值、语义映射、主题生成和旧 token 兼容契约。
- 新增 Base UI 迁移组件的 Escape、外部点击、焦点锁、焦点返回、键盘导航和 disabled 契约。
- 新增页面结构、44px 命中区、reduced motion、移动输入字号和横向溢出契约。
- 锁定 PWA、API、缓存、阅读和超分关键文件不发生功能性差异。

### 16.2 浏览器矩阵

| 维度 | 覆盖 |
| --- | --- |
| 页面 | 登录、Home、History、Watchlist、Upload、Deduplicate、Metadata、Reader |
| 视口 | 1440×900、1024×768、768×1024、390×844 |
| 主题 | 浅色、深色、自定义浅色、自定义深色 |
| 输入 | 鼠标、键盘、触屏模拟 |
| 状态 | loading、empty、error、disabled、selected、dialog/menu open |

检查无横向溢出、遮挡、文本裁切、焦点丢失、菜单越界、触屏依赖 hover 和控制台 error/warn。Reader 还需验证普通/沉浸、单页/双页/Webtoon、设置抽屉、档案抽屉和超分开关只改变外观不改变结果。

## 17. 完成标准

- 全站呈现统一的档案编辑室气质，浅深主题像同一产品。
- 封面和漫画内容主导视觉，不再由玻璃面板、渐变或大圆角主导。
- 所有共享控件状态完整、键盘和触屏路径明确。
- 主要页面在 390px 无横向滚动、遮挡或不可点击控件。
- 静态视觉值显著从 inline style 收敛到 token/class；CSS 层级可理解。
- Base UI 只承担行为，不把预设视觉带入产品。
- 所有既有功能、数据、缓存、PWA、阅读和超分合同保持不变。
