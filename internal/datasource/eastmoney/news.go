package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 全球财经快讯（基金栏目）接口：getFastNewsList，fastColumn=109 为基金快讯。
// 返回 data.fastNewsList，summary 字段即完整短讯正文（含【标题】前缀），无需二次抓取。
const flashNewsAPI = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=109&sortEnd=&pageSize=%d&req_trace=%d&_=%d"

// 基金滚动资讯页：服务端渲染 HTML，资讯指向 finance/fund.eastmoney.com/a/{id}.html 完整文章页。
const rollFundURL = "https://roll.eastmoney.com/fund.html"

const newsReferer = "https://kuaixun.eastmoney.com/"

// rawFlashResponse 快讯接口返回结构。
type rawFlashResponse struct {
	Code string `json:"code"`
	Data struct {
		FastNewsList []struct {
			Code       string   `json:"code"`
			Title      string   `json:"title"`
			Summary    string   `json:"summary"`
			ShowTime   string   `json:"showTime"`
			TitleColor int      `json:"titleColor"`
			StockList  []string `json:"stockList"`
		} `json:"fastNewsList"`
	} `json:"data"`
}

// FetchFlashNews 拉取基金财经快讯（7×24 短讯，最多 pageSize 条，按时间倒序）。
func FetchFlashNews(ctx context.Context, pageSize int) ([]model.NewsFlash, error) {
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	ms := time.Now().UnixMilli()
	url := fmt.Sprintf(flashNewsAPI, pageSize, ms, ms)
	body, err := datasource.FetchText(ctx, url, newsReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取财经快讯失败: %w", err)
	}
	var raw rawFlashResponse
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("解析财经快讯 JSON 失败: %w", err)
	}
	out := make([]model.NewsFlash, 0, len(raw.Data.FastNewsList))
	for _, n := range raw.Data.FastNewsList {
		stocks := n.StockList
		if stocks == nil {
			stocks = []string{}
		}
		out = append(out, model.NewsFlash{
			ID:        n.Code,
			Title:     strings.TrimSpace(n.Title),
			Summary:   strings.TrimSpace(n.Summary),
			Time:      n.ShowTime,
			Important: n.TitleColor != 0,
			Stocks:    stocks,
		})
	}
	return out, nil
}

// rollItemPattern 提取滚动资讯列表中的文章链接：<a href="//finance|fund.eastmoney.com/a/{id}.html">标题</a>。
var rollItemPattern = regexp.MustCompile(
	`<a\s+href="((?:https?:)?//(?:finance|fund)\.eastmoney\.com/a/(\d{15,})\.html)"[^>]*>([^<]{6,})</a>`)

// FetchRollNews 抓取基金滚动资讯列表（完整文章，正文需经 FetchArticleContent 二次抓取）。
func FetchRollNews(ctx context.Context, limit int) ([]model.NewsArticle, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	body, err := datasource.FetchTextLong(ctx, rollFundURL, newsReferer)
	if err != nil {
		return nil, fmt.Errorf("拉取基金资讯列表失败: %w", err)
	}
	matches := rollItemPattern.FindAllStringSubmatch(body, -1)
	out := make([]model.NewsArticle, 0, limit)
	seen := make(map[string]bool)
	for _, m := range matches {
		url, id, title := m[1], m[2], strings.TrimSpace(m[3])
		if seen[id] || title == "" {
			continue
		}
		seen[id] = true
		if !strings.HasPrefix(url, "http") {
			url = "https:" + url
		}
		out = append(out, model.NewsArticle{
			ID:    id,
			Title: title,
			URL:   url,
			Time:  timeFromArticleID(id),
		})
		if len(out) >= limit {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("未解析到基金资讯（页面结构可能已变化）")
	}
	return out, nil
}

// timeFromArticleID 由文章编号前 8 位（yyyyMMdd）推导发布日期。
func timeFromArticleID(id string) string {
	if len(id) >= 8 {
		return fmt.Sprintf("%s-%s-%s", id[0:4], id[4:6], id[6:8])
	}
	return ""
}

// 正文首段常见的引流广告，抓取后剔除。
var articleNoise = []string{"在东方财富看资讯行情", "东方财富证券一站式开户", "点击查看>>", "（文章来源"}

// FetchArticleContent 抓取东财文章页正文（#ContentBody 内 <p> 文本），用于资讯弹窗与 AI 解读。
func FetchArticleContent(ctx context.Context, articleURL string) (string, error) {
	if articleURL == "" {
		return "", fmt.Errorf("文章地址为空")
	}
	body, err := datasource.FetchTextLong(ctx, articleURL, newsReferer)
	if err != nil {
		return "", fmt.Errorf("抓取文章正文失败: %w", err)
	}
	return parseArticleContent(body)
}

// parseArticleContent 从文章页 HTML 中提取 #ContentBody 正文文本（剔除引流广告段）。
func parseArticleContent(body string) (string, error) {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("解析文章 HTML 失败: %w", err)
	}
	node := findElementByID(doc, "ContentBody")
	if node == nil {
		return "", fmt.Errorf("未找到文章正文区域")
	}
	var paras []string
	collectParagraphs(node, &paras)
	cleaned := make([]string, 0, len(paras))
	for _, p := range paras {
		p = strings.TrimSpace(p)
		if p == "" || containsAny(p, articleNoise) {
			continue
		}
		cleaned = append(cleaned, p)
	}
	text := strings.Join(cleaned, "\n\n")
	if strings.TrimSpace(text) == "" {
		// 退化处理：正文无 <p> 时直接取整块文本
		text = strings.TrimSpace(nodeText(node))
	}
	if text == "" {
		return "", fmt.Errorf("文章正文为空")
	}
	return text, nil
}

// findElementByID 深度优先查找带指定 id 属性的元素节点。
func findElementByID(n *html.Node, id string) *html.Node {
	if n.Type == html.ElementNode {
		for _, a := range n.Attr {
			if a.Key == "id" && a.Val == id {
				return n
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findElementByID(c, id); found != nil {
			return found
		}
	}
	return nil
}

// collectParagraphs 收集节点下所有 <p> 的纯文本。
func collectParagraphs(n *html.Node, out *[]string) {
	if n.Type == html.ElementNode && n.Data == "p" {
		*out = append(*out, nodeText(n))
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		collectParagraphs(c, out)
	}
}

// nodeText 提取节点及其子孙的拼接文本。
func nodeText(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			sb.WriteString(node.Data)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.TrimSpace(sb.String())
}

func containsAny(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
