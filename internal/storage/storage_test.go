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
	got, err := s.SearchFunds("0000", 10)
	if err != nil || len(got) != 1 || got[0].Code != "000001" {
		t.Fatalf("按代码搜索失败: %v %+v", err, got)
	}
	// 按名称
	got, _ = s.SearchFunds("易方达", 10)
	if len(got) != 1 || got[0].Code != "110011" {
		t.Fatalf("按名称搜索失败: %+v", got)
	}
	// 按拼音首字母（小写输入）
	got, _ = s.SearchFunds("hxcz", 10)
	if len(got) != 1 || got[0].Code != "000001" {
		t.Fatalf("按拼音搜索失败: %+v", got)
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
