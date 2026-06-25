// Package ai 大模型解读数据源：兼容 OpenAI 的 chat/completions 协议（DeepSeek / 通义 / Moonshot / OpenAI 等均可）。
// 外部 HTTP 请求只允许出现在 internal/datasource 子包中，故 AI 调用收敛于此。
package ai

import (
	"bufio"
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

// streamChunk 流式响应的单个 SSE 数据块（OpenAI 兼容 delta 协议）。
type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ChatStream 发起一次流式对话补全，按 SSE 增量回调 onDelta（每次传入新增文本片段）。
// 返回 nil 表示正常读到流结束（data: [DONE]）。
func ChatStream(ctx context.Context, cfg Config, system, user string, onDelta func(string)) error {
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.Model) == "" {
		return fmt.Errorf("AI 未配置：请在设置中填写服务地址、密钥与模型")
	}
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/") + "/chat/completions"

	reqBody, err := json.Marshal(chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Temperature: 0.3,
		Stream:      true,
	})
	if err != nil {
		return fmt.Errorf("构造 AI 请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("构造 AI 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	req.Header.Set("Accept", "text/event-stream")

	resp, err := aiClient.Do(req)
	if err != nil {
		return fmt.Errorf("AI 请求失败: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		// 非 200 时多为 JSON 错误体，读出错误信息便于前端展示。
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		var parsed chatResponse
		if json.Unmarshal(data, &parsed) == nil && parsed.Error != nil && parsed.Error.Message != "" {
			return fmt.Errorf("AI 服务返回错误: %s", parsed.Error.Message)
		}
		return fmt.Errorf("AI 服务状态码异常: %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)
	// SSE 协议：一个事件可跨多行 data:，以空行分隔；同一事件的 data 行需用 "\n" 拼接后再解析。
	// 此前逐行解析对主流实现（每 chunk 单行 data）工作正常，但对严格遵循多行 data 的网关会丢增量。
	var dataBuf strings.Builder
	var done bool
	var streamErr error
	flush := func() {
		payload := dataBuf.String()
		dataBuf.Reset()
		if payload == "" {
			return
		}
		if payload == "[DONE]" {
			done = true
			return
		}
		var chunk streamChunk
		if json.Unmarshal([]byte(payload), &chunk) == nil {
			if chunk.Error != nil && chunk.Error.Message != "" {
				streamErr = fmt.Errorf("AI 服务返回错误: %s", chunk.Error.Message)
				return
			}
			if len(chunk.Choices) > 0 {
				if delta := chunk.Choices[0].Delta.Content; delta != "" {
					onDelta(delta)
				}
			}
		}
	}
	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimSpace(line)
			switch {
			case line == "":
				// 空行：事件边界，触发缓冲的 data 解析。
				flush()
				if done {
					return nil
				}
				if streamErr != nil {
					return streamErr
				}
			case strings.HasPrefix(line, "data:"):
				payload := strings.TrimSpace(line[len("data:"):])
				if dataBuf.Len() > 0 {
					dataBuf.WriteByte('\n')
				}
				dataBuf.WriteString(payload)
			default:
				// 忽略 event:/id:/comment 等非 data 行
			}
		}
		if err != nil {
			// 流结束前若仍有未触发空行的缓冲 data，补一次解析。
			if dataBuf.Len() > 0 {
				flush()
				if done {
					return nil
				}
				if streamErr != nil {
					return streamErr
				}
			}
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("读取 AI 流式响应失败: %w", err)
		}
	}
}
