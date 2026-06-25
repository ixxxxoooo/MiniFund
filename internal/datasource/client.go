// Package datasource 数据源抽象层：所有外部 HTTP 请求只允许发生在本包及其子包中。
// 接口规格与限频策略见 docs/DATA_SOURCES.md。
package datasource

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// 统一的浏览器 UA，所有请求必须携带
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

// sharedTransport 全局共享传输层：开启 keep-alive 长连接池与透明 gzip，
// 大幅降低天天基金多接口（多域名）频繁请求时的 TLS/TCP 握手开销。
// Go 默认在未手动设置 Accept-Encoding 时自动协商并解压 gzip。
var sharedTransport = &http.Transport{
	Proxy:               http.ProxyFromEnvironment,
	ForceAttemptHTTP2:   true,
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 16, // 同一域名（如 fundgz.1234567.com.cn）批量并发时复用连接
	MaxConnsPerHost:     32,
	IdleConnTimeout:     90 * time.Second,
	TLSHandshakeTimeout: 5 * time.Second,
	DisableCompression:  false,
}

// httpClient 全局共享客户端：超时 5s，复用连接池。
var httpClient = &http.Client{Timeout: 5 * time.Second, Transport: sharedTransport}

// longHTTPClient 长响应客户端：超时 15s，用于较慢的网页抓取（如资讯文章页 HTML）。
var longHTTPClient = &http.Client{Timeout: 15 * time.Second, Transport: sharedTransport}

// FetchText 发起 GET 请求并返回响应文本（带 UA 与可选 Referer，失败重试 1 次）。
func FetchText(ctx context.Context, url, referer string) (string, error) {
	return fetchWith(ctx, httpClient, url, referer)
}

// FetchTextLong 与 FetchText 相同，但使用 15s 超时客户端（适合较慢的网页抓取）。
func FetchTextLong(ctx context.Context, url, referer string) (string, error) {
	return fetchWith(ctx, longHTTPClient, url, referer)
}

func fetchWith(ctx context.Context, client *http.Client, url, referer string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		body, err := fetchOnce(ctx, client, url, referer)
		if err == nil {
			return body, nil
		}
		lastErr = err
		// 首次失败后短暂退避再重试：对反爬断连/限频场景，立即重试大概率再次失败，
		// 退避 300ms 给上游喘息窗口，降低被进一步风控的概率。
		if attempt == 0 {
			select {
			case <-time.After(300 * time.Millisecond):
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
	}
	return "", lastErr
}

func fetchOnce(ctx context.Context, client *http.Client, url, referer string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("构造请求失败: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	// 补齐浏览器常见请求头：push2 等行情接口对“裸 UA”的请求会直接关闭连接（返回 EOF），
	// 携带 Accept / Accept-Language 后更接近真实浏览器，显著降低被反爬直接断连的概率。
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("响应状态码异常: %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}
	return string(data), nil
}

// DecodeGBK 将 GBK 编码字节转为 UTF-8 字符串（腾讯/新浪行情接口返回 GBK）。
func DecodeGBK(data []byte) (string, error) {
	out, _, err := transform.Bytes(simplifiedchinese.GBK.NewDecoder(), data)
	if err != nil {
		return "", fmt.Errorf("GBK 解码失败: %w", err)
	}
	return string(out), nil
}

// FetchGBKText 发起 GET 请求并按 GBK 解码响应。
func FetchGBKText(ctx context.Context, url, referer string) (string, error) {
	raw, err := FetchText(ctx, url, referer)
	if err != nil {
		return "", err
	}
	return DecodeGBK([]byte(raw))
}

// jsonpPattern 提取 JSONP 包装中的 JSON 体：callback({...});
var jsonpPattern = regexp.MustCompile(`(?s)^\s*[\w$.]+\s*\((.*)\)\s*;?\s*$`)

// StripJSONP 去掉 JSONP 回调包装，返回内部 JSON 字符串。
// 容错：若响应本就是裸 JSON（无回调包装，以 '{' 开头），直接返回原文本，
// 避免 fundgz 等接口偶发返回裸 JSON 时解析整体失败。
func StripJSONP(body string) (string, error) {
	m := jsonpPattern.FindStringSubmatch(body)
	if m != nil {
		return m[1], nil
	}
	trimmed := strings.TrimSpace(body)
	if strings.HasPrefix(trimmed, "{") {
		return trimmed, nil
	}
	return "", fmt.Errorf("响应不是合法的 JSONP 格式")
}

// ExtractJSVar 从 JS 脚本中提取 `var name = <json>;` 形式的变量值（贪婪到行尾分号）。
func ExtractJSVar(script, name string) (string, bool) {
	re := regexp.MustCompile(`(?s)var\s+` + regexp.QuoteMeta(name) + `\s*=\s*(.*?)\s*;`)
	m := re.FindStringSubmatch(script)
	if m == nil {
		return "", false
	}
	return m[1], true
}
