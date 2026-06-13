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

// TestParseArticleHTML 校验文章正文清洗：保留股票超链接与正文图片，剔除引流广告段与开户引流图。
func TestParseArticleHTML(t *testing.T) {
	htmlDoc := `<html><body>
		<div id="ContentBody">
			<p style="display:none;height:1px;"><br/></p>
			<p>　　在东方财富看资讯行情，选东方财富证券一站式开户交易&gt;&gt;</p>
			<p>　　多股异动，<span id="stock_1.688668"><a target="_blank" href="http://quote.eastmoney.com/unify/r/1.688668" class="keytip" data-code="1,688668">鼎通科技</a></span>快速拉升。</p>
			<center><img src="https://np-newspic.dfcfw.com/download/x.jpg" width="580" /></center>
			<p style="text-align:center;"><a href="https://acttg.eastmoney.com/pub/x"><img src="https://np-newspic.dfcfw.com/download/ad.jpg" class="em_handle_adv_close" /></a></p>
			<p class="em_media">（文章来源：财联社）</p>
		</div>
	</body></html>`
	out, err := parseArticleHTML(htmlDoc)
	if err != nil {
		t.Fatalf("解析正文失败: %v", err)
	}
	// 保留股票超链接（href 与链接文本）
	if !strings.Contains(out, `href="http://quote.eastmoney.com/unify/r/1.688668"`) || !strings.Contains(out, "鼎通科技") {
		t.Errorf("股票超链接未保留: %q", out)
	}
	// 保留正文图片
	if !strings.Contains(out, `<img src="https://np-newspic.dfcfw.com/download/x.jpg"`) {
		t.Errorf("正文图片未保留: %q", out)
	}
	// 剔除引流广告段
	if strings.Contains(out, "一站式开户") || strings.Contains(out, "文章来源") {
		t.Errorf("未剔除引流广告段: %q", out)
	}
	// 剔除开户引流广告图与其链接
	if strings.Contains(out, "acttg.eastmoney.com") || strings.Contains(out, "ad.jpg") {
		t.Errorf("未剔除开户引流广告: %q", out)
	}
}

// TestParseArticleHTMLMissing 无正文区域时应返回错误。
func TestParseArticleHTMLMissing(t *testing.T) {
	if _, err := parseArticleHTML(`<html><body><div>无正文</div></body></html>`); err == nil {
		t.Error("缺少 #ContentBody 时期望返回错误")
	}
}
