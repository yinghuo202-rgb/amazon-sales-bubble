> Superseded for data integration by `docs/GERPGO_API_INVENTORY.md` and the GerpGo integration specification. This historical document is retained only for UI behavior and event semantics.

# Amazon Sales Bubble

Amazon Sales Bubble 是一个面向 Amazon Seller 的 Windows 实时销售状态组件。

它不替代 Seller Central，也不做完整 Dashboard。产品只保留最需要持续感知的经营信息：

- 当日销售额
- 新订单
- 退款
- Review

核心界面由两部分组成：

1. **任务栏销售额状态**
2. **液态玻璃悬浮事件气泡**

任务栏负责“持续状态”，气泡负责“即时事件”。

---

## 1. 产品目标

正常状态下，任务栏只显示一个销售额数字：

```text
$12,486.37
```

发生新订单时：

```text
+ MA025 × 2
  $79.98
```

同时任务栏销售额向上变化，并短暂显示绿色：

```text
$12,486.37
     ↑
$12,566.35
```

发生退款时：

```text
- MA025 × 1
  $39.99
```

任务栏销售额向下变化，并短暂显示红色：

```text
$12,566.35
     ↓
$12,526.36
```

出现 Review 时：

```text
★★☆☆☆
MA025
Gauge stopped working...
```

Review 不影响销售额。

---

## 2. V1 范围

### 支持

- Amazon
- Windows 10 / Windows 11
- 多 Marketplace
- 当日销售额
- 新订单
- 退款
- Review
- 任务栏常驻
- 桌面悬浮事件气泡
- 连续事件合并
- 开机自启动
- 本地数据缓存与事件去重

### 暂不支持

- Shopify / Walmart / eBay / TikTok Shop
- macOS
- 手机端
- 广告数据
- ACOS / TACOS
- 库存管理
- Buy Box
- Listing 异常
- 利润核算
- 图表
- BI Dashboard

---

## 3. UI 结构

### 3.1 任务栏组件

任务栏组件仅负责：

```text
当前总销售额
+
销售额增减动画
+
正负颜色反馈
```

默认：

```text
$12,486.37
```

目标是实现真正的 Windows 任务栏集成。

开发中必须区分：

```text
Native Taskbar Mode
```

和：

```text
Compatibility Overlay Mode
```

透明窗口贴附任务栏只能视为兼容模式，不能视为最终原生集成。

---

### 3.2 悬浮气泡

悬浮气泡用于展示即时事件。

订单：

```text
+ MA025 × 2
  $79.98
```

退款：

```text
- MA025 × 1
  $39.99
```

Review：

```text
★★☆☆☆
MA025
Gauge stopped working...
```

气泡不长期驻留。

---

## 4. Liquid Glass 设计语言

任务栏组件和悬浮气泡使用统一的液态玻璃视觉体系。

要求：

- 半透明玻璃材质
- 背景模糊
- 柔和高光边缘
- 极弱内阴影
- 极弱外阴影
- 高圆角
- 克制的层次感
- 高可读性
- 不使用复杂纹理背景

任务栏比气泡更轻、更透明。

气泡的信息密度略高，但仍保持统一视觉语言。

---

## 5. 字体规范

Windows 11：

```text
Segoe UI Variable
```

Windows 10 fallback：

```text
Segoe UI
```

推荐字体栈：

```css
font-family:
  "Segoe UI Variable",
  "Segoe UI",
  Arial,
  sans-serif;
```

销售额数字必须启用等宽数字：

```css
font-variant-numeric: tabular-nums;
```

避免金额变化时发生明显横向抖动。

### 建议层级

任务栏销售额：

```text
14–16 px
Semibold
```

气泡主行：

```text
14 px
Semibold
```

气泡次级信息：

```text
12–13 px
Regular / Semibold
```

---

## 6. 颜色规范

### 默认状态

销售额：

```text
Neutral / White
```

### 新订单

销售额增加时：

```text
Green
```

推荐基准：

```text
#30D158
```

动画结束约 800–1200 ms 后恢复 Neutral。

订单气泡中：

- `+`：绿色
- 金额：绿色
- MSKU / Qty：Neutral

### 退款

销售额减少时：

```text
Red
```

推荐基准：

```text
#FF453A
```

动画结束后恢复 Neutral。

退款气泡中：

- `-`：红色
- 金额：红色
- MSKU / Qty：Neutral

### Review

Review 不使用整卡红绿染色。

1–2 星可以对星级做轻微警示强调，正文保持 Neutral。

---

## 7. 数字动画

金额更新不能直接跳变。

### 增加

```text
$12,486.37
     ↑
$12,566.35
```

表现：

- 旧值向上离场
- 新值向上进入
- 新值短暂绿色
- 颜色恢复 Neutral

### 减少

```text
$12,566.35
     ↓
$12,526.36
```

表现：

- 旧值向下离场
- 新值向下进入
- 新值短暂红色
- 颜色恢复 Neutral

禁止使用老虎机式逐字符乱滚。

推荐动画时长：

```text
金额滚动：400–700 ms
颜色保持：800–1200 ms
恢复 Neutral：200–400 ms
```

---

## 8. 多 Marketplace

如果账户只有一个 Marketplace，直接显示该市场的当日销售额。

如果账户包含多个 Marketplace，默认显示所有已启用市场的销售额总和。

例如：

```text
US   $8,200.00
CA   CA$2,000.00
MX   MX$4,000.00
```

最终统一换算为 Base Currency 后显示：

```text
$10,486.37
```

---

## 9. Base Currency

不同 Marketplace 不允许直接跨币种相加。

用户设置：

```text
Base Currency: USD
```

计算过程：

```text
US → USD
CA → CAD → USD
MX → MXN → USD
```

任务栏始终显示统一 Base Currency。

需要保存：

- 原始币种
- 原始金额
- 汇率
- 转换后金额
- 汇率时间

建议同一自然日使用固定汇率，避免历史销售额随着实时汇率不断变化。

---

## 10. 多市场事件

任务栏显示全部市场汇总。

气泡显示事件来源市场。

例如加拿大订单：

```text
+ CA · MA025 × 1
  CA$60.00
```

任务栏按照 Base Currency 更新，例如：

```text
+$43.80
```

原则：

```text
Bubble = 原始事件
Taskbar = 汇总状态
```

单 Marketplace 时不显示市场代码。

---

## 11. 连续事件合并

默认合并窗口：

```text
3 seconds
```

### 同一 MSKU

```text
+ MA025 × 1
+ MA025 × 2
```

合并为：

```text
+ MA025 × 3
  $119.97
```

### 多 MSKU

1–2 个事件：

逐条展示。

3 个及以上：

```text
+ 3 MSKUs / 4 Units
  $186.95
```

### 高频订单

10 秒内达到 5 个及以上订单：

```text
+ 7 Orders
  $428.36
```

### 退款

使用同样逻辑：

```text
- 4 Refunds
  $163.92
```

### Review

1–2 条：

逐条显示。

3 条及以上：

```text
4 Reviews
2 Negative
```

存在 1–2 星 Review 时优先展示低星内容。

---

## 12. 事件优先级

等待队列优先级：

```text
1. Refund
2. 1–2 Star Review
3. 3 Star Review
4. Order
5. 4–5 Star Review
```

已经开始播放的事件不被强行打断。

数据状态必须立即更新，UI 动画可以排队。

---

## 13. Amazon 数据

第一版使用：

```text
Amazon Selling Partner API
```

即：

```text
SP-API
```

### Order

至少需要：

```text
Amazon Order ID
Order Item ID
Marketplace
MSKU
Quantity
Amount
Currency
Purchase Time
Status
```

### Refund

至少需要：

```text
Refund Transaction ID
Amazon Order ID
Marketplace
MSKU
Quantity
Refund Amount
Currency
Timestamp
```

### Review

Review 独立封装为：

```text
Review Monitor
```

UI 层只消费标准事件，不依赖具体 Review 数据源。

---

## 14. 统一事件模型

```ts
type EventType = "ORDER" | "REFUND" | "REVIEW";

interface Event {
  id: string;
  type: EventType;
  timestamp: string;

  marketplace?: string;

  msku?: string;
  quantity?: number;

  amount?: number;
  currency?: string;

  baseAmount?: number;
  baseCurrency?: string;

  rating?: number;
  content?: string;
}
```

---

## 15. 系统架构

```text
Amazon SP-API
       │
       ├── Order Service
       ├── Refund Service
       └── Review Monitor
       │
       ▼
    Event Engine
       │
       ├── Deduplication
       ├── Merge Engine
       ├── Priority Queue
       └── Currency Conversion
       │
       ▼
     Local Store
       │
       ▼
      UI Engine
       │
       ├── Native Taskbar
       ├── Amount Animation
       └── Liquid Glass Bubble
```

---

## 16. 本地数据

推荐：

```text
SQLite
```

至少保存：

```text
Orders
Refunds
Reviews
Events
Daily Summary
Exchange Rates
Settings
```

目的：

- 快速恢复 UI
- 防止重复通知
- 记录当天销售额
- 支持离线恢复
- 保存汇率
- 保存用户设置

---

## 17. 去重

订单唯一键：

```text
AmazonOrderID + OrderItemID
```

退款：

```text
RefundTransactionID
```

Review：

```text
ReviewID
```

历史事件不得在应用重启后重新弹出。

---

## 18. 启动逻辑

```text
App Start
   ↓
Load Local State
   ↓
Render Last Known Sales
   ↓
Connect Amazon
   ↓
Sync Current Day
   ↓
Correct Sales Total
   ↓
Set Event Baseline
   ↓
Listen / Poll New Events
```

首次安装同步到的历史数据只用于建立销售额，不作为新事件播报。

---

## 19. 技术方向

桌面端优先：

```text
Tauri
+
React
+
Rust
+
SQLite
```

UI 重点：

- Liquid Glass
- 高质量透明窗口
- 高帧率动画
- Segoe UI Variable
- tabular numbers
- Native Taskbar 集成研究

任务栏集成必须作为单独技术模块验证。

---

## 20. 性能目标

常驻程序要求：

```text
Idle CPU ≈ 0%
```

内存目标：

```text
< 150 MB
```

动画不得造成任务栏明显卡顿。

不得通过高频刷新网页实现订单监控。

---

## 21. MVP 验收标准

必须完成：

- Amazon 授权
- 多 Marketplace 数据获取
- Base Currency 汇总
- 当日销售额计算
- Windows 任务栏常驻
- 原生任务栏方案验证
- Liquid Glass 视觉
- Segoe UI Variable
- 等宽数字
- 新订单气泡
- 退款气泡
- Review 气泡
- 销售额上下滚动动画
- 增加绿色
- 减少红色
- 动画结束恢复 Neutral
- 连续事件合并
- 本地事件去重
- 离线恢复
- Windows 开机自启

---

## 22. 核心设计原则

```text
Taskbar = State
Bubble = Event
```

任务栏只回答：

> 今天一共卖了多少？

悬浮气泡回答：

> 刚刚发生了什么？

最终常态：

```text
$12,486.37
```

新订单：

```text
+ MA025 × 2
  $79.98
```

同时：

```text
$12,486.37
     ↑
$12,566.35  Green
     ↓
$12,566.35  Neutral
```

退款：

```text
- MA025 × 1
  $39.99
```

同时：

```text
$12,566.35
     ↓
$12,526.36  Red
     ↓
$12,526.36  Neutral
```

Review：

```text
★★☆☆☆
MA025
Gauge stopped working...
```

任务栏销售额保持不变。
