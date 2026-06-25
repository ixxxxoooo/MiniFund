package services

import (
	"sync"
	"time"
)

// ttlMaxEntries 单个 TTL 缓存的容量上限。缓存 key 空间为半无限（如基金代码、文章 URL、
// 分页参数组合），长期运行后无限增长会内存泄漏。命中上限时淘汰最早过期的一批条目。
const ttlMaxEntries = 256

// ttlSweepInterval 后台清理过期条目的周期。
const ttlSweepInterval = 5 * time.Minute

// ttlEntry 缓存条目。
type ttlEntry struct {
	value   any
	expires time.Time
}

// ttlCache 简单的并发安全 TTL 内存缓存：
// 用于排行 / 主题 / 板块等"页面可见才请求"的列表数据，配合前端翻页预取实现秒开。
// 仅缓存只读的市场公共数据，不缓存自选/持仓等用户私有数据。
//
// 防泄漏：超出 ttlMaxEntries 时淘汰最早过期条目；后台 goroutine 每 ttlSweepInterval
// 清除一次已过期条目，避免 get 时只跳过不删除导致 map 无限增长。
type ttlCache struct {
	mu      sync.Mutex
	entries map[string]ttlEntry
	ttl     time.Duration
	stop    chan struct{}
}

// newTTLCache 创建 TTL 缓存，并启动后台过期清理 goroutine（随 app 同生命周期）。
func newTTLCache(ttl time.Duration) *ttlCache {
	c := &ttlCache{
		entries: make(map[string]ttlEntry),
		ttl:     ttl,
		stop:    make(chan struct{}),
	}
	go c.sweepLoop()
	return c
}

// get 命中且未过期返回缓存值，否则返回 nil, false。
func (c *ttlCache) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expires) {
		// 顺手清除单条过期项，避免反复命中陈旧 key
		if ok {
			delete(c.entries, key)
		}
		return nil, false
	}
	return e.value, true
}

// set 写入缓存值；达到容量上限时淘汰最早过期的一批条目。
func (c *ttlCache) set(key string, value any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// 同 key 覆盖不计新增，先判容量
	if _, exists := c.entries[key]; !exists && len(c.entries) >= ttlMaxEntries {
		c.evictLocked()
	}
	c.entries[key] = ttlEntry{value: value, expires: time.Now().Add(c.ttl)}
}

// evictLocked 删除最早过期的一批条目（约 1/4），为新增腾出空间。调用方需持锁。
func (c *ttlCache) evictLocked() {
	if len(c.entries) == 0 {
		return
	}
	// 找出过期时间最早的若干条目（容量超限通常意味着部分已接近过期）。
	type kv struct {
		k string
		e time.Time
	}
	all := make([]kv, 0, len(c.entries))
	for k, e := range c.entries {
		all = append(all, kv{k: k, e: e.expires})
	}
	// 部分排序：取前 1/4 作为淘汰候选。为简单起见直接全量排序（条目 ≤ 256，开销可忽略）。
	// 按 expires 升序，先删最早过期的。
	// 简易插入排序避免引入 sort 依赖到循环热点（数量小）。
	target := len(all) / 4
	if target < 1 {
		target = 1
	}
	// 选出 expires 最小的 target 个
	for i := 0; i < target && i < len(all); i++ {
		minIdx := i
		for j := i + 1; j < len(all); j++ {
			if all[j].e.Before(all[minIdx].e) {
				minIdx = j
			}
		}
		all[i], all[minIdx] = all[minIdx], all[i]
		delete(c.entries, all[i].k)
	}
}

// sweep 后台清理一次已过期条目。
func (c *ttlCache) sweep() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, e := range c.entries {
		if now.After(e.expires) {
			delete(c.entries, k)
		}
	}
}

// sweepLoop 周期清理过期条目，随进程结束或 stop 关闭时退出。
func (c *ttlCache) sweepLoop() {
	t := time.NewTicker(ttlSweepInterval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			c.sweep()
		case <-c.stop:
			return
		}
	}
}
