// Package datasource 数据源抽象层：所有外部 HTTP 请求只允许发生在本包及其子包中。
// 接口规格与限频策略见 docs/DATA_SOURCES.md。
package datasource

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// 统一的浏览器 UA，所有请求必须携带
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

// httpClient 全局共享客户端：超时 5s。
var httpClient = &http.Client{Timeout: 5 * time.Second}

// FetchText 发起 GET 请求并返回响应文本（带 UA 与可选 Referer，失败重试 1 次）。
func FetchText(ctx context.Context, url, referer string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		body, err := fetchOnce(ctx, url, referer)
		if err == nil {
			return body, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func fetchOnce(ctx context.Context, url, referer string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("构造请求失败: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := httpClient.Do(req)
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
func StripJSONP(body string) (string, error) {
	m := jsonpPattern.FindStringSubmatch(body)
	if m == nil {
		return "", fmt.Errorf("响应不是合法的 JSONP 格式")
	}
	return m[1], nil
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
