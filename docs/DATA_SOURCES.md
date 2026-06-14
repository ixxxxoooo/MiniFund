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
- **滞后问题（重要修复）**：`fundgz` 在当日净值正式公布后会**滞后**——`dwjz`（最新净值）可能仍停留在上一交易日，`gsz/gszzl` 仍是已被实际净值取代的盘中估算（周末/节假日尤甚）。因此自选列表「最新净值」「估值净值」「估算涨跌」会与详情页（历史净值）对不上。**校正策略**：调度器每轮估值后用权威历史净值（`f10/lsjz`，与详情页同源）校正——「最新净值」始终取历史净值最新一条；当估算对应交易日（`gztime` 日期）≤ 最新已确认净值日期时，判定估算已过期并清除（自选估值/估算涨跌列显示「—」），仅在盘中（估算交易日尚未确认）保留实时估算。校正按 TTL 5 分钟 + 自选集合变化节流（`internal/scheduler` 的 `reconcileEstimates`/`latestNavCache`，批量历史净值 `eastmoney.FetchLatestNavs`，并发 ≤ 8）。
- **「今日涨幅」兜底（自选监控修复）**：自选列表「今日涨幅」原仅在有盘中估值（`HasEstimate`）时展示估算涨跌，盘后/非交易日清除估算后该列为空。校正时顺带把权威历史净值最新一条的**日增长率**（`f10/lsjz` 的 `JZZZL`，与排行 `rzdf` 同源）写入 `FundEstimate.DayGrowth`（`HasDayGrowth=true`）。前端「今日涨幅」取值优先盘中估算、否则回退已公布日涨幅，保证每只基金都有今日涨幅。

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
| （计算项）历史最大回撤 | 由 `Data_netWorthTrend` 单位净值序列计算：回撤=(谷值-此前峰值)/峰值，取整段最小者，写入 `FundDetail.MaxDrawdown`（%）。详情页以标签展示 |
| `Data_grandTotal` | 累计收益率走势（与同类平均、沪深300 对比） |
| `Data_currentFundManager` | 现任基金经理（含头像、任期、业绩） |
| `Data_fluctuationScale` | 规模变动 |
| `Data_assetAllocation` | 资产配置（股票/债券/现金占比） |
| `Data_performanceEvaluation` | 业绩评价五维图 |
| `swithSameType` | 同类基金推荐 |

补充接口（重仓股明细，含持仓占比）。实现采用移动端 JSON 接口（返回结构化数据，无需解析 HTML 表格）：

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&FCODE={code}
返回：{"Datas":{"fundStocks":[{"GPDM":"股票代码","GPJC":"股票简称","JZBL":"占净值比例","PCTNVCHG":"个股当日涨跌幅"}]}}
```

补充：解析新增 `PCTNVCHG`（个股当日涨跌幅，映射到 `Holding.changePercent`）。详情页持仓行展示「占比 + 涨跌幅（红绿配色）」，并按代码推断东方财富个股页地址（沪 `sh`/深 `sz`/北 `bj`/港 `hk`/美 `us`），点击股票名用系统浏览器打开。详情页头部提供「天天基金主页」按钮，用系统浏览器打开 `https://fund.eastmoney.com/{code}.html`。

备选（网页端 HTML 片段，解析成本高，不采用）：

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month=
Header: Referer: https://fundf10.eastmoney.com/
```

#### 重仓债券（纯债/债券型基金）

移动端持仓接口仅返回股票持仓，纯债/债券型基金股票持仓为空。无股票持仓时改拉天天基金 f10 **债券持仓**（`zqcc`，GBK 编码的 JS 片段 `var apidata={content:"<table>…"}`）：

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=zqcc&code={code}&rt={ms}
Header: Referer: https://fundf10.eastmoney.com/
```

- 解析：取 `apidata.content` 首个 `<tbody>`（最新报告期），逐行取列「债券代码 / 债券名称 / 占净值比例」映射到 `BondHolding{bondCode,bondName,percent}`。
- 限频/降级：仅在**股票持仓为空**时请求（避免对股票型基金多发一次请求）；失败不影响详情主体（持仓区降级为「暂无持仓数据」）。
- 展示：详情页持仓区在无股票持仓时标题切换为「重仓债券」，行展示「债券代码 / 债券名称 / 占比条 + 占净值比例」（债券无个股涨跌幅，不展示涨跌列）。

### 2.4.1 基金交易状态（申购/赎回状态与单日限额）

详情聚合接口 `FundMNDetailInformation`（已用于标签信息）额外解析字段：`SGZT`（申购状态）、`SHZT`（赎回状态）、`MAXSG`（单日累计申购上限，元）。空值占位（`""`/`--`/`0`）统一过滤，字段缺失时不展示标签。QDII 基金常有单日限额，在**基金详情页**以标签展示（不放入排行列表，避免逐行额外请求）。

### 2.5 基金排行

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNRank?FundType={num}&SortColumn={col}&Sort={desc|asc}&pageIndex=1&pageSize=30&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=minifund
Header: Referer: https://fund.eastmoney.com/
```

- **数据源（重要，已切换）**：从 PC 端 `rankhandler.aspx` 切换为移动端排行接口 `FundMNRank`。原因：`rankhandler` 返回的 25 个字段中**不含基金规模**（位置 16 为成立日期、位置 18 为自定义区间收益），此前用 `FundMNFInfo` 补全 `ENDNAV` 是**错误接口**（`FundMNFInfo` 是实时估值接口，字段只有 `NAV/GSZ/GSZZL/...`，根本没有规模），导致「规模列全空」。`FundMNRank` **原生返回 `ENDNAV`（规模，元）**与各周期收益，一次请求即可，无需补全。
- `FundType`：基金类型数字编码——`0`全部 / `25`股票 / `27`混合 / `31`债券 / `26`指数 / `6`QDII / `15`FOF（前端键 `all/gp/hh/zq/zs/qdii/fof` 在 `ranking.go` 的 `fundTypeToNum` 映射）。
- `SortColumn`：排序列——`RZDF`日涨幅 / `SYL_Z`近1周 / `SYL_Y`近1月 / `SYL_3Y`近3月 / `SYL_6Y`近6月 / `SYL_1N`近1年 / `SYL_JN`今年来 / `SYL_3N`近3年（前端排序键经 `sortKeyToColumn` 映射）。
- **分页大小固定 30**：`FundMNRank` 单页**最多返回 30 条**（传 `pageSize=50/100` 也只返回 30，已实测），故后端固定请求 30 条、前端 `RANK_PAGE_SIZE=30`，分页与行号据此计算。
- 返回标准 JSON：`{"Datas":[{...}],"TotalCount":N,"ErrCode":0}`。字段映射：`FCODE`代码 / `SHORTNAME`简称 / `FSRQ`净值日期 / `DWJZ`单位净值 / `LJJZ`累计净值 / `RZDF`日 / `SYL_Z`周 / `SYL_Y`近1月 / `SYL_3Y`近3月 / `SYL_6Y`近6月 / `SYL_1N`近1年 / `SYL_2N`近2年 / `SYL_3N`近3年 / `SYL_JN`今年来 / `SYL_LN`成立来 / `ENDNAV`规模(元)。空值以 `"--"` 表示，统一解析为 0。
- 字段取舍（前端列默认）：合并展示「单位净值+净值日期」一列（净值在上、日期在下）；必显——日/周/近1月/近3月/近6月/近1年/今年来、单位净值(含日期)、成立来、**规模**；默认隐藏（可在「列设置」开启）——累计净值、近2年、近3年。**已去掉手续费列，改为规模列**。前端列显隐配置持久化到 `localStorage`（`stores/columns`）。

### 2.6 热门主题（东财天天基金 ztjj `GetZTJJListNew`）

```
GET https://api.fund.eastmoney.com/ztjj/GetZTJJListNew?tt={类别}&dt=syl&st={周期}&pi=1&pn=500&_={毫秒时间戳}
Referer: https://fund.eastmoney.com/ztjj/default.html
```

- **数据源切换（重要修复）**：原先直连 `push2.eastmoney.com/api/qt/clist/get` 拉板块行情。实测桌面端 Go 客户端请求 push2 会在 **TLS 握手成功后被反爬静默断连（`EOF`）**，且无论补全 `Referer`/`ut` token/Cookie/浏览器请求头/HTTP1.1 均无法绕过（同一客户端访问 `fund.eastmoney.com`/`fundmobapi.eastmoney.com`/`api.fund.eastmoney.com` 均正常，浏览器访问 push2 也正常 —— 即 push2/quote 边缘对非浏览器客户端做了指纹拦截）。故改用**天天基金「主题基金」页（ztjj）同款、且主机可达**的 `api.fund.eastmoney.com/ztjj/GetZTJJListNew`。
- 参数：`tt` 板块类别 —— `0` 全部 / `001002` 行业 / `001003` 概念；`dt` 数据类型 —— `syl` 涨幅 / `zjlr` 资金流入；`st` 周期同时也是返回值字段名 —— 涨幅模式 `D` 今日 / `W` 近1周 / `M` 近1月 / `Q` 近3月 / `SY` 今年来（`Y` 为近1年）；`pn=500` 一次取全。
- **资金流入模式（重要更正）**：早期误判为「该接口忽略 `dt=zjlr`」。实测真正用法是 `dt=zjlr` 必须配合 `st=FLOW`（今日）/ `FLOW_W`（近1周）/ `FLOW_M`（近1月）/ `FLOW_Q`（近3月），返回的值字段名即 `FLOW`/`FLOW_W`/...，单位为元（主力资金净流入）。若仍传 `st=D` 则会回退为涨幅值，故此前才误以为「忽略 zjlr」。资金流入与涨幅同源、同为 ztjj 主题代码体系（`BK000xxx`），因此「按资金流入」视图点击主题可直接进入主题相关基金列表（无需再走 push2delay 的标准板块码）。
- 返回 `{"Data":[{"INDEXCODE":"BK000651","INDEXNAME":"光模块","M":6.1}, ...]}`：`INDEXCODE` 主题代码、`INDEXNAME` 主题名、值字段名随 `st` 变化。值可能为数字、`"--"` 或 `null`，解析层（`parseZTJJ`/`rawNumber`）用 `RawMessage` 容错为 0；兼容纯 JSON 与 JSONP 包装。
- **五档合并**：一个类别需 5 次请求（`st=D`/`W`/`M`/`Q`/`SY`）按 `INDEXCODE` 合并为 `ChangePercent`/`Week`/`Month`/`Month3`/`Ytd`。首档（今日）失败则整体失败，其余档失败仅该档为 0。顺序串行、按今日涨幅降序建序。
- CPO/PCB/**光模块**/算力/液冷/存储芯片 等热门主题均在其中，覆盖了 push2 时代「缺热门主题」的诉求。
- **阶段说明**：热力页「按涨幅」提供 今日/近1周/近1月/近3月/今年来 五档，按所选阶段涨幅降序着色（红涨绿跌跟随主题 token）。

#### 2.6.1 板块资金流入（与「按涨幅」同源 ztjj，`dt=zjlr` + 周期 `st`）

```
GET https://api.fund.eastmoney.com/ztjj/GetZTJJListNew?tt={类别}&dt=zjlr&st={FLOW|FLOW_W|FLOW_M|FLOW_Q}&pi=1&pn=500&_={毫秒时间戳}
Referer: https://fund.eastmoney.com/ztjj/default.html
```

- **数据源切换（重要修复）**：原「按资金流入」走 `push2delay.eastmoney.com` 取标准行业/概念板块（代码 `BK0xxx`），与 ztjj 主题码 `BK000xxx` 不互通，导致点击只能用浏览器打开东财板块页、无法进入主题相关基金，且主题集与「按涨幅」不一致。现统一改用与「按涨幅」同源的 `GetZTJJListNew`，仅把 `dt` 切为 `zjlr`。
- **阶段（新增）**：资金流入支持四档周期——`FLOW` 实时（今日）/ `FLOW_W` 近1周 / `FLOW_M` 近1月 / `FLOW_Q` 近3月，返回值字段名与 `st` 同名（单位：元）。前端阶段键 `now/week/month/m3` 经 `FetchSectorMoneyFlow(kind, stage)` 映射到上述 `st`；无「今年来」档。`FLOW_M`/`FLOW_Q` 接口返回顺序不稳定，实现层统一按净流入降序。
- 返回 `{"Data":[{"INDEXCODE":"BK000047","INDEXNAME":"有色金属","FLOW":14487557760.0}, ...]}`：`INDEXCODE` 主题代码（与涨幅视图一致）、`INDEXNAME` 主题名、`FLOW/FLOW_W/FLOW_M/FLOW_Q` 对应周期主力净流入（元）。实现见 `internal/datasource/eastmoney/sector.go` 的 `FetchSectorMoneyFlow`。`moneyflow.go`（push2delay 方案）已删除。
- **统一点击行为**：两种排序（涨幅 / 资金流入）的主题均为 `BK000xxx`，点击热力格子统一进入「主题相关基金」列表（不再有「资金流入只能开网页」的差异）。

#### 2.6.2 主题相关基金与主题详情（ztjj `GetBKRelTopicFundNew` / `GetBKDetailInfoNew`）

```
GET https://api.fund.eastmoney.com/ZTJJ/GetBKRelTopicFundNew?tp={BK代码}&isbuy=1&sort={排序键}&sorttype={DESC|ASC}&pageindex=N&pagesize=50&_={毫秒}
GET https://api.fund.eastmoney.com/ZTJJ/GetBKDetailInfoNew?tp={BK代码}&_={毫秒}
Referer: https://fund.eastmoney.com/ztjj/default.html
```

- **相关基金（`GetBKRelTopicFundNew`）**：即天天基金 `fund.eastmoney.com/ztjj/#!syl/Y/curr/{BK代码}/fst/DESC` 同款接口，**分页**（`pageindex`/`pagesize`，单页 50 条）。返回 `{"Data":[{FCODE,SHORTNAME,DWJZ,RZDF,SYL_Z/Y/3Y/6Y/1N/2N/3N/JN/LN,SYRQ,...}],"TotalCount":n}`，字段多为数字（可能为 `null`），复用 `RankItem/RankPage` 解析；排序键 `RZDF`(日)/`SYL_Z`(周)/`SYL_Y`(月)/`SYL_3Y`(近3月)/`SYL_6Y`(近6月)/`SYL_1N`(近1年)/`SYL_JN`(今年来)。`isbuy=1` 仅可购买（如光模块 462 只），`isbuy=0` 含全部（495 只）。前端按 `TotalCount/50` 计算页数、翻页预取，完整覆盖全部相关基金（解决「数据不全」）。
- **主题详情（`GetBKDetailInfoNew`，主题相关基金页顶部面板）**：返回主题自身各周期涨幅与同类排名 `{"Data":{"D","W","M","Q","Y","SY","RANKW","RANKM","RANKQ","RANKY","RANKSY","WSC","MSC","QSC","YSC","SYSC","SEC_CODE","SEC_NAME"}}`。映射 `model.ThemeDetail`：`D`→日涨幅（无排名）、`W/M/Q/Y/SY`→近1周/近1月/近3月/近1年/今年来涨幅、`RANK*`→同类排名、`*SC`→同类总数。实现见 `sector.go` 的 `FetchThemeDetail`/`parseThemeDetail`，服务层 `MarketService.GetThemeDetail`（60s 缓存），前端在主题相关基金页顶部以「涨幅 + 排名 x/总数」展示。

### 2.7 主题基金（按板块找基金）

> 注：`FundTopicInterface`（dt=11）返回的是**过时主题集**（大数据/一带一路/二胎概念…约148个，无 CPO/PCB/光模块），仅作为「主题 → 相关基金」的尽力匹配用；热门主题页不再单列「基金主题」标签。点击主题时：先按名称匹配主题，命中则进入主题基金列表，未命中则用系统浏览器打开东财站内搜索 `https://so.eastmoney.com/web/s?keyword={主题名}`。

```
GET https://fundztapi.eastmoney.com/FundSpecialTopicApi/FundSpecialTopicConcept?callback=&sort=ZDF&sorttype=DESC&pageindex=1&pagesize=50
```

用于"板块 → 相关基金"的主题映射（v1 可先做行业板块行情，主题映射放 v2）。

### 2.8 基金所属主题标签（东财搜索接口 `FundSearchAPI` 的 `ZTJJInfo`）

```
GET https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={基金代码}&pageindex=1&pagesize=5&_={毫秒时间戳}
Referer: https://fund.eastmoney.com/
```

- 用途：排行/搜索列表中，在每只基金名称下展示其**所属主题/概念标签**（如 CPO、电力设备、新能源）。东财无「基金→主题」批量接口，搜索接口按代码精确匹配返回的条目里带 `ZTJJInfo: [{TTYPE:"BKxxxxxx", TTYPENAME:"主题名"}]` 即所属主题列表。
- 解析（`eastmoney/theme.go: FetchFundThemes`）：取 `Datas` 中 `CODE == 基金代码` 的条目，读取其 `ZTJJInfo` → `[]model.FundTheme{Code(BK码), Name}`。
- **限频与缓存（重要）**：逐基金请求成本高，故 `FundService.GetFundThemes(codes)` 做 **30 天 SQLite 缓存（表 `fund_theme`）**；当前页缺失项以**并发上限 4** 拉取，失败的基金跳过（不展示标签、不影响整体），无主题也缓存空数组避免反复请求。前端按当前页 code 批量请求、增量合并、异步渲染，不阻塞表格。

### 2.9 基金阶段涨幅（移动端 `FundMNPeriodIncrease`）

```
GET https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease?FCODE={基金代码}&RANGE=&deviceid=minifund&plat=Iphone&product=EFund&version=6.6.6
Referer: https://fund.eastmoney.com/
```

- 用途：基金详情页展示**近1月/近3月/近6月/近1年/近3年/成立来**等阶段涨幅（红绿配色，附同类平均）。
- `RANGE=` 空表示阶段涨幅；返回 `{"Datas":[{"title":"Y","syl":"-2.43","avg":"-0.43","rank":"803","sc":"1091"},...]}`。`title` 周期键：`Z`近1周/`Y`近1月/`3Y`近3月/`6Y`近6月/`1N`近1年/`2N`近2年/`3N`近3年/`5N`近5年/`JN`今年来/`LN`成立来；`syl` 本基金涨幅%、`avg` 同类平均%、`rank` 同类排名、`sc` 同类数量。解析为 `[]model.PeriodReturn`，在 `FetchFundDetail` 中并入详情（失败不影响主体）。
- 另用于「搜索」页结果行内的**阶段收益补全**：`FundService.GetFundPerformance(codes)` 对当前页基金受限并发（≤ 6）拉取本接口，一次取齐 近1周(`Z`)/近1月(`Y`)/近3月(`3Y`)/近6月(`6Y`)/近1年(`1N`)/近2年(`2N`)/近3年(`3N`)/今年来(`JN`)/成立来(`LN`)；并配合 `fundgz` 同一响应补全「今日」(`gszzl`) 与 **单位净值/净值日期**(`dwjz`/`jzrq`)，结果按 `model.FundPerf` 返回；服务层 3 分钟内存缓存，前端按页异步合并（与主题标签同一懒加载模式，表格先出、单元格后填）。搜索页这些列可在「列设置」中显隐（参考基金排行），**不新增任何接口**。东财无按代码列表批量取各周期收益的接口，故采用此并发+缓存方案。

### 2.10 全球财经快讯（东财 `getFastNewsList`）

```
GET https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=50&req_trace={毫秒}&_={毫秒}
Referer: https://kuaixun.eastmoney.com/
```

- 用途：「财经快讯」页「全球快讯」Tab，对应 `https://kuaixun.eastmoney.com/7_24.html`（全部/全球 7×24 直播，`fastColumn=102`）的滚动短讯。
- **栏目选型（重要修复）**：原用 `fastColumn=109`（基金栏目，对应 `jj.html`），该栏目为**低频栏目**，非交易时段（周末/夜间）长时间无新条目，表现为「快讯不更新」。改用 `fastColumn=102`（全部/全球 7×24），**24 小时滚动更新**，与 `7_24.html` 一致。其余栏目编码：`101` 要闻 / `102` 全部 / `108` 债券 / `109` 基金 / `110` 大宗。
- 返回 `{"code":"1","data":{"fastNewsList":[{"code","title","summary","showTime","titleColor","stockList":[...]}]}}`，**`summary` 字段即完整短讯正文**（含【标题】前缀），无需二次抓取；`titleColor != 0` 表示重要快讯（标红）；`showTime` 为 `yyyy-MM-dd HH:mm:ss`。
- 解析（`eastmoney/news.go: FetchFlashNews`）→ `[]model.NewsFlash`，并**按 `showTime` 字典序倒序排序**（最新在前），保证前端列表恒为时间倒序。前端列表展示完整 `年-月-日 时:分:秒`（不再仅显示时分）。
- **更新方式**：由 `internal/scheduler` 按设置 `newsPollSec`（默认 60s，最小 30s）定时拉取，与盘中估值/暂停状态解耦；通过 `news:flash` 事件广播最新列表；新增条目（以 `news_last_id` 游标判断）在开启「快讯桌面通知」时经 Wails 通知服务弹系统通知（首轮与重启后不补推历史）。

### 2.11 基金滚动资讯与文章正文（`roll` 页 + `#ContentBody`）

```
GET https://roll.eastmoney.com/fund.html                 # 资讯列表（服务端渲染 HTML）
GET https://finance.eastmoney.com/a/{文章编号}.html       # 文章正文页
GET https://fund.eastmoney.com/a/{文章编号}.html
Referer: https://kuaixun.eastmoney.com/
```

- 与快讯的区别：快讯是短讯（summary 即全文）；`roll/fund.html` 是**完整新闻文章**列表（标题 + 指向 `/a/{id}.html` 详情页），二者内容形态不同，故「财经快讯」页用「基金资讯」Tab 单独承载。
- 列表解析（`FetchRollNews`）：正则提取页面中 `finance|fund.eastmoney.com/a/{id}.html` 的文章链接与标题，文章编号前 8 位即 `yyyyMMdd`（据此推导发布日期），去重后取前 50 条。
- 正文解析（`FetchArticleContent` → `parseArticleHTML`）：用 `golang.org/x/net/html` 解析文章页 `id="ContentBody"`，按**白名单清洗为安全 HTML 片段**——保留 `<p>`/`<br>`/`<a>`（仅 http(s) 超链接，如个股行情页 `quote.eastmoney.com`）/`<img>`（正文图片）/`<strong>`/`<em>`；文本与属性值均做 HTML 转义，链接仅放行 http(s)（杜绝 `javascript:` 等）。剔除：引流广告段（「在东方财富看资讯行情」等）、开户/活动引流图与链接（`acttg.eastmoney.com`、`em_handle_adv_close`）、隐藏占位段、`<script>`/`<style>` 等。前端在独立窗口以富文本渲染（`.news-article`），**点击正文超链接经窗口拦截后用系统浏览器打开**，图片自适应展示；AI 解读前由前端去标签取纯文本。
- 缓存：列表 60s、正文 30 分钟（正文不可变）；均为按需抓取（进入页/点击时），不参与定时轮询与通知。

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

### 3.4 行情中心（腾讯主源 + 新浪美股/北证源 + 东财兜底/韩国）

行情中心展示常见 A 股/港股/美股/韩国指数清单及选中指数的 K 线。指数清单（含东财 `secid`、腾讯符号、新浪符号与 K 线来源标识 `KSource`）硬编码在 `internal/datasource/eastmoney/quote.go` 的 `MarketCenterIndexes`；服务层 `MarketService.GetIndexKline` 按 `KSource` 路由。

> ⚠️ **重要：东财 `push2`/`push2his` 域名对非浏览器客户端会被指纹拦截**（连接直接关闭、返回空响应；高频访问后整段时间不可用）。因此行情中心**实时报价一律走腾讯**（覆盖全部，稳定）；**K 线按市场分源**：
> - A 股主要指数 + 港股 → 腾讯 `fqkline`（完整历史，日/周/月原生）；
> - **北证 50** → 腾讯仅返回最新一根，改走**新浪 A 股 K 线** `CN_MarketDataService.getKLineData`；
> - **美股（道指/纳指/标普）** → 腾讯仅返回最新一根，改走**新浪美股 K 线** `US_MinKService.getDailyK`（自上市以来全部日线）。
> - 新浪源仅提供日线，**周/月线由服务端聚合**（开取区间首日、收取末日、高低取极值、量累计，涨跌幅按相邻收盘推算），实现见 `internal/datasource/sina/kline.go`。
> - 东财 `push2his` 保留为最后兜底（多数情况下被反爬，基本不生效）。

**指数清单（secid ↔ 腾讯符号）**：上证 `1.000001`/`sh000001`、深证成指 `0.399001`/`sz399001`、创业板指 `0.399006`/`sz399006`、科创50 `1.000688`/`sh000688`、北证50 `0.899050`/`bj899050`、沪深300 `1.000300`/`sh000300`、上证50 `1.000016`/`sh000016`、中证500 `1.000905`/`sh000905`、中证1000 `1.000852`/`sh000852`、恒生 `100.HSI`/`hkHSI`、国企 `100.HSCEI`/`hkHSCEI`、道琼斯 `100.DJIA`/`usDJI`、纳斯达克 `100.IXIC`/`usIXIC`、纳斯达克100 `100.NDX`/`usNDX`、标普500 `100.SPX`/`usINX`、**韩国KOSPI `100.KS11`（无腾讯/新浪符号，`KSource=eastmoney`）**。

> 📌 **成交量单位**：A 股指数成交量以「**手**」计（腾讯/东财口径），港股/美股/韩国以「**股**」计（腾讯/新浪口径），两类量纲不同。前端 `MarketCenterPage.formatVol(v, group)` 按分组显式标注单位，避免被误读为同一口径。

**批量实时报价（主源：腾讯 `qt.gtimg.cn`）**：

```
GET https://qt.gtimg.cn/q=s_sh000001,s_hkHSI,s_usDJI,...
```

- 复用 `tencent.Source.FetchIndexQuotes`（GBK 文本，`~` 分隔，取名称/点位/涨跌点/涨跌幅）；一次请求返回全部指数。
- 后端 5s 内存缓存合并多窗口/多次事件触发的重复请求；按清单顺序输出并补名称占位。
- 兜底：腾讯整体失败时回退东财 `ulist.np`（`https://push2.eastmoney.com/api/qt/ulist.np/get?secids=...&fields=f2,f3,f4,f12,f13,f14`），仍失败才报错。
- **腾讯无符号的指数（韩国KOSPI）**：腾讯轮询跳过这些指数（`Tencent==""`），随后用东财 `ulist.np` 按 `secid` 批量补全实时报价（`eastmoney.FetchIndexQuotesBySecids`，每轮一次小请求）；补全失败仅占位不影响其他指数。
  - **匹配修正（KOSPI 拉取失败修复）**：全球指数在 `ulist.np` 返回的 `f13`（市场号）/`f12`（代码大小写）可能与请求清单不完全一致，导致按「市场.代码」精确匹配失败、KOSPI 一直占位（拉取数据失败）。`FetchIndexQuotesBySecids` 与东财兜底 `FetchMarketCenterQuotes` 均增加「按代码（忽略大小写）回退匹配到请求清单 `secid`」的逻辑，确保 KOSPI 实时报价能正确回填。

**K 线（主源：腾讯 `web.ifzq.gtimg.cn`）**：

```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,240,qfq
```

- 实现见 `internal/datasource/tencent/kline.go` 的 `FetchIndexKline`。`param=代码,周期,起,止,条数,复权`，周期 `day`/`week`/`month`。
- 响应 `data.{代码}.{周期}` 为二维数组，每行 `[日期, 开, 收, 高, 低, 量, ...]`；指数无复权概念，涨跌幅由相邻收盘价推算，成交额腾讯不提供置 0。
- A 股主要指数/港股可取完整历史。**北证 50、美股腾讯仅返回最新一根**（≤1 条），改走新浪：

```
# 北证 50（及任意沪深指数）日线，scale=240=日，datalen 控制条数，升序
GET https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_t=/CN_MarketDataService.getKLineData?symbol=bj899050&scale=240&ma=no&datalen=240
# 美股指数（.DJI/.IXIC/.INX）日线，返回自上市以来全部，升序
GET https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/var%20_t=/US_MinKService.getDailyK?symbol=.DJI
Referer: https://finance.sina.com.cn/
```

- 新浪响应为带注释/JSONP 包装，取首个 `[` 到末个 `]` 之间的 JSON 数组解析；A 股行字段 `{day,open,high,low,close,volume}`，美股行字段单字母 `{d,o,h,l,c,v,a}`。
- 切换逻辑（`MarketService.GetIndexKline`）：按 `KSource` 选 腾讯 / 新浪CN / 新浪US → 不足 2 根则回退东财 `push2his` → 仍不足 2 根返回「该指数历史 K 线暂不可用」。
- **韩国KOSPI（`KSource=eastmoney`）**：腾讯/新浪均无该指数，K 线**直接走东财 `push2his`**（`secid=100.KS11`）。东财被反爬时该指数 K 线不可用（显示提示），但其实时报价仍由 `ulist.np` 正常补全。
- `klt`：101 日 / 102 周 / 103 月。后端 60s 内存缓存（按 `secid + 周期` 维度）；K 线按需请求（选中指数/切换周期时拉取），不进入调度器轮询。

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
- **服务层 TTL 缓存**：排行 / 主题列表 / 主题基金 / 板块（按 `all`/`industry`/`concept` 分键）60s 内存缓存（`services/cache.go`），配合前端翻页预取实现秒开；应用启动后后台预加载默认排行首页与「全部板块」热力。
- **连接复用**：`internal/datasource` 共享 `http.Transport` 开启 keep-alive 长连接池与透明 gzip，降低天天基金多接口多域名请求的 TLS/TCP 握手开销。
- 所有列表页先渲染缓存数据再异步刷新（stale-while-revalidate）。

### 4.3 降级与容错

1. 指数行情：腾讯失败 → 自动切换新浪；连续失败进入退避（30s → 60s → 120s）。
2. 估值接口失败：保留上次数据并在 UI 标注"数据更新于 HH:mm"，不清空。
3. 所有 HTTP 请求统一超时 5s、重试 1 次；解析失败记录原始响应到日志（截断）。
4. 全局熔断：单接口连续 5 次失败暂停该接口 5 分钟，事件通知前端展示降级横幅。

## 5. AI 解读数据源（OpenAI 兼容）

```
POST {aiBaseURL}/chat/completions
Authorization: Bearer {aiKey}
Content-Type: application/json
{"model":"{aiModel}","messages":[{"role":"system",...},{"role":"user",...}],"temperature":0.3,"stream":false}
```

- 用途：「财经快讯」页对单条新闻一键「AI 解读」。请求收敛在 `internal/datasource/ai`（遵守「外部请求只允许出现在 datasource 子包」约束），超时 60s。
- 兼容 OpenAI Chat Completions 协议，可对接 DeepSeek / 通义 / Moonshot / OpenAI 等；服务地址、密钥、模型均在「设置 - AI 解读」中配置（默认地址 `https://api.deepseek.com/v1`、模型 `deepseek-chat`，密钥需用户自填）。
- 解析 `choices[0].message.content` 作为解读文本；`error.message` 或非 200 状态返回错误并在弹窗中提示。

## 6. 风险声明与合规

1. 上述接口均为**非官方公开 Web 接口**，可能随时变更格式或加风控。架构上要求：所有解析逻辑收敛在 `internal/datasource/eastmoney`、`internal/datasource/tencent` 包内，上层仅依赖接口抽象。
2. 估值数据按基金历史持仓和指数走势估算，**不代表真实净值**，UI 必须明确标注"估算值，仅供参考"。
3. 本工具仅做个人数据展示，不缓存转售数据、不做高频请求，遵守合理使用原则。
4. 请求统一携带正常浏览器 UA，禁止伪造身份认证类头部。
