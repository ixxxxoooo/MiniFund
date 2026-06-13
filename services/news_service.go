package services

import (
	"context"
	"time"

	"minifund/internal/datasource/eastmoney"
	"minifund/internal/model"
	"minifund/internal/scheduler"
)

const (
	// 滚动资讯列表内存缓存时效（页面可见才请求）。
	rollCacheTTL = 60 * time.Second
	// 文章正文不可变，长缓存避免重复抓取。
	articleCacheTTL = 30 * time.Minute
)

// NewsService 财经资讯服务：快讯（由调度器定时拉取并推送）+ 基金滚动资讯（按需抓取）。
type NewsService struct {
	sched        *scheduler.Scheduler
	rollCache    *ttlCache
	articleCache *ttlCache
}

// NewNewsService 创建资讯服务。
func NewNewsService() *NewsService {
	return &NewsService{
		rollCache:    newTTLCache(rollCacheTTL),
		articleCache: newTTLCache(articleCacheTTL),
	}
}

// SetScheduler 注入调度器（装配时调用，不暴露给前端使用）。
func (s *NewsService) SetScheduler(sched *scheduler.Scheduler) {
	s.sched = sched
}

// GetFlashNews 返回最近一轮快讯缓存（窗口初始化用，后续靠 news:flash 事件推送）。
func (s *NewsService) GetFlashNews() ([]model.NewsFlash, error) {
	if s.sched == nil {
		return []model.NewsFlash{}, nil
	}
	return s.sched.LastFlash(), nil
}

// RefreshFlashNews 立即触发一轮快讯拉取（手动刷新）。
func (s *NewsService) RefreshFlashNews() error {
	if s.sched != nil {
		s.sched.RefreshNewsNow()
	}
	return nil
}

// GetRollNews 拉取基金滚动资讯列表（完整文章，60s 内存缓存）。
func (s *NewsService) GetRollNews() ([]model.NewsArticle, error) {
	if v, ok := s.rollCache.get("roll"); ok {
		return v.([]model.NewsArticle), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	list, err := eastmoney.FetchRollNews(ctx, 50)
	if err != nil {
		return nil, err
	}
	s.rollCache.set("roll", list)
	return list, nil
}

// GetArticleContent 抓取资讯文章正文（弹窗展示与 AI 解读用，按 URL 长缓存）。
func (s *NewsService) GetArticleContent(url string) (string, error) {
	if v, ok := s.articleCache.get(url); ok {
		return v.(string), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	text, err := eastmoney.FetchArticleContent(ctx, url)
	if err != nil {
		return "", err
	}
	s.articleCache.set(url, text)
	return text, nil
}
