package services

import (
	"sync"
	"time"
)

// ttlEntry 缓存条目。
type ttlEntry struct {
	value   any
	expires time.Time
}

// ttlCache 简单的并发安全 TTL 内存缓存：
// 用于排行 / 主题 / 板块等"页面可见才请求"的列表数据，配合前端翻页预取实现秒开。
// 仅缓存只读的市场公共数据，不缓存自选/持仓等用户私有数据。
type ttlCache struct {
	mu      sync.Mutex
	entries map[string]ttlEntry
	ttl     time.Duration
}

// newTTLCache 创建 TTL 缓存。
func newTTLCache(ttl time.Duration) *ttlCache {
	return &ttlCache{entries: make(map[string]ttlEntry), ttl: ttl}
}

// get 命中且未过期返回缓存值，否则返回 nil, false。
func (c *ttlCache) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.value, true
}

// set 写入缓存值。
func (c *ttlCache) set(key string, value any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = ttlEntry{value: value, expires: time.Now().Add(c.ttl)}
}
