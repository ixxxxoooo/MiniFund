package datasource

import (
	"context"
	"sync"
	"time"

	"minifund/internal/logger"
	"minifund/internal/model"
)

// IndexQuoteSource 指数行情数据源接口。
type IndexQuoteSource interface {
	FetchIndexQuotes(ctx context.Context, symbols []string) ([]model.IndexQuote, error)
	Name() string
}

// DegradeListener 降级状态变化回调（source 为当前生效数据源名，degraded 表示主源是否失效）。
type DegradeListener func(source string, degraded bool)

// FallbackIndexSource 主备降级组合器：主源失败自动切备源，主源恢复后切回。
// 连续失败进入退避（30s → 60s → 120s 内不再尝试主源）。
type FallbackIndexSource struct {
	primary   IndexQuoteSource
	secondary IndexQuoteSource
	listener  DegradeListener

	mu            sync.Mutex
	primaryFails  int       // 主源连续失败次数
	primaryRetry  time.Time // 主源下次允许尝试时间
	degradedState bool      // 当前是否处于降级状态
}

// NewFallbackIndexSource 创建主备降级组合器。
func NewFallbackIndexSource(primary, secondary IndexQuoteSource, listener DegradeListener) *FallbackIndexSource {
	return &FallbackIndexSource{primary: primary, secondary: secondary, listener: listener}
}

// FetchIndexQuotes 拉取指数行情：优先主源，失败退避后走备源。
func (f *FallbackIndexSource) FetchIndexQuotes(ctx context.Context, symbols []string) ([]model.IndexQuote, error) {
	f.mu.Lock()
	canTryPrimary := time.Now().After(f.primaryRetry)
	f.mu.Unlock()

	if canTryPrimary {
		quotes, err := f.primary.FetchIndexQuotes(ctx, symbols)
		if err == nil {
			f.markPrimary(true)
			return quotes, nil
		}
		logger.Warn("指数主源 %s 拉取失败: %v", f.primary.Name(), err)
		f.markPrimary(false)
	}

	quotes, err := f.secondary.FetchIndexQuotes(ctx, symbols)
	if err != nil {
		logger.Warn("指数备源 %s 拉取失败: %v", f.secondary.Name(), err)
		return nil, err
	}
	return quotes, nil
}

// Name 数据源名称（实现 IndexQuoteSource 接口）。
func (f *FallbackIndexSource) Name() string {
	return f.primary.Name() + "/" + f.secondary.Name()
}

// markPrimary 更新主源健康状态并按需通知降级状态变化。
func (f *FallbackIndexSource) markPrimary(ok bool) {
	f.mu.Lock()
	var changed bool
	if ok {
		f.primaryFails = 0
		f.primaryRetry = time.Time{}
		if f.degradedState {
			f.degradedState = false
			changed = true
		}
	} else {
		f.primaryFails++
		// 退避：30s → 60s → 120s 封顶。查表写法语义清晰，避免 Duration 左移在改基数时溢出的隐患。
		backoffs := []time.Duration{30 * time.Second, 60 * time.Second, 120 * time.Second}
		idx := f.primaryFails - 1
		if idx > 2 {
			idx = 2
		}
		f.primaryRetry = time.Now().Add(backoffs[idx])
		if !f.degradedState {
			f.degradedState = true
			changed = true
		}
	}
	state := f.degradedState
	listener := f.listener
	f.mu.Unlock()

	if changed && listener != nil {
		source := f.primary.Name()
		if state {
			source = f.secondary.Name()
		}
		listener(source, state)
	}
}
