// Package model 定义跨层共享的领域模型（datasource / storage / services 共用）。
package model

// FundIndexItem 基金代码表条目（搜索索引）。
type FundIndexItem struct {
	Code       string `json:"code"`       // 基金代码
	Name       string `json:"name"`       // 基金名称
	Type       string `json:"type"`       // 基金类型（混合型/股票型/QDII/...）
	PinyinAbbr string `json:"pinyinAbbr"` // 拼音首字母
	PinyinFull string `json:"pinyinFull"` // 拼音全拼
}

// FundIndexPage 基金索引搜索分页结果（排行页「就地搜索」用）。
type FundIndexPage struct {
	Items []FundIndexItem `json:"items"`
	Total int             `json:"total"`
}

// FundTheme 基金所属主题/概念（东财 ztjj 体系，TTYPE 形如 BKxxxxxx）。
type FundTheme struct {
	Code string `json:"code"` // 主题/板块代码（BKxxxxxx）
	Name string `json:"name"` // 主题/板块名称（如 CPO、电力设备）
}

// PeriodReturn 基金阶段涨幅（含同类平均与同类排名，来自 FundMNPeriodIncrease）。
type PeriodReturn struct {
	Period string  `json:"period"` // 周期键：Y/3Y/6Y/1N/2N/3N/JN/LN 等
	Value  float64 `json:"value"`  // 本基金涨跌幅（%）
	Avg    float64 `json:"avg"`    // 同类平均（%）
	Rank   int     `json:"rank"`   // 同类排名
	Count  int     `json:"count"`  // 同类数量
}

// NewsFlash 全球财经快讯（7×24 短讯，来自东财 getFastNewsList，summary 即完整正文）。
type NewsFlash struct {
	ID        string   `json:"id"`        // 快讯唯一编号（接口 code 字段）
	Title     string   `json:"title"`     // 标题
	Summary   string   `json:"summary"`   // 正文（短讯本身即完整内容，含【标题】前缀）
	Time      string   `json:"time"`      // 发布时间（yyyy-MM-dd HH:mm:ss）
	Important bool     `json:"important"` // 是否重要（接口 titleColor != 0，通常标红）
	Stocks    []string `json:"stocks"`    // 关联标的代码（如 0.159940）
}

// NewsArticle 基金滚动资讯（来自 roll.eastmoney.com，指向完整文章页，正文需抓取页面）。
type NewsArticle struct {
	ID    string `json:"id"`    // 文章编号（URL 中的数字，前 8 位为 yyyyMMdd）
	Title string `json:"title"` // 标题
	URL   string `json:"url"`   // 文章页地址（finance/fund.eastmoney.com/a/{id}.html）
	Time  string `json:"time"`  // 发布日期（由文章编号推导，yyyy-MM-dd）
}

// FundEstimate 盘中估值。
type FundEstimate struct {
	Code           string  `json:"code"`           // 基金代码
	Name           string  `json:"name"`           // 基金名称
	NavDate        string  `json:"navDate"`        // 上一交易日净值日期
	PrevNav        float64 `json:"prevNav"`        // 上一日单位净值
	Estimate       float64 `json:"estimate"`       // 估算净值
	EstimateGrowth float64 `json:"estimateGrowth"` // 估算涨跌幅（%）
	EstimateTime   string  `json:"estimateTime"`   // 估值时间
	HasEstimate    bool    `json:"hasEstimate"`    // 是否有盘中估值（QDII 等为 false）
	DayGrowth      float64 `json:"dayGrowth"`      // 已公布最新净值的日涨幅（%，与排行 rzdf 同源，盘后/非交易日的「今日涨幅」兜底）
	HasDayGrowth   bool    `json:"hasDayGrowth"`   // 是否取到已公布日涨幅
}

// IndexQuote 指数实时行情。
type IndexQuote struct {
	Symbol        string  `json:"symbol"`        // 指数代码（如 sh000001）
	Name          string  `json:"name"`          // 指数名称
	Price         float64 `json:"price"`         // 当前点位
	Change        float64 `json:"change"`        // 涨跌点数
	ChangePercent float64 `json:"changePercent"` // 涨跌幅（%）
	Amount        float64 `json:"amount"`        // 成交额（本币基础单位：元/港元/美元等；0 表示无数据）
}

// MarketIndexQuote 行情中心指数实时报价（统一用 secid 标识）。
type MarketIndexQuote struct {
	Secid         string  `json:"secid"`         // 东财证券 id（市场.代码，如 1.000001 / 100.NDX）
	Name          string  `json:"name"`          // 指数名称
	Group         string  `json:"group"`         // 分组（A股 / 港股 / 美股 / 韩国）
	Price         float64 `json:"price"`         // 最新点位
	Change        float64 `json:"change"`        // 涨跌点数
	ChangePercent float64 `json:"changePercent"` // 涨跌幅（%）
	Amount        float64 `json:"amount"`        // 成交额（各市场本币基础单位：A股元/港股港元/美股美元/韩国韩元；0 表示无数据，不做汇率换算）
}

// Kline 指数 K 线数据点（来自东财 push2his）。
type Kline struct {
	Date          string  `json:"date"`          // 日期（日/周/月为 yyyy-MM-dd；分钟为 yyyy-MM-dd HH:mm）
	Open          float64 `json:"open"`          // 开盘
	Close         float64 `json:"close"`         // 收盘
	High          float64 `json:"high"`          // 最高
	Low           float64 `json:"low"`           // 最低
	Volume        float64 `json:"volume"`        // 成交量（手）
	Amount        float64 `json:"amount"`        // 成交额（元）
	ChangePercent float64 `json:"changePercent"` // 涨跌幅（%）
}

// NavRecord 历史净值记录。
type NavRecord struct {
	Date   string  `json:"date"`   // 净值日期
	Nav    float64 `json:"nav"`    // 单位净值
	AccNav float64 `json:"accNav"` // 累计净值
	Growth float64 `json:"growth"` // 日增长率（%）
}

// NavPage 历史净值分页结果。
type NavPage struct {
	Items []NavRecord `json:"items"`
	Total int         `json:"total"`
}

// Holding 重仓股。
type Holding struct {
	StockCode     string  `json:"stockCode"`     // 股票代码
	StockName     string  `json:"stockName"`     // 股票名称
	Percent       float64 `json:"percent"`       // 占净值比例（%）
	ChangePercent float64 `json:"changePercent"` // 个股当日涨跌幅（%）
}

// BondHolding 重仓债券（纯债/债券型基金无股票持仓时展示，来自天天基金 f10 债券持仓 zqcc）。
type BondHolding struct {
	BondCode string  `json:"bondCode"` // 债券代码
	BondName string  `json:"bondName"` // 债券名称
	Percent  float64 `json:"percent"`  // 占净值比例（%）
}

// ManagerInfo 基金经理信息（含档案数据，来自 pingzhongdata）。
type ManagerInfo struct {
	ID       string `json:"id"`       // 经理 ID
	Name     string `json:"name"`     // 姓名
	Pic      string `json:"pic"`      // 照片 URL
	Star     int    `json:"star"`     // 星级（0-5）
	WorkTime string `json:"workTime"` // 任职时间描述
	FundSize string `json:"fundSize"` // 管理规模描述（如 532.96亿(23只基金)）
	Profit   string `json:"profit"`   // 任期回报描述
	// 能力评分雷达（经验值/收益率/跟踪误差/超额收益/管理规模）
	PowerAvr        string    `json:"powerAvr"`        // 综合评分
	PowerCategories []string  `json:"powerCategories"` // 维度名称
	PowerData       []float64 `json:"powerData"`       // 各维度评分
	// 任期收益对比（任期收益/同类平均/沪深300）
	ProfitCategories []string  `json:"profitCategories"` // 对比项名称
	ProfitData       []float64 `json:"profitData"`       // 对比项收益（%）
}

// TrendPoint 净值走势点。
type TrendPoint struct {
	Date   string  `json:"date"`   // 日期（YYYY-MM-DD）
	Value  float64 `json:"value"`  // 净值
	Growth float64 `json:"growth"` // 当日涨跌幅（%），累计净值走势中为 0
}

// FundDetail 基金详情聚合数据。
type FundDetail struct {
	Code          string         `json:"code"`          // 基金代码
	Name          string         `json:"name"`          // 基金名称
	Type          string         `json:"type"`          // 基金类型
	Rate          string         `json:"rate"`          // 实际申购费率（%）
	MinPurchase   string         `json:"minPurchase"`   // 最小申购金额
	NetWorthTrend []TrendPoint   `json:"netWorthTrend"` // 单位净值走势
	AcWorthTrend  []TrendPoint   `json:"acWorthTrend"`  // 累计净值走势
	MaxDrawdown   float64        `json:"maxDrawdown"`   // 历史最大回撤（%，由单位净值序列计算，负值如 -23.45）
	PeriodReturns []PeriodReturn `json:"periodReturns"` // 阶段涨幅（近1月/近3月/近6月/近1年/近3年/成立来等）
	Holdings      []Holding      `json:"holdings"`      // 前十重仓股
	BondHoldings  []BondHolding  `json:"bondHoldings"`  // 重仓债券（纯债/债券型基金，股票持仓为空时展示）
	Managers      []ManagerInfo  `json:"managers"`      // 现任基金经理
	FetchedAt     int64          `json:"fetchedAt"`     // 数据抓取时间（Unix 秒）
	// 标签信息（来自移动端详情接口）
	Company   string `json:"company"`   // 基金公司
	IndexName string `json:"indexName"` // 跟踪指数（指数型基金）
	RiskLevel string `json:"riskLevel"` // 风险等级（1-5）
	EstabDate string `json:"estabDate"` // 成立日期
	Scale     string `json:"scale"`     // 最新规模（元，原始字符串）
	// 交易状态（来自移动端详情接口；QDII 常有单日限额）
	SubStatus    string `json:"subStatus"`    // 申购状态（如 开放申购 / 暂停申购）
	RedeemStatus string `json:"redeemStatus"` // 赎回状态
	DayLimit     string `json:"dayLimit"`     // 单日累计申购限额（原始字符串，空表示不限/未知）
}

// TopicItem 基金主题/板块条目（天天基金主题体系）。
type TopicItem struct {
	ID          string  `json:"id"`          // 主题 ID（哈希串）
	Name        string  `json:"name"`        // 主题名称
	Year1Growth float64 `json:"year1Growth"` // 近 1 年涨幅（%）
}

// BreadthBin 涨跌分布档位。Level 为涨跌幅档（-11 ~ 11，负数下跌；±11 为 >10% 即涨/跌停档）。
type BreadthBin struct {
	Level int `json:"level"` // 档位
	Count int `json:"count"` // 家数
}

// MarketBreadth 大盘涨跌分布。
type MarketBreadth struct {
	Date      string       `json:"date"`      // 数据日期（yyyyMMdd）
	UpCount   int          `json:"upCount"`   // 上涨家数
	DownCount int          `json:"downCount"` // 下跌家数
	FlatCount int          `json:"flatCount"` // 平盘家数
	Bins      []BreadthBin `json:"bins"`      // 分布档位（按 level 升序）
}

// ProfitHistoryPoint 组合每日收益历史点（全部持仓基金当日收益之和）。
type ProfitHistoryPoint struct {
	Date   string  `json:"date"`   // 日期 yyyy-MM-dd
	Profit float64 `json:"profit"` // 当日收益（元）
}

// XrayFundRef 持仓透视中某股票的来源基金。
type XrayFundRef struct {
	Code    string  `json:"code"`    // 基金代码
	Name    string  `json:"name"`    // 基金名称
	Percent float64 `json:"percent"` // 该股占基金净值比例（%）
}

// XrayStock 持仓透视聚合后的股票暴露。
type XrayStock struct {
	StockCode string        `json:"stockCode"` // 股票代码
	StockName string        `json:"stockName"` // 股票名称
	Weight    float64       `json:"weight"`    // 占组合权重（%，按持仓市值加权）
	Funds     []XrayFundRef `json:"funds"`     // 来源基金列表
}

// RankItem 基金排行条目。
type RankItem struct {
	Code        string  `json:"code"`        // 基金代码
	Name        string  `json:"name"`        // 基金名称
	Date        string  `json:"date"`        // 净值日期
	Nav         float64 `json:"nav"`         // 单位净值
	AccNav      float64 `json:"accNav"`      // 累计净值
	DayGrowth   float64 `json:"dayGrowth"`   // 日涨幅（%）
	WeekGrowth  float64 `json:"weekGrowth"`  // 周涨幅（%）
	MonthGrowth float64 `json:"monthGrowth"` // 月涨幅（%）
	Month3      float64 `json:"month3"`      // 近 3 月涨幅（%）
	Month6      float64 `json:"month6"`      // 近 6 月涨幅（%）
	Year1       float64 `json:"year1"`       // 近 1 年涨幅（%）
	Year2       float64 `json:"year2"`       // 近 2 年涨幅（%）
	Year3       float64 `json:"year3"`       // 近 3 年涨幅（%）
	Ytd         float64 `json:"ytd"`         // 今年来涨幅（%）
	SinceStart  float64 `json:"sinceStart"`  // 成立来涨幅（%）
	Fee         string  `json:"fee"`         // 申购手续费（原始字符串，含 %，如 0.15%）
	Scale       float64 `json:"scale"`       // 最新规模（元，来自移动端 FundMNFInfo 的 ENDNAV）
}

// RankPage 基金排行分页结果。
type RankPage struct {
	Items []RankItem `json:"items"`
	Total int        `json:"total"`
}

// FundPerf 基金阶段收益（用于搜索结果行内异步补全展示）。
// 今日来自 fundgz 估算涨跌（gszzl），单位净值/净值日期同样取自 fundgz；
// 其余周期均来自移动端 FundMNPeriodIncrease（同一接口，无需额外请求）。
type FundPerf struct {
	Code        string  `json:"code"`        // 基金代码
	Nav         float64 `json:"nav"`         // 单位净值（fundgz dwjz）
	NavDate     string  `json:"navDate"`     // 净值日期（fundgz jzrq）
	DayGrowth   float64 `json:"dayGrowth"`   // 今日（估算涨跌，%）
	WeekGrowth  float64 `json:"weekGrowth"`  // 近1周（%）
	MonthGrowth float64 `json:"monthGrowth"` // 近1月（%）
	Month3      float64 `json:"month3"`      // 近3月（%）
	Month6      float64 `json:"month6"`      // 近6月（%）
	Year1       float64 `json:"year1"`       // 近1年（%）
	Year2       float64 `json:"year2"`       // 近2年（%）
	Year3       float64 `json:"year3"`       // 近3年（%）
	Ytd         float64 `json:"ytd"`         // 今年来（%）
	SinceStart  float64 `json:"sinceStart"`  // 成立来（%）
	HasNav      bool    `json:"hasNav"`      // 是否取到单位净值
	HasDay      bool    `json:"hasDay"`      // 是否取到今日估算
	HasPeriod   bool    `json:"hasPeriod"`   // 是否取到周期收益
}

// SectorItem 行业/概念板块行情。
type SectorItem struct {
	Code          string  `json:"code"`          // 板块代码
	Name          string  `json:"name"`          // 板块名称
	ChangePercent float64 `json:"changePercent"` // 今日涨跌幅（%，f3）
	Week          float64 `json:"week"`          // 近1周涨跌幅（%，ztjj st=W）
	Month         float64 `json:"month"`         // 近1月涨跌幅（%，ztjj st=M）
	Month3        float64 `json:"month3"`        // 近3月涨跌幅（%，f24=60日）
	Ytd           float64 `json:"ytd"`           // 今年来涨跌幅（%，f25=年初至今）
	UpCount       int     `json:"upCount"`       // 上涨家数
	DownCount     int     `json:"downCount"`     // 下跌家数
	LeadStock     string  `json:"leadStock"`     // 领涨股名称
	Inflow        float64 `json:"inflow"`        // 主力资金净流入（元，f62）
	Kind          string  `json:"kind"`          // 板块类别：industry / concept
}

// ThemeDetail 主题（板块）自身各周期涨幅与同类排名（来自东财 ztjj GetBKDetailInfoNew）。
// 用于主题相关基金页顶部展示该主题近期表现。日涨幅无排名；其余周期含「排名/同类总数」。
type ThemeDetail struct {
	Code        string  `json:"code"`        // 主题代码（BK000xxx）
	Name        string  `json:"name"`        // 主题名称
	Day         float64 `json:"day"`         // 日涨幅（%）
	Week        float64 `json:"week"`        // 近1周涨幅（%）
	Month       float64 `json:"month"`       // 近1月涨幅（%）
	Month3      float64 `json:"month3"`      // 近3月涨幅（%）
	Year1       float64 `json:"year1"`       // 近1年涨幅（%）
	Ytd         float64 `json:"ytd"`         // 今年来涨幅（%）
	WeekRank    int     `json:"weekRank"`    // 近1周同类排名
	MonthRank   int     `json:"monthRank"`   // 近1月同类排名
	Month3Rank  int     `json:"month3Rank"`  // 近3月同类排名
	Year1Rank   int     `json:"year1Rank"`   // 近1年同类排名
	YtdRank     int     `json:"ytdRank"`     // 今年来同类排名
	WeekCount   int     `json:"weekCount"`   // 近1周同类总数
	MonthCount  int     `json:"monthCount"`  // 近1月同类总数
	Month3Count int     `json:"month3Count"` // 近3月同类总数
	Year1Count  int     `json:"year1Count"`  // 近1年同类总数
	YtdCount    int     `json:"ytdCount"`    // 今年来同类总数
}

// WatchGroup 自选分组。
type WatchGroup struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Sort int    `json:"sort"`
}

// WatchItem 自选条目。
type WatchItem struct {
	Code      string `json:"code"`
	GroupID   int64  `json:"groupId"`
	Sort      int    `json:"sort"`
	Pinned    bool   `json:"pinned"`
	CreatedAt int64  `json:"createdAt"`
	// Name/Type 来自 fund_index 联查，便于前端直接展示
	Name string `json:"name"`
	Type string `json:"type"`
}

// Position 持仓记录（v1 每基金一条）。
type Position struct {
	Code      string  `json:"code"`
	Shares    float64 `json:"shares"`    // 持有份额
	CostPrice float64 `json:"costPrice"` // 持仓成本价
	UpdatedAt int64   `json:"updatedAt"`
}

// DailyProfit 每日收益落库记录（净值确认后写入，供收益日历与数据备份）。
type DailyProfit struct {
	Code   string  `json:"code"`   // 基金代码
	Date   string  `json:"date"`   // 日期 yyyy-MM-dd
	Nav    float64 `json:"nav"`    // 当日单位净值
	Growth float64 `json:"growth"` // 当日日涨幅（%）
	Profit float64 `json:"profit"` // 当日收益（元）
}

// PortfolioSummary 持仓盈亏汇总。
type PortfolioSummary struct {
	MarketValue   float64 `json:"marketValue"`   // 总市值（盘中按估算净值计算）
	TodayProfit   float64 `json:"todayProfit"`   // 当日预估收益
	TodayPercent  float64 `json:"todayPercent"`  // 当日预估收益率（%）
	TotalProfit   float64 `json:"totalProfit"`   // 累计收益
	PositionCount int     `json:"positionCount"` // 持仓基金数
}

// MonitorState 监控调度状态（推送给前端展示）。
type MonitorState struct {
	Phase      string `json:"phase"`      // Idle / PreMarket / Trading / Lunch / NavConfirm
	Paused     bool   `json:"paused"`     // 是否被用户暂停
	NextChange string `json:"nextChange"` // 下一次状态切换时间描述
}

// NavConfirmed 当日净值确认事件载荷。
type NavConfirmed struct {
	Code   string  `json:"code"`
	Date   string  `json:"date"`
	Nav    float64 `json:"nav"`
	Growth float64 `json:"growth"`
	Profit float64 `json:"profit"` // 当日真实收益（有持仓时）
}
