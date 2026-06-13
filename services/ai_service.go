package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"minifund/internal/datasource/ai"
	"minifund/internal/logger"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AI 流式解读事件名（与前端 lib/wails/events.ts 保持一致）。
const (
	EventAIChunk = "ai:chunk" // 累计全文：{ id, text }
	EventAIDone  = "ai:done"  // 解读完成：{ id }
	EventAIError = "ai:error" // 解读失败：{ id, message }
)

// aiStreamFlushInterval 流式推送节流间隔：每个增量都重发「累计全文」，
// 但节流到该间隔，避免逐字模型产生过多事件；收尾必定补发一次完整文本。
const aiStreamFlushInterval = 60 * time.Millisecond

// AI 解读统一系统提示词：要求 Markdown 结构化输出，便于前端渲染。
const aiInterpretSystemPrompt = "你是专业的财经分析助手。请用简洁的中文、以 Markdown 格式解读下面这条财经新闻：" +
	"用加粗小标题分为三部分——**核心信息**、**可能影响**（涉及的市场/行业/相关基金）、**注意要点**，" +
	"每部分使用无序列表（每行以 - 开头）。全文控制在 300 字内，" +
	"结尾另起一行用斜体标注 *仅供参考，不构成投资建议*。"

// AIService AI 解读服务：基于设置中的 OpenAI 兼容配置，对财经新闻做快速解读（支持流式输出）。
type AIService struct {
	settings *SettingsService
	app      *application.App
}

// NewAIService 创建 AI 服务。
func NewAIService(settings *SettingsService) *AIService {
	return &AIService{settings: settings}
}

// SetApp 注入 Wails 应用实例（装配时调用，用于流式解读经事件推送增量）。
func (s *AIService) SetApp(app *application.App) {
	s.app = app
}

// Available 返回 AI 是否已启用且配置完整（前端用于决定是否展示「AI 解读」入口）。
func (s *AIService) Available() (bool, error) {
	enabled, base, key, mdl := s.settings.AIConfig()
	return enabled && strings.TrimSpace(base) != "" && strings.TrimSpace(key) != "" && strings.TrimSpace(mdl) != "", nil
}

// buildPrompt 拼接解读用的用户消息（标题 + 正文）。
func buildPrompt(title, content string) string {
	user := strings.TrimSpace(title)
	if c := strings.TrimSpace(content); c != "" {
		if user != "" {
			user += "\n\n"
		}
		user += c
	}
	return user
}

// InterpretNews 对一条财经新闻（标题 + 正文）进行 AI 解读，返回完整 Markdown 文本（非流式，保留作为兜底）。
func (s *AIService) InterpretNews(title, content string) (string, error) {
	enabled, base, key, mdl := s.settings.AIConfig()
	if !enabled {
		return "", fmt.Errorf("AI 解读未启用：请在设置中开启并填写服务地址、密钥与模型")
	}
	user := buildPrompt(title, content)
	if user == "" {
		return "", fmt.Errorf("新闻内容为空，无法解读")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	return ai.Chat(ctx, ai.Config{BaseURL: base, APIKey: key, Model: mdl}, aiInterpretSystemPrompt, user)
}

// InterpretNewsStream 流式解读：立即返回，随后通过 ai:chunk / ai:done / ai:error 事件向前端推送增量。
// streamID 由前端生成，用于在多窗口/多次请求间区分事件归属。
func (s *AIService) InterpretNewsStream(streamID, title, content string) error {
	enabled, base, key, mdl := s.settings.AIConfig()
	if !enabled {
		return fmt.Errorf("AI 解读未启用：请在设置中开启并填写服务地址、密钥与模型")
	}
	user := buildPrompt(title, content)
	if user == "" {
		return fmt.Errorf("新闻内容为空，无法解读")
	}
	if s.app == nil {
		return fmt.Errorf("AI 流式服务未就绪")
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()

		// 关键修复：Wails 高频事件投递不保证顺序，按「增量片段」拼接会乱序串字。
		// 改为每次推送「累计全文」，前端只取最长文本即可，天然免疫乱序与重复。
		var full strings.Builder
		var lastFlush time.Time
		emitFull := func() {
			s.app.Event.Emit(EventAIChunk, map[string]string{"id": streamID, "text": full.String()})
		}

		err := ai.ChatStream(ctx, ai.Config{BaseURL: base, APIKey: key, Model: mdl}, aiInterpretSystemPrompt, user,
			func(delta string) {
				full.WriteString(delta)
				if now := time.Now(); now.Sub(lastFlush) >= aiStreamFlushInterval {
					lastFlush = now
					emitFull()
				}
			})
		// 无论成功或失败，先补发已累计的完整文本，避免节流吞掉最后一段或保留已生成内容。
		if full.Len() > 0 {
			emitFull()
		}
		if err != nil {
			logger.Warn("AI 流式解读失败: %v", err)
			s.app.Event.Emit(EventAIError, map[string]string{"id": streamID, "message": err.Error()})
			return
		}
		s.app.Event.Emit(EventAIDone, map[string]string{"id": streamID})
	}()
	return nil
}
