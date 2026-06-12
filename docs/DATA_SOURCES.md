# MiniFund 数据源调研与选型

> 版本：v1.0 ｜ 更新日期：2026-06-12
>
> 本文档分析国内基金数据的可用来源，给出 MiniFund 的数据源选型结论、接口规格、限频与降级策略。
> 范围：国内公募基金（含 QDII，间接覆盖海外市场），不做海外基金直投数据。

## 1. 业界数据源全景分析

### 1.1 候选数据源对比

| 数据源 | 类型 | 成本 | 实时估值 | 数据完整度 | 稳定性 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 天天基金（东方财富） | 非官方 Web 接口 | 免费 | 支持（盘中分钟级） | 极高（搜索/净值/持仓/经理/排行/板块） | 高（业界事实标准，桌面端监控工具普遍采用） | **主数据源** |
| 腾讯财经 `qt.gtimg.cn` | 非官方 Web 接口 | 免费 | 指数/股票实时 | 中（无基金 F10） | 高 | **指数行情主源** |
| 新浪财经 `hq.sinajs.cn` | 非官方 Web 接口 | 免费 | 指数/股票实时 | 中 | 中（需 Referer 头） | **指数行情备源** |
| 蛋卷基金（雪球） | 非官方 Web 接口 | 免费 | 部分 | 高（指数估值特色） | 中（风控较严） | v2 备选 |
| AkShare | Python 聚合库 | 免费 | 依赖上游 | 高 | 中（本质是上游爬虫聚合） | 不采用（引入 Python 依赖不值得） |
| Tushare Pro | 官方 API | 积分/付费 | 不支持盘中估值 | 高 | 高 | 不采用（无盘中估值，核心诉求不满足） |
| Wind / Choice / iFinD | 商业终端 API | 昂贵 | 支持 | 极高 | 极高 | 不采用（个人工具成本不可接受） |

### 1.2 选型结论

1. **基金数据全部采用天天基金（东方财富）接口**：免费、字段齐全、盘中估值是其特色能力，且为韭菜盒子（LeekHub）、雪球小组件等业界同类工具的事实标准数据源。
2. **指数行情采用腾讯财经为主、新浪财经为备**：两者格式简单、稳定性好，互为降级。
3. **所有接口均为非官方接口**，必须在架构上做好抽象隔离（`internal/datasource`），单一接口失效时可快速替换，不影响上层业务。

## 2. 天天基金接口规格

### 2.1 盘中估值（核心接口）

```
GET https://fundgz.1234567.com.cn/js/{fundCode}.js
```

- 返回 JSONP：`jsonpgz({...});`，需正则提取 JSON 体。
- 交易时段约每分钟更新一次；非交易日返回最近交易日数据。
- QDII / 部分 FOF 无盘中估值（`gsz` 为空或长期不更新），需在业务层标记。

返回字段：

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `fundcode` | 基金代码 | `001186` |
| `name` | 基金名称 | `富国文体健康股票` |
| `jzrq` | 上一交易日净值日期 | `2026-06-11` |
| `dwjz` | 上一日单位净值 | `0.7420` |
| `gsz` | 实时估算净值 | `0.7251` |
| `gszzl` | 实时估算涨跌幅（%） | `-2.28` |
| `gztime` | 估值时间 | `2026-06-12 14:30` |

请求要求：需携带常规浏览器 `User-Agent`；建议带 `Referer: https://fund.eastmoney.com/`。

### 2.2 全量基金代码表（本地搜索索引）

```
GET https://fund.eastmoney.com/js/fundcode_search.js
```

- 返回 JS 数组：`var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","HUAXIACHENGZHANGHUNHE"],...]`。
- 字段依次为：代码、拼音首字母、名称、类型、拼音全拼。
- 约 2 万条，体积约 2MB。**策略：首次启动全量拉取并存入本地 SQLite，之后每周更新一次**，搜索完全走本地索引（代码/名称/拼音首字母/全拼模糊匹配）。

### 2.3 历史净值

```
GET https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=20&startDate=&endDate=
Header: Referer: https://fundf10.eastmoney.com/
```

- 返回标准 JSON，`Data.LSJZList` 为净值列表。
- 字段：`FSRQ`（净值日期）、`DWJZ`（单位净值）、`LJJZ`（累计净值）、`JZZZL`（日增长率%）、`SGZT`/`SHZT`（申购/赎回状态）、`FHSP`（分红送配）。
- 支持分页与日期范围，用于详情页历史净值表与本地净值缓存。

### 2.4 基金详情聚合数据（pingzhongdata）

```
GET https://fund.eastmoney.com/pingzhongdata/{code}.js
```

返回一个包含多个 JS 变量的脚本，需逐变量解析：

| 变量 | 含义 |
| --- | --- |
| `fS_name` / `fS_code` | 基金名称/代码 |
| `fund_sourceRate` / `fund_Rate` | 原始/实际申购费率 |
| `fund_minsg` | 最小申购金额 |
| `stockCodes` / `zqCodes` | 持仓股票/债券代码 |
| `Data_netWorthTrend` | 单位净值走势（时间序列，含每日涨跌幅） |
| `Data_ACWorthTrend` | 累计净值走势 |
| `Data_grandTotal` | 累计收益率走势（与同类平均、沪深300 对比） |
| `Data_currentFundManager` | 现任基金经理（含头像、任期、业绩） |
| `Data_fluctuationScale` | 规模变动 |
| `Data_assetAllocation` | 资产配置（股票/债券/现金占比） |
| `Data_performanceEvaluation` | 业绩评价五维图 |
| `swithSameType` | 同类基金推荐 |

补充接口（重仓股明细，含持仓占比）。实现采用移动端 JSON 接口（返回结构化数据，无需解析 HTML 表格）：

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&FCODE={code}
返回：{"Datas":{"fundStocks":[{"GPDM":"股票代码","GPJC":"股票简称","JZBL":"占净值比例"}]}}
```

备选（网页端 HTML 片段，解析成本高，不采用）：

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month=
Header: Referer: https://fundf10.eastmoney.com/
```

### 2.5 基金排行

```
GET https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft={type}&rs=&gs=0&sc={sortKey}&st=desc&sd={start}&ed={end}&qdii=&tabSubtype=,,,,,&pi=1&pn=50&dx=1
Header: Referer: https://fund.eastmoney.com/data/fundranking.html
```

- `ft`：基金类型（`all`全部 / `gp`股票 / `hh`混合 / `zq`债券 / `zs`指数 / `qdii` / `fof`）。
- `sc`：排序键（`rzdf`日涨幅 / `zzf`周 / `1yzf`月 / `3yzf`季 / `6yzf`半年 / `1nzf`年 / `jnzf`今年来 / `lnzf`三年）。
- 返回 JS 变量 `var rankData = {datas:[...]}`，每条为 `|` 分隔的字符串，需按位解析。

### 2.6 行业/概念板块行情（东财 push2）

```
GET https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f2,f3,f4,f12,f14,f104,f105,f128,f140,f136
```

- `fs=m:90+t:2` 行业板块；`m:90+t:3` 概念板块。
- 关键字段：`f12` 板块代码、`f14` 板块名称、`f3` 涨跌幅、`f104`/`f105` 上涨/下跌家数、`f128`/`f140` 领涨股及其代码。
- 标准 JSON，分钟级更新，用于"板块热力"页。

### 2.7 主题基金（按板块找基金）

```
GET https://fundztapi.eastmoney.com/FundSpecialTopicApi/FundSpecialTopicConcept?callback=&sort=ZDF&sorttype=DESC&pageindex=1&pagesize=50
```

用于"板块 → 相关基金"的主题映射（v1 可先做行业板块行情，主题映射放 v2）。

## 3. 指数行情接口规格

### 3.1 腾讯财经（主源）

```
GET https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_hkHSI,s_usIXIC
```

- 返回 GBK 编码文本：`v_s_sh000001="1~上证指数~000001~3245.12~12.34~0.38~...";`
- 字段按 `~` 分隔：名称、代码、当前点位、涨跌点数、涨跌幅。
- 支持沪深、港股（`hk` 前缀）、美股（`us` 前缀）指数，一次请求多个代码。

### 3.2 新浪财经（备源）

```
GET https://hq.sinajs.cn/list=s_sh000001,s_sz399001
Header: Referer: https://finance.sina.com.cn/
```

- 返回 GBK 编码文本，逗号分隔。**必须带 Referer，否则 403**。

### 3.3 默认监控指数

上证指数（sh000001）、深证成指（sz399001）、创业板指（sz399006）、沪深300（sh000300）、恒生指数（hkHSI）、纳斯达克（usIXIC）、标普500（usINX）。用户可在设置中增删。

## 4. 限频、缓存与降级策略

### 4.1 限频规则（写入 datasource 层，硬约束）

| 接口 | 频率上限 | 说明 |
| --- | --- | --- |
| 盘中估值 | 每只基金 ≥ 15s/次；批量并发 ≤ 8 | 上游约 1 分钟更新，默认 30s 轮询已足够 |
| 指数行情 | ≥ 10s/次（合并一次请求） | 多指数合并到单请求 |
| 历史净值/详情 | 按需请求 + 本地缓存 24h | 用户打开详情页才拉取 |
| 基金代码表 | 7 天/次 | 启动时检查时效 |
| 排行/板块 | ≥ 60s/次 | 页面可见时才轮询 |

### 4.2 缓存策略

- **SQLite 持久缓存**：基金代码表、历史净值、基金详情快照（带 `fetched_at` 时效字段）。
- **内存缓存**：盘中估值、指数行情（仅保留最新值 + 当日时间序列，用于走势小图）。
- 所有列表页先渲染缓存数据再异步刷新（stale-while-revalidate）。

### 4.3 降级与容错

1. 指数行情：腾讯失败 → 自动切换新浪；连续失败进入退避（30s → 60s → 120s）。
2. 估值接口失败：保留上次数据并在 UI 标注"数据更新于 HH:mm"，不清空。
3. 所有 HTTP 请求统一超时 5s、重试 1 次；解析失败记录原始响应到日志（截断）。
4. 全局熔断：单接口连续 5 次失败暂停该接口 5 分钟，事件通知前端展示降级横幅。

## 5. 风险声明与合规

1. 上述接口均为**非官方公开 Web 接口**，可能随时变更格式或加风控。架构上要求：所有解析逻辑收敛在 `internal/datasource/eastmoney`、`internal/datasource/tencent` 包内，上层仅依赖接口抽象。
2. 估值数据按基金历史持仓和指数走势估算，**不代表真实净值**，UI 必须明确标注"估算值，仅供参考"。
3. 本工具仅做个人数据展示，不缓存转售数据、不做高频请求，遵守合理使用原则。
4. 请求统一携带正常浏览器 UA，禁止伪造身份认证类头部。
