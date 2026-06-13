package eastmoney

import (
	"context"
	"encoding/json"
	"fmt"
	stdhtml "html"
	"regexp"
	"sort"
	"strings"
	"time"

	"golang.org/x/net/html"

	"minifund/internal/datasource"
	"minifund/internal/model"
)

// 全球财经快讯接口：getFastNewsList，fastColumn=102 为「全部/全球 7×24 直播」栏目。
// 对应 https://kuaixun.eastmoney.com/7_24.html，24 小时滚动更新（基金栏目 109 为低频栏目、
// 非交易时段长时间不更新，故改用全部栏目保证「快讯」持续有新内容）。
// 返回 data.fastNewsList，summary 字段即完整短讯正文（含【标题】前缀），无需二次抓取。
const flashNewsAPI = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=%d&req_trace=%d&_=%d"

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
	// 按发布时间倒序（最新在前）。showTime 为 "yyyy-MM-dd HH:mm:ss"，字典序即时间序。
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Time > out[j].Time
	})
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

// 正文中常见的引流广告段，命中（按纯文本）即整段剔除。
var articleNoise = []string{"在东方财富看资讯行情", "东方财富证券一站式开户", "点击查看>>", "（文章来源"}

// adLinkHost 开户/活动引流链接域名，命中则整条链接（含其内图片）一并剔除。
const adLinkHost = "acttg.eastmoney.com"

// FetchArticleContent 抓取东财文章页正文（#ContentBody），保留股票超链接与正文图片，
// 返回经白名单清洗的安全 HTML 片段，用于资讯弹窗渲染（AI 解读由前端去标签后使用）。
func FetchArticleContent(ctx context.Context, articleURL string) (string, error) {
	if articleURL == "" {
		return "", fmt.Errorf("文章地址为空")
	}
	body, err := datasource.FetchTextLong(ctx, articleURL, newsReferer)
	if err != nil {
		return "", fmt.Errorf("抓取文章正文失败: %w", err)
	}
	return parseArticleHTML(body)
}

// parseArticleHTML 从文章页提取 #ContentBody，并按白名单清洗为安全 HTML 片段：
//   - 保留：<p> <br> <a>(仅 http/https 超链接，如个股行情页) <img>(正文图片) <strong> <em>
//   - 剔除：引流广告段、开户引流图与链接、隐藏占位段、<script>/<style> 等非正文元素
//
// 文本与属性值均做 HTML 转义，链接仅放行 http(s)（杜绝 javascript: 等），保证前端可安全渲染。
func parseArticleHTML(body string) (string, error) {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("解析文章 HTML 失败: %w", err)
	}
	node := findElementByID(doc, "ContentBody")
	if node == nil {
		return "", fmt.Errorf("未找到文章正文区域")
	}
	var sb strings.Builder
	renderChildren(node, &sb)
	out := strings.TrimSpace(sb.String())
	if out == "" {
		// 退化处理：无可保留的块级内容时退回纯文本（转义后包一层 <p>）
		if txt := strings.TrimSpace(nodeText(node)); txt != "" {
			out = "<p>" + stdhtml.EscapeString(txt) + "</p>"
		}
	}
	if out == "" {
		return "", fmt.Errorf("文章正文为空")
	}
	return out, nil
}

// renderChildren 依次清洗渲染子节点。
func renderChildren(n *html.Node, sb *strings.Builder) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		renderNode(c, sb)
	}
}

// renderNode 按白名单清洗单个节点并写入 sb。
func renderNode(n *html.Node, sb *strings.Builder) {
	switch n.Type {
	case html.TextNode:
		sb.WriteString(stdhtml.EscapeString(n.Data))
		return
	case html.ElementNode:
		// 继续按标签名处理
	default:
		return // 注释/文档类型节点忽略
	}

	switch n.Data {
	case "script", "style", "noscript", "iframe", "button":
		return
	case "p":
		// 隐藏占位段（display:none）直接跳过
		if strings.Contains(strings.ReplaceAll(getAttr(n, "style"), " ", ""), "display:none") {
			return
		}
		// 引流广告段（按纯文本判断）跳过
		if containsAny(nodeText(n), articleNoise) {
			return
		}
		var inner strings.Builder
		renderChildren(n, &inner)
		if strings.TrimSpace(inner.String()) == "" {
			return // 空段（如广告图被剔除后残留的空 <p>）丢弃
		}
		sb.WriteString("<p>")
		sb.WriteString(inner.String())
		sb.WriteString("</p>")
	case "br":
		sb.WriteString("<br/>")
	case "a":
		href := normalizeURL(getAttr(n, "href"))
		// 开户/活动引流链接：整条剔除（含其内广告图片）
		if href != "" && strings.Contains(href, adLinkHost) {
			return
		}
		var inner strings.Builder
		renderChildren(n, &inner)
		if strings.TrimSpace(inner.String()) == "" {
			return
		}
		if href == "" {
			sb.WriteString(inner.String()) // 无有效链接时仅保留内容
			return
		}
		sb.WriteString(`<a href="`)
		sb.WriteString(stdhtml.EscapeString(href))
		sb.WriteString(`">`)
		sb.WriteString(inner.String())
		sb.WriteString("</a>")
	case "img":
		// 开户引流广告图（带 em_handle_adv_close 类）剔除
		if strings.Contains(getAttr(n, "class"), "em_handle_adv_close") {
			return
		}
		src := normalizeURL(getAttr(n, "src"))
		if src == "" {
			return
		}
		sb.WriteString(`<img src="`)
		sb.WriteString(stdhtml.EscapeString(src))
		sb.WriteString(`" alt=""/>`)
	case "strong", "b":
		renderInlineWrap(n, sb, "strong")
	case "em", "i":
		renderInlineWrap(n, sb, "em")
	default:
		// 其余容器（div/span/center/section 等）解包，仅渲染其子节点
		renderChildren(n, sb)
	}
}

// renderInlineWrap 用指定行内标签包裹子节点内容（内容为空则跳过）。
func renderInlineWrap(n *html.Node, sb *strings.Builder, tag string) {
	var inner strings.Builder
	renderChildren(n, &inner)
	if strings.TrimSpace(inner.String()) == "" {
		return
	}
	sb.WriteString("<" + tag + ">")
	sb.WriteString(inner.String())
	sb.WriteString("</" + tag + ">")
}

// getAttr 读取元素指定属性值（不存在返回空串）。
func getAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

// normalizeURL 规范化链接：协议相对（//）补 https，仅放行 http/https，其余返回空串。
func normalizeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	return ""
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
