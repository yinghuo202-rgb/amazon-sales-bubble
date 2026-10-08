# 通用 ERP REST 适配

桌面版现在保留 GerpGo，同时支持“其他 ERP”入口。通用适配器使用一个带 Token 的 REST API，默认接口路径如下：

| 能力 | 方法 | 路径 | 返回重点 |
| --- | --- | --- | --- |
| 店铺 | GET | `/stores` | `id`、`name`、`marketplaceCode`、`currency` |
| 本位币 | GET | `/base-currency` | `data`、`baseCurrency` 或 `currency` |
| 汇率 | GET | `/exchange-rates` | `from`、`to`、`rate` |
| 今日销售 | GET | `/sales/today` | `total`、`baseCurrency` |
| 订单 | GET | `/orders` | `id/orderId`、`sku`、`amount`、`quantity`、`updatedAt` |
| 退款 | GET | `/refunds` | `id/refundId`、`sku`、`amount`、`updatedAt` |
| Review | GET | `/reviews` | `id/reviewId`、`star`、`content`、`updatedAt` |

所有列表可以直接返回数组，也可以包在 `data`、`rows` 或 `items` 中。增量接口接收 `cursor` 和 `updatedAfter` 查询参数，并在响应中返回 `nextCursor` 或 `cursor`。金额默认按主币单位传递，例如 `79.98`；如果使用最小货币单位，请使用 `amountMinor` 或 `minorAmount`。

Token 默认放入 `Authorization: Bearer <token>`，连接窗口也支持修改请求头名称和前缀。店铺的 `marketplaceCode` 使用 Amazon 国家代码（如 `US`、`CA`、`MX`、`UK`、`DE`、`JP`），其他国家可继续扩展市场映射。

如果 ERP 接口字段或路径不同，可以在 `electron/custom/datasource.cjs` 中增加专用映射，数据同步层和胶囊展示无需改动。
