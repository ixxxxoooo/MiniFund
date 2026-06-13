// Package ai 大模型解读数据源：兼容 OpenAI 的 chat/completions 协议（DeepSeek / 通义 / Moonshot / OpenAI 等均可）。
// 外部 HTTP 请求只允许出现在 internal/datasource 子包中，故 AI 调用收敛于此。
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// aiClient AI 请求客户端：解读响应较慢，超时放宽到 60s。
var aiClient = &http.Client{Timeout: 60 * time.Second}

// Config 调用配置（来自应用设置）。
type Config struct {
	BaseURL string // 服务地址，如 https://api.deepseek.com/v1
	APIKey  string // 密钥
	Model   string // 模型名，如 deepseek-chat
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	Stream      bool          `json:"stream"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Chat 发起一次对话补全，返回模型回复文本。
func Chat(ctx context.Context, cfg Config, system, user string) (string, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.Model) == "" {
		return "", fmt.Errorf("AI 未配置：请在设置中填写服务地址、密钥与模型")
	}
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/") + "/chat/completions"

	reqBody, err := json.Marshal(chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Temperature: 0.3,
		Stream:      false,
	})
	if err != nil {
		return "", fmt.Errorf("构造 AI 请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("构造 AI 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))

	resp, err := aiClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("AI 请求失败: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("读取 AI 响应失败: %w", err)
	}

	var parsed chatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("解析 AI 响应失败（状态码 %d）: %w", resp.StatusCode, err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("AI 服务返回错误: %s", parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI 服务状态码异常: %d", resp.StatusCode)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("AI 未返回结果")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}
