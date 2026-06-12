package services

// FundIndexItem 基金代码表条目（搜索结果项）。
type FundIndexItem struct {
	Code       string `json:"code"`       // 基金代码
	Name       string `json:"name"`       // 基金名称
	Type       string `json:"type"`       // 基金类型（混合型/股票型/...）
	PinyinAbbr string `json:"pinyinAbbr"` // 拼音首字母
}

// FundService 基金数据服务：搜索、详情、历史净值、排行。
// TODO(M1)：接入 internal/datasource/eastmoney 与 internal/storage 后实现真实逻辑，
// 接口规格见 docs/DATA_SOURCES.md，任务拆解见 docs/ROADMAP.md 里程碑 M1/M2。
type FundService struct{}

// NewFundService 创建基金数据服务。
func NewFundService() *FundService {
	return &FundService{}
}

// SearchFunds 按关键字搜索基金（代码/名称/拼音）。
// TODO(M1)：基于本地 SQLite 基金代码表实现，当前为骨架占位。
func (s *FundService) SearchFunds(keyword string, limit int) ([]FundIndexItem, error) {
	return []FundIndexItem{}, nil
}
