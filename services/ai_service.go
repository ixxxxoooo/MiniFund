package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"minifund/internal/datasource/ai"
)

// AIService AI 解读服务：基于设置中的 OpenAI 兼容配置，对财经新闻做快速解读。
type AIService struct {
	settings *SettingsService
}

// NewAIService 创建 AI 服务。
func NewAIService(settings *SettingsService) *AIService {
	return &AIService{settings: settings}
}

// Available 返回 AI 是否已启用且配置完整（前端用于决定是否展示「AI 解读」入口）。
func (s *AIService) Available() (bool, error) {
	enabled, base, key, mdl := s.settings.AIConfig()
	return enabled && strings.TrimSpace(base) != "" && strings.TrimSpace(key) != "" && strings.TrimSpace(mdl) != "", nil
}

// InterpretNews 对一条财经新闻（标题 + 正文）进行 AI 解读，返回解读文本。
func (s *AIService) InterpretNews(title, content string) (string, error) {
	enabled, base, key, mdl := s.settings.AIConfig()
	if !enabled {
		return "", fmt.Errorf("AI 解读未启用：请在设置中开启并填写服务地址、密钥与模型")
	}
	system := "你是专业的财经分析助手。请用简洁的中文解读下面这条财经新闻，分点给出：1) 核心信息；2) 可能影响（涉及的市场/行业/相关基金）；3) 投资者需注意的要点。控制在 300 字内，结尾标注「仅供参考，不构成投资建议」。"
	user := strings.TrimSpace(title)
	if c := strings.TrimSpace(content); c != "" {
		user = user + "\n\n" + c
	}
	if user == "" {
		return "", fmt.Errorf("新闻内容为空，无法解读")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	return ai.Chat(ctx, ai.Config{BaseURL: base, APIKey: key, Model: mdl}, system, user)
}
