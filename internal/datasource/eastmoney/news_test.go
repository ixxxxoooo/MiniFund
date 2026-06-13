package eastmoney

import (
	"strings"
	"testing"
)

// TestTimeFromArticleID 校验由文章编号前 8 位推导发布日期。
func TestTimeFromArticleID(t *testing.T) {
	cases := map[string]string{
		"202606133770624126": "2026-06-13",
		"20251231999":        "2025-12-31",
		"123":                "",
	}
	for id, want := range cases {
		if got := timeFromArticleID(id); got != want {
			t.Errorf("timeFromArticleID(%q) = %q，期望 %q", id, got, want)
		}
	}
}

// TestRollItemPattern 校验滚动资讯列表正则能正确解析文章链接与标题。
func TestRollItemPattern(t *testing.T) {
	htmlSnippet := `<ul>
		<li><a href="//finance.eastmoney.com/a/202606133770624126.html" target="_blank">百亿基金经理在管产品，又有新动向</a></li>
		<li><a href="https://fund.eastmoney.com/a/202606133770617971.html">公募基金新规为风格漂移戴上紧箍咒</a></li>
		<li><a href="https://www.eastmoney.com/">导航链接</a></li>
	</ul>`
	matches := rollItemPattern.FindAllStringSubmatch(htmlSnippet, -1)
	if len(matches) != 2 {
		t.Fatalf("期望解析 2 条资讯，实际 %d 条", len(matches))
	}
	if matches[0][2] != "202606133770624126" || !strings.Contains(matches[0][3], "百亿基金经理") {
		t.Errorf("第 1 条解析错误: %+v", matches[0])
	}
	if matches[1][2] != "202606133770617971" {
		t.Errorf("第 2 条编号解析错误: %q", matches[1][2])
	}
}

// TestParseArticleContent 校验文章正文提取（取 #ContentBody 内 <p>，剔除引流广告段）。
func TestParseArticleContent(t *testing.T) {
	htmlDoc := `<html><body>
		<div id="ContentBody">
			<p>　　在东方财富看资讯行情，选东方财富证券一站式开户交易&gt;&gt;</p>
			<p>　　6月13日，景顺长城基金公告称，增聘基金经理孟棋。</p>
			<p>　　Wind数据显示，管理规模10.74亿元。</p>
		</div>
	</body></html>`
	text, err := parseArticleContent(htmlDoc)
	if err != nil {
		t.Fatalf("解析正文失败: %v", err)
	}
	if strings.Contains(text, "一站式开户") {
		t.Errorf("未剔除引流广告段: %q", text)
	}
	if !strings.Contains(text, "景顺长城基金") || !strings.Contains(text, "Wind数据") {
		t.Errorf("正文内容缺失: %q", text)
	}
}

// TestParseArticleContentMissing 无正文区域时应返回错误。
func TestParseArticleContentMissing(t *testing.T) {
	if _, err := parseArticleContent(`<html><body><div>无正文</div></body></html>`); err == nil {
		t.Error("缺少 #ContentBody 时期望返回错误")
	}
}
