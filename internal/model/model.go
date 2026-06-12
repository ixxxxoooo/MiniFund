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
}

// IndexQuote 指数实时行情。
type IndexQuote struct {
	Symbol        string  `json:"symbol"`        // 指数代码（如 sh000001）
	Name          string  `json:"name"`          // 指数名称
	Price         float64 `json:"price"`         // 当前点位
	Change        float64 `json:"change"`        // 涨跌点数
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
	StockCode string  `json:"stockCode"` // 股票代码
	StockName string  `json:"stockName"` // 股票名称
	Percent   float64 `json:"percent"`   // 占净值比例（%）
}

// ManagerInfo 基金经理信息。
type ManagerInfo struct {
	Name     string `json:"name"`     // 姓名
	WorkTime string `json:"workTime"` // 任职时间描述
	Profit   string `json:"profit"`   // 任期回报描述
}

// TrendPoint 净值走势点。
type TrendPoint struct {
	Date   string  `json:"date"`   // 日期（YYYY-MM-DD）
	Value  float64 `json:"value"`  // 净值
	Growth float64 `json:"growth"` // 当日涨跌幅（%），累计净值走势中为 0
}

// FundDetail 基金详情聚合数据。
type FundDetail struct {
	Code           string       `json:"code"`           // 基金代码
	Name           string       `json:"name"`           // 基金名称
	Type           string       `json:"type"`           // 基金类型
	Rate           string       `json:"rate"`           // 实际申购费率（%）
	MinPurchase    string       `json:"minPurchase"`    // 最小申购金额
	NetWorthTrend  []TrendPoint `json:"netWorthTrend"`  // 单位净值走势
	AcWorthTrend   []TrendPoint `json:"acWorthTrend"`   // 累计净值走势
	Holdings       []Holding    `json:"holdings"`       // 前十重仓股
	Managers       []ManagerInfo `json:"managers"`      // 现任基金经理
	FetchedAt      int64        `json:"fetchedAt"`      // 数据抓取时间（Unix 秒）
}

// RankItem 基金排行条目。
type RankItem struct {
	Code        string  `json:"code"`        // 基金代码
	Name        string  `json:"name"`        // 基金名称
	Date        string  `json:"date"`        // 净值日期
	Nav         float64 `json:"nav"`         // 单位净值
	DayGrowth   float64 `json:"dayGrowth"`   // 日涨幅（%）
	WeekGrowth  float64 `json:"weekGrowth"`  // 周涨幅（%）
	MonthGrowth float64 `json:"monthGrowth"` // 月涨幅（%）
	Month3      float64 `json:"month3"`      // 近 3 月涨幅（%）
	Month6      float64 `json:"month6"`      // 近 6 月涨幅（%）
	Year1       float64 `json:"year1"`       // 近 1 年涨幅（%）
	Ytd         float64 `json:"ytd"`         // 今年来涨幅（%）
}

// RankPage 基金排行分页结果。
type RankPage struct {
	Items []RankItem `json:"items"`
	Total int        `json:"total"`
}

// SectorItem 行业/概念板块行情。
type SectorItem struct {
	Code          string  `json:"code"`          // 板块代码
	Name          string  `json:"name"`          // 板块名称
	ChangePercent float64 `json:"changePercent"` // 涨跌幅（%）
	UpCount       int     `json:"upCount"`       // 上涨家数
	DownCount     int     `json:"downCount"`     // 下跌家数
	LeadStock     string  `json:"leadStock"`     // 领涨股名称
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
