# GerpGo OpenAPI Inventory

本清单以积加开放平台文档详情接口（`https://open.gerpgo.com/api/openAdmin/doc/detail?id=...`）为唯一依据，已核对请求示例、分页上限、时间字段和响应字段。官方文档前端通过 `https://open.gerpgo.com/api/open` 代理业务请求，桌面应用默认使用这个地址。

| Capability | Official API Name | Method | Endpoint | Pagination | Time Filter | Key Fields | Status |
|---|---|---|---|---|---|---|---|
| Auth | 获取 accessToken | POST | `/api_token` | - | - | body `appId`, `appKey`; response `data.accessToken`, `expiresIn`, `expiresOut` | VERIFIED |
| Stores | 查询亚马逊店铺信息 | POST | `/middle/base/market/page` | `page`, `pagesize` ≤100 | `condition.recordDateStart/End` | `data.rows[].marketListVos[]`: `marketId`, `market`, `store`, `countryCode`, `state`, `apiState` | VERIFIED |
| Base Currency | 获取本位币币种 | GET | `/middle/base/baseCurrency/query` | - | - | `data` ISO currency string | VERIFIED |
| Exchange Rates | 查询汇率设置 | POST | `/middle/base/rate/page` | `page`, `pagesize` ≤500 | `condition.monthDate` | `data.rows[]`: `currency`, `referenceRate`, `customRate`, `monthDate` | VERIFIED |
| Sales | 店铺表现 | POST | `/operation/sts/storeSalesPerformance/page` | `page`, `pagesize` ≤100 | `beginDate`, `endDate` | `data.rows[]`: `marketId`, `countryName`, `orderProductSalesAmount` | VERIFIED |
| Orders | 查询订单列表 | POST | `/operation/sale/order/page` | `page`, `pagesize` ≤200 | `lastUpdateStartDate/EndDate` | `data.rows[]`: `orderId`, `marketId`, `orderStatus`, `updateDate`, `currencyCode`, `itemVos[].sellerSku`, `quantityOrdered`, `itemPriceAmount` | VERIFIED |
| Refunds | 查询退款订单列表 | POST | `/operation/sale/refundOrder/page` | `page`, `pagesize` ≤100 | `dateType=2`, `startDate`, `endDate` | `data.rows[]`: `marketId`, `orderId`, `msku`, `marketAmount`, `settlementTimeMarket`, `typeDetail` | VERIFIED_WITH_LIMITS |
| Reviews | Review | POST | `/operation/crm/review/page` | `page`, `pagesize` ≤100 | `updateDateBegin/End` | `data.rows[]`: `reviewId`, `marketId`, `product`, `asin`, `star`, `content`, `reviewDate` | VERIFIED |

## Implementation notes

- Business route shapes were verified from the official document detail service for document IDs 153, 66, 139, 132, 70, 1011 and 1092.
- Refund rows do not expose quantity or a dedicated refund ID; the provider preserves the documented row identity and treats each row as one refund event. The limitation is kept explicit as `VERIFIED_WITH_LIMITS`.
- `GerpGoClient` uses the documented `accessToken` request header and retries one expired token request only. When the account enables `接口签名验证`, every business request automatically receives a lower-case MD5 `sign` header computed from the exact compact JSON body (or an empty string for a bodyless request) followed by `appKey`; the `/api_token` exchange remains unsigned.
- Store performance requests send the selected store `marketId` values in `marketList`. The same selection filters order, refund and Review feeds, so the displayed total and event notifications use one store scope. Empty selection means all enabled stores.
- GerpGo monthly exchange-rate rows are quoted against CNY (`CNY=1`); the adapter converts each source quote to `sourceQuote / baseQuote` before storing the fixed daily rate.
- Token credentials are the documented `appId` and `appKey`; they are stored through the Electron safe storage boundary by the desktop process. The official documentation UI proxies business routes through `https://open.gerpgo.com/api/open`, which is the app default; `GERPGO_BASE_URL` can still override it for a generated account Host.
