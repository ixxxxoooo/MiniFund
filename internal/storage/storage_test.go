package storage

import (
	"path/filepath"
	"testing"

	"minifund/internal/model"
)

// newTestStore 创建临时数据库用于测试。
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := newStoreAt(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("创建测试存储失败: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

func TestFundIndexSearch(t *testing.T) {
	s := newTestStore(t)
	items := []model.FundIndexItem{
		{Code: "000001", Name: "华夏成长混合", Type: "混合型", PinyinAbbr: "HXCZHH", PinyinFull: "HUAXIACHENGZHANGHUNHE"},
		{Code: "110011", Name: "易方达中小盘混合", Type: "混合型", PinyinAbbr: "YFDZXPHH", PinyinFull: "YIFANGDAZHONGXIAOPANHUNHE"},
	}
	if err := s.ReplaceFundIndex(items); err != nil {
		t.Fatalf("写入代码表失败: %v", err)
	}

	// 按代码前缀
	got, err := s.SearchFunds("0000", 10, 0)
	if err != nil || len(got) != 1 || got[0].Code != "000001" {
		t.Fatalf("按代码搜索失败: %v %+v", err, got)
	}
	// 按名称
	got, _ = s.SearchFunds("易方达", 10, 0)
	if len(got) != 1 || got[0].Code != "110011" {
		t.Fatalf("按名称搜索失败: %+v", got)
	}
	// 按拼音首字母（小写输入）
	got, _ = s.SearchFunds("hxcz", 10, 0)
	if len(got) != 1 || got[0].Code != "000001" {
		t.Fatalf("按拼音搜索失败: %+v", got)
	}
}

func TestSearchFundsPage(t *testing.T) {
	s := newTestStore(t)
	items := []model.FundIndexItem{
		{Code: "110011", Name: "易方达中小盘混合", Type: "混合型", PinyinAbbr: "YFDZXPHH", PinyinFull: "YIFANGDA1"},
		{Code: "110022", Name: "易方达消费行业", Type: "股票型", PinyinAbbr: "YFDXFHY", PinyinFull: "YIFANGDA2"},
		{Code: "110033", Name: "易方达蓝筹精选", Type: "混合型", PinyinAbbr: "YFDLCJX", PinyinFull: "YIFANGDA3"},
	}
	if err := s.ReplaceFundIndex(items); err != nil {
		t.Fatalf("写入代码表失败: %v", err)
	}

	// 公司名（基金名前缀）+ 分页：每页 2 条，第 1 页应有 2 条且总数 3
	p1, err := s.SearchFundsPage("易方达", "all", 1, 2)
	if err != nil || p1.Total != 3 || len(p1.Items) != 2 {
		t.Fatalf("分页搜索第 1 页失败: %v total=%d len=%d", err, p1.Total, len(p1.Items))
	}
	// 第 2 页应剩 1 条
	p2, _ := s.SearchFundsPage("易方达", "all", 2, 2)
	if p2.Total != 3 || len(p2.Items) != 1 {
		t.Fatalf("分页搜索第 2 页失败: total=%d len=%d", p2.Total, len(p2.Items))
	}
	// 类型筛选：仅股票型应只剩 1 条（易方达消费行业）
	gp, err := s.SearchFundsPage("易方达", "gp", 1, 10)
	if err != nil || gp.Total != 1 || len(gp.Items) != 1 || gp.Items[0].Code != "110022" {
		t.Fatalf("类型筛选(股票)失败: %v total=%d len=%d", err, gp.Total, len(gp.Items))
	}
	// 类型筛选：混合型应有 2 条
	hh, _ := s.SearchFundsPage("易方达", "hh", 1, 10)
	if hh.Total != 2 {
		t.Fatalf("类型筛选(混合)失败: total=%d", hh.Total)
	}
	// 空关键字返回空集且不报错
	empty, err := s.SearchFundsPage("  ", "all", 1, 2)
	if err != nil || empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatalf("空关键字应返回空集: %v %+v", err, empty)
	}
}

func TestWatchlistAndPosition(t *testing.T) {
	s := newTestStore(t)
	groups, err := s.ListGroups()
	if err != nil || len(groups) != 1 || groups[0].Name != "自选" {
		t.Fatalf("默认分组创建失败: %v %+v", err, groups)
	}
	gid := groups[0].ID

	if err := s.AddItem("000001", gid); err != nil {
		t.Fatalf("添加自选失败: %v", err)
	}
	// 重复添加应被忽略
	_ = s.AddItem("000001", gid)
	items, _ := s.ListItems(gid)
	if len(items) != 1 {
		t.Fatalf("自选条目数量错误: %d", len(items))
	}

	if err := s.UpsertPosition("000001", 1000, 1.5); err != nil {
		t.Fatalf("保存持仓失败: %v", err)
	}
	p, _ := s.GetPosition("000001")
	if p == nil || p.Shares != 1000 || p.CostPrice != 1.5 {
		t.Fatalf("持仓数据错误: %+v", p)
	}

	// 净值确认落库与幂等
	if err := s.SaveDailyProfit("000001", "2026-06-12", 1.6, 0.5, 80); err != nil {
		t.Fatalf("保存当日收益失败: %v", err)
	}
	ok, _ := s.HasDailyProfit("000001", "2026-06-12")
	if !ok {
		t.Fatal("净值确认状态查询错误")
	}
}

func TestMoveItem(t *testing.T) {
	s := newTestStore(t)
	groups, _ := s.ListGroups()
	g1 := groups[0].ID
	g2, err := s.CreateGroup("成长")
	if err != nil {
		t.Fatalf("创建分组失败: %v", err)
	}
	if err := s.AddItem("000001", g1); err != nil {
		t.Fatalf("添加自选失败: %v", err)
	}
	if err := s.MoveItem("000001", g1, g2.ID); err != nil {
		t.Fatalf("移动自选失败: %v", err)
	}
	src, _ := s.ListItems(g1)
	dst, _ := s.ListItems(g2.ID)
	if len(src) != 0 {
		t.Fatalf("源分组应为空: %+v", src)
	}
	if len(dst) != 1 || dst[0].Code != "000001" {
		t.Fatalf("目标分组应含该基金: %+v", dst)
	}
}

func TestListAllItemsAndRemoveFromAll(t *testing.T) {
	s := newTestStore(t)
	groups, _ := s.ListGroups()
	g1 := groups[0].ID
	g2, _ := s.CreateGroup("成长")
	// 同一基金加入两个分组，去重后应只剩一条
	_ = s.AddItem("000001", g1)
	_ = s.AddItem("000001", g2.ID)
	_ = s.AddItem("110011", g2.ID)

	all, err := s.ListAllItems()
	if err != nil || len(all) != 2 {
		t.Fatalf("汇总去重条目数量错误: %v len=%d", err, len(all))
	}

	// 彻底移除应从所有分组删除
	if err := s.RemoveItemFromAll("000001"); err != nil {
		t.Fatalf("彻底移除失败: %v", err)
	}
	all, _ = s.ListAllItems()
	if len(all) != 1 || all[0].Code != "110011" {
		t.Fatalf("彻底移除后汇总错误: %+v", all)
	}
}

func TestReplaceWatchlistData(t *testing.T) {
	s := newTestStore(t)
	// 先写入一些旧数据，导入应整体覆盖
	g0, _ := s.ListGroups()
	_ = s.AddItem("999999", g0[0].ID)
	_ = s.UpsertPosition("999999", 1, 1)

	groups := []model.WatchGroup{{ID: 1, Name: "自选", Sort: 0}, {ID: 2, Name: "美股", Sort: 1}}
	items := []model.WatchItem{
		{Code: "000001", GroupID: 1, Sort: 0, Pinned: true, CreatedAt: 100},
		{Code: "110011", GroupID: 2, Sort: 0, CreatedAt: 200},
	}
	positions := []model.Position{{Code: "000001", Shares: 1000, CostPrice: 1.5, UpdatedAt: 1}}
	profits := []model.DailyProfit{{Code: "000001", Date: "2026-06-12", Nav: 1.6, Growth: 0.5, Profit: 80}}

	if err := s.ReplaceWatchlistData(groups, items, positions, profits); err != nil {
		t.Fatalf("整体替换失败: %v", err)
	}

	gs, _ := s.ListGroups()
	if len(gs) != 2 || gs[1].Name != "美股" {
		t.Fatalf("分组未按 id 恢复: %+v", gs)
	}
	// 旧的 999999 应被清除，新数据存在且分组映射正确
	g1Items, _ := s.ListItems(1)
	if len(g1Items) != 1 || g1Items[0].Code != "000001" || !g1Items[0].Pinned {
		t.Fatalf("分组1条目恢复错误: %+v", g1Items)
	}
	g2Items, _ := s.ListItems(2)
	if len(g2Items) != 1 || g2Items[0].Code != "110011" {
		t.Fatalf("分组2条目恢复错误: %+v", g2Items)
	}
	if p, _ := s.GetPosition("999999"); p != nil {
		t.Fatalf("旧持仓应被清除")
	}
	if p, _ := s.GetPosition("000001"); p == nil || p.Shares != 1000 {
		t.Fatalf("持仓恢复错误: %+v", p)
	}
	raw, _ := s.ListAllRawItems()
	if len(raw) != 2 {
		t.Fatalf("原始条目导出数量错误: %d", len(raw))
	}
	dp, _ := s.ListAllDailyProfits()
	if len(dp) != 1 || dp[0].Profit != 80 {
		t.Fatalf("收益历史恢复错误: %+v", dp)
	}
}

func TestThemeCache(t *testing.T) {
	s := newTestStore(t)
	if err := s.SaveThemeCache("003834", `[{"code":"BK000226","name":"新能源"}]`); err != nil {
		t.Fatalf("写入主题缓存失败: %v", err)
	}
	got, err := s.GetThemeCaches([]string{"003834", "000001"})
	if err != nil || len(got) != 1 {
		t.Fatalf("读取主题缓存失败: %v %+v", err, got)
	}
	if got["003834"].Themes == "" || got["003834"].UpdatedAt == 0 {
		t.Fatalf("主题缓存内容错误: %+v", got["003834"])
	}
}

func TestSettingsKV(t *testing.T) {
	s := newTestStore(t)
	if err := s.SetSetting("app", `{"theme":"dark"}`); err != nil {
		t.Fatalf("写入设置失败: %v", err)
	}
	v, err := s.GetSetting("app")
	if err != nil || v != `{"theme":"dark"}` {
		t.Fatalf("读取设置失败: %v %s", err, v)
	}
	v, _ = s.GetSetting("不存在")
	if v != "" {
		t.Fatalf("不存在的设置应返回空: %s", v)
	}
}
