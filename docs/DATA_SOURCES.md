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
- 参数：`tt` 板块类别 —— `0` 全部 / `001002` 行业 / `001003` 概念；`dt=syl` 涨幅；`st` 周期同时也是返回值字段名 —— `D` 今日 / `Q` 近3月 / `SY` 今年来（另有 `W`/`M`/`Y` 等未用）；`pn=500` 一次取全。
- 返回 `{"Data":[{"INDEXCODE":"BK000651","INDEXNAME":"光模块","SY":122.85}, ...]}`：`INDEXCODE` 主题代码、`INDEXNAME` 主题名、值字段名随 `st` 变化。值可能为数字、`"--"` 或 `null`，解析层（`parseZTJJ`/`rawNumber`）用 `RawMessage` 容错为 0；兼容纯 JSON 与 JSONP 包装。
- **三档合并**：一个类别需 3 次请求（`st=D`/`Q`/`SY`）按 `INDEXCODE` 合并为 `ChangePercent`/`Month3`/`Ytd`。首档（今日）失败则整体失败，其余档失败仅该档为 0。顺序串行、按今日涨幅降序建序。
- CPO/PCB/**光模块**/算力/液冷/存储芯片 等热门主题均在其中（如「光模块」今年来居首），覆盖了 push2 时代「缺热门主题」的诉求。
- **阶段说明**：仅提供 今日(`D`)/近3月(`Q`)/今年来(`SY`) 三档；该接口仅返回涨幅值，不返回资金流入金额，故热力页移除「按资金流入」排序，统一按所选阶段涨幅降序着色（红涨绿跌跟随主题 token）。
- **点击主题 → 相关基金（重要）**：点击热力格子直接进入「主题相关基金」列表，按主题代码 `BKxxxxxx` 调用 `api.fund.eastmoney.com/ZTJJ/GetBKRelTopicFundNew?tp={BK代码}&isbuy=1&sort={排序键}&sorttype={DESC|ASC}&pageindex=N&pagesize=50`（即天天基金 `fund.eastmoney.com/ztjj/#!curr/{BK代码}/fst/DESC` 同款接口）。返回 `{"Data":[{FCODE,SHORTNAME,DWJZ,RZDF,SYL_Z/Y/3Y/6Y/1N/2N/3N/JN/LN,SYRQ,...}],"TotalCount":n}`，字段多为数字（可能为 `null`），复用 `RankItem/RankPage` 解析；排序键 `RZDF`(日)/`SYL_Z`(周)/`SYL_Y`(月)/`SYL_3Y`(近3月)/`SYL_6Y`(近6月)/`SYL_1N`(近1年)/`SYL_JN`(今年来)。配套 `GetBKDetailInfoNew?tp={BK代码}` 提供主题自身各周期涨幅与排名（暂作展示备用）。

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

### 3.4 行情中心（腾讯主源 + 东财兜底）

行情中心展示常见 A 股/港股/美股指数清单及选中指数的 K 线。指数清单（含东财 `secid` 与腾讯符号的映射）硬编码在 `internal/datasource/eastmoney/quote.go` 的 `MarketCenterIndexes`；服务层 `MarketService` 负责「腾讯主源 / 东财兜底」的切换。

> ⚠️ **重要：东财 `push2`/`push2his` 域名对非浏览器客户端会被指纹拦截**（连接直接关闭、返回空响应；高频访问后整段时间不可用）。因此行情中心**实时报价与 A 股/港股 K 线一律走腾讯**（与全局指数行情同源，稳定），**仅美股、北证 50 的历史 K 线**（腾讯不提供完整历史）回退东财 `push2his`。

**指数清单（secid ↔ 腾讯符号）**：上证 `1.000001`/`sh000001`、深证成指 `0.399001`/`sz399001`、创业板指 `0.399006`/`sz399006`、科创50 `1.000688`/`sh000688`、北证50 `0.899050`/`bj899050`、沪深300 `1.000300`/`sh000300`、上证50 `1.000016`/`sh000016`、中证500 `1.000905`/`sh000905`、中证1000 `1.000852`/`sh000852`、恒生 `100.HSI`/`hkHSI`、国企 `100.HSCEI`/`hkHSCEI`、道琼斯 `100.DJIA`/`usDJI`、纳斯达克 `100.NDX`/`usIXIC`、标普500 `100.SPX`/`usINX`。

**批量实时报价（主源：腾讯 `qt.gtimg.cn`）**：

```
GET https://qt.gtimg.cn/q=s_sh000001,s_hkHSI,s_usDJI,...
```

- 复用 `tencent.Source.FetchIndexQuotes`（GBK 文本，`~` 分隔，取名称/点位/涨跌点/涨跌幅）；一次请求返回全部指数。
- 后端 5s 内存缓存合并多窗口/多次事件触发的重复请求；按清单顺序输出并补名称占位。
- 兜底：腾讯整体失败时回退东财 `ulist.np`（`https://push2.eastmoney.com/api/qt/ulist.np/get?secids=...&fields=f2,f3,f4,f12,f13,f14`），仍失败才报错。

**K 线（主源：腾讯 `web.ifzq.gtimg.cn`）**：

```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,240,qfq
```

- 实现见 `internal/datasource/tencent/kline.go` 的 `FetchIndexKline`。`param=代码,周期,起,止,条数,复权`，周期 `day`/`week`/`month`。
- 响应 `data.{代码}.{周期}` 为二维数组，每行 `[日期, 开, 收, 高, 低, 量, ...]`；指数无复权概念，涨跌幅由相邻收盘价推算，成交额腾讯不提供置 0。
- A 股/港股可取完整历史；**美股、北证 50 腾讯仅返回最新一根**（≤1 条），此时自动回退东财 `push2his`：

```
GET https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.NDX&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&end=20500101&lmt=240
Referer: https://quote.eastmoney.com/center/
```

- 切换逻辑（`MarketService.GetIndexKline`）：腾讯 → 不足 2 根则东财 → 仍不足 2 根返回「该指数历史 K 线暂不可用」。东财被拦截期间美股/北证 50 可能短暂不可用，A 股/港股不受影响。
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
