# 去重选择与启动路由修复设计

## 目标

1. 移除重复档案条目下方多余分割线。
2. 选择档案只显示封面上的一个勾。
3. 智能选择不得修改用户手动操作过的分组。
4. 关闭阅读页后重新访问站点根 URL 时进入首页，同时保留 reload、页面丢弃和 PWA 后台恢复能力。

## 根因

- `.dedupe-card-item` 的 `border-bottom` 直接生成了条目下方横线。
- `ArchiveCard` 的 `selectionMode` 已渲染选择勾，`DedupeArchiveItem` 又通过 overlay 渲染第二个勾。
- `smartSelect` 每次替换全部 `selectedArchiveIds` 并清空 `selectedGroupKeys`，没有区分智能结果和用户操作。
- Reader 在隐藏和卸载时写入后台恢复候选；普通新导航也会消费该候选，导致根 URL 被恢复为 Reader。

## 设计

### 去重视觉

- 删除 `.dedupe-card-item` 的底部分割线。
- 删除 `DedupeArchiveItem` 的选择 overlay 和不再使用的样式。
- 保留共享 `ArchiveCard` 的封面勾、选中边框、checkbox 语义和键盘行为。

### 手动分组保护

- 在 `DeduplicatePage` 内维护会话级 `manuallyTouchedGroupKeys`。
- 用户手动切换档案时，将该档案所属的所有重复组记为手动组。
- 用户手动切换整组时，将该组记为手动组。
- 智能选择保留手动组内当前的档案选择和整组选中状态，只为未触碰组计算删除候选。
- 新检测和加载保存结果时清空手动组记录；该记录不写入持久化数据。

### 启动路由

- 普通 `navigate` 启动访问根 URL 时不消费后台 Reader 恢复候选。
- reload、`document.wasDiscarded` 和已有 PWA 更新保护仍沿用现有冷恢复流程。
- URL 本身显式带有 `?id=` 时始终按 URL 进入 Reader，不受此规则影响。

## 测试

- 智能选择跳过手动切换过档案的组。
- 智能选择跳过手动切换过整组的组。
- 未触碰组仍按现有优先规则智能选择。
- 去重条目没有专用底部分割线和第二个 overlay 勾。
- 普通根 URL 启动不恢复 Reader；显式 Reader URL、reload、discard/PWA 恢复合同保持有效。
- 最终运行完整测试、lint、build、diff check，并在真实浏览器检查去重选择与根 URL 启动。

## 非目标

- 不改变重复判定、互锁规则、删除策略或保存结果格式。
- 不持久化用户手动组来源。
- 不移除移动端/PWA 的后台恢复能力。
