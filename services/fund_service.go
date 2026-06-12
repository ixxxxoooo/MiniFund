package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/logger"
	"minifund/internal/model"
	"minifund/internal/storage"
)

// fundIndexMaxAge 基金代码表时效：7 天
const fundIndexMaxAge = 7 * 24 * time.Hour

// detailCacheMaxAge 基金详情缓存时效：24 小时
const detailCacheMaxAge = 24 * time.Hour

// FundService 基金数据服务：搜索、详情、历史净值、排行。
type FundService struct {
	store *storage.Store
}

// NewFundService 创建基金数据服务。
func NewFundService(store *storage.Store) *FundService {
	return &FundService{store: store}
}

// EnsureFundIndex 确保基金代码表存在且未过期（应用启动时后台调用，不暴露给前端）。
func (s *FundService) EnsureFundIndex() {
	updatedAt, err := s.store.FundIndexUpdatedAt()
	if err != nil {
		logger.Warn("查询代码表时效失败: %v", err)
		return
	}
	if updatedAt > 0 && time.Since(time.Unix(updatedAt, 0)) < fundIndexMaxAge {
		return
	}
	logger.Info("基金代码表过期或为空，开始更新...")
	if err := s.RefreshFundIndex(); err != nil {
		logger.Warn("更新基金代码表失败: %v", err)
	}
}

// RefreshFundIndex 手动全量更新基金代码表（设置页调用）。
func (s *FundService) RefreshFundIndex() error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	items, err := eastmoney.FetchFundIndex(ctx)
	if err != nil {
		return fmt.Errorf("拉取基金代码表失败: %w", err)
	}
	if err := s.store.ReplaceFundIndex(items); err != nil {
		return fmt.Errorf("写入基金代码表失败: %w", err)
	}
	logger.Info("基金代码表更新完成: %d 条", len(items))
	return nil
}

// SearchFunds 本地搜索基金（代码/名称/拼音首字母/全拼）。
func (s *FundService) SearchFunds(keyword string, limit int) ([]model.FundIndexItem, error) {
	return s.store.SearchFunds(keyword, limit)
}

// GetFundDetail 获取基金详情（缓存优先，24h 过期后重新抓取）。
func (s *FundService) GetFundDetail(code string) (*model.FundDetail, error) {
	if cached, err := s.store.GetDetailCache(code, detailCacheMaxAge); err == nil && cached != "" {
		var detail model.FundDetail
		if json.Unmarshal([]byte(cached), &detail) == nil {
			return &detail, nil
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	detail, err := eastmoney.FetchFundDetail(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("获取基金详情失败: %w", err)
	}
	if data, err := json.Marshal(detail); err == nil {
		if err := s.store.SaveDetailCache(code, string(data)); err != nil {
			logger.Warn("写入详情缓存失败: code=%s err=%v", code, err)
		}
	}
	return detail, nil
}

// GetNavHistory 获取历史净值（分页）。
func (s *FundService) GetNavHistory(code string, pageIndex, pageSize int) (*model.NavPage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return eastmoney.FetchNavHistory(ctx, code, pageIndex, pageSize)
}

// GetFundRanking 获取基金排行。
func (s *FundService) GetFundRanking(fundType, sortKey string, pageIndex int) (*model.RankPage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return eastmoney.FetchRanking(ctx, fundType, sortKey, pageIndex, 50)
}
