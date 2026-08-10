package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Message is a single turn in an AI chat conversation.
type Message struct {
	Role    string `json:"role"` // system | user | assistant
	Content string `json:"content"`
}

// Config holds the connection details for an AI provider.
type Config struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
}

// Provider describes a supported AI provider and its defaults.
type Provider struct {
	ID           string
	Label        string
	DefaultBase  string
	DefaultModel string
	RequiresKey  bool
	Anthropic    bool // uses the Anthropic Messages API instead of OpenAI-compatible
	Gemini       bool // uses the Google Gemini streaming API instead of OpenAI-compatible
}

var Providers = []Provider{
	{ID: "openai", Label: "OpenAI", DefaultBase: "https://api.openai.com/v1", DefaultModel: "gpt-4o-mini", RequiresKey: true},
	{ID: "anthropic", Label: "Anthropic", DefaultBase: "https://api.anthropic.com", DefaultModel: "claude-sonnet-4-5", RequiresKey: true, Anthropic: true},
	{ID: "gemini", Label: "Google Gemini", DefaultBase: "https://generativelanguage.googleapis.com/v1beta", DefaultModel: "gemini-2.0-flash", RequiresKey: true, Gemini: true},
	{ID: "deepseek", Label: "DeepSeek", DefaultBase: "https://api.deepseek.com/v1", DefaultModel: "deepseek-chat", RequiresKey: true},
	{ID: "openrouter", Label: "OpenRouter", DefaultBase: "https://openrouter.ai/api/v1", DefaultModel: "deepseek/deepseek-chat", RequiresKey: true},
	{ID: "groq", Label: "Groq", DefaultBase: "https://api.groq.com/openai/v1", DefaultModel: "llama-3.3-70b-versatile", RequiresKey: true},
	{ID: "mistral", Label: "Mistral", DefaultBase: "https://api.mistral.ai/v1", DefaultModel: "mistral-large-latest", RequiresKey: true},
	{ID: "xai", Label: "xAI (Grok)", DefaultBase: "https://api.x.ai/v1", DefaultModel: "grok-3-mini", RequiresKey: true},
	{ID: "ollama", Label: "Ollama (local)", DefaultBase: "http://localhost:11434/v1", DefaultModel: "llama3.2"},
	{ID: "custom", Label: "Custom (OpenAI-compatible)", DefaultBase: "http://localhost:8080/v1"},
}

func ProviderByID(id string) (Provider, bool) {
	for _, p := range Providers {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

// WithDefaults fills empty fields from the provider defaults.
func (c Config) WithDefaults() Config {
	if p, ok := ProviderByID(c.Provider); ok {
		if strings.TrimSpace(c.BaseURL) == "" {
			c.BaseURL = p.DefaultBase
		}
		if strings.TrimSpace(c.Model) == "" {
			c.Model = p.DefaultModel
		}
	}
	return c
}

// Ready reports whether the config is usable for chat.
func (c Config) Ready() error {
	c = c.WithDefaults()
	if strings.TrimSpace(c.Model) == "" {
		return errors.New("AI model is not configured")
	}
	if p, ok := ProviderByID(c.Provider); ok && p.RequiresKey && strings.TrimSpace(c.APIKey) == "" {
		return fmt.Errorf("an API key is required for %s", p.Label)
	}
	return nil
}

// StreamFunc receives incremental text deltas.
type StreamFunc func(delta string)

func client() *http.Client {
	return &http.Client{Timeout: 5 * time.Minute}
}

// Chat streams a completion for the given messages, calling onDelta as text arrives.
func Chat(ctx context.Context, cfg Config, messages []Message, onDelta StreamFunc) error {
	cfg = cfg.WithDefaults()
	if err := cfg.Ready(); err != nil {
		return err
	}
	if len(messages) == 0 {
		return errors.New("no messages to send")
	}
	provider, _ := ProviderByID(cfg.Provider)
	if provider.Anthropic {
		return chatAnthropic(ctx, cfg, messages, onDelta)
	}
	if provider.Gemini {
		return chatGemini(ctx, cfg, messages, onDelta)
	}
	return chatOpenAICompatible(ctx, cfg, messages, onDelta)
}

// ListModels returns the models available from the configured provider.
func ListModels(ctx context.Context, cfg Config) ([]string, error) {
	cfg = cfg.WithDefaults()
	provider, ok := ProviderByID(cfg.Provider)
	if !ok {
		return nil, fmt.Errorf("unsupported AI provider %q", cfg.Provider)
	}
	if provider.Anthropic {
		return listAnthropicModels(ctx, cfg)
	}
	if provider.Gemini {
		return listGeminiModels(ctx, cfg)
	}
	if provider.ID == "ollama" {
		return listOllamaModels(ctx, cfg)
	}
	return listOpenAICompatibleModels(ctx, cfg)
}

func doRequest(ctx context.Context, method, url string, body io.Reader, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("AI request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("AI provider returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return resp, nil
}

func readSSE(ctx context.Context, r io.Reader, handle func(data string) (bool, error)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		done, err := handle(data)
		if err != nil {
			return err
		}
		if done {
			return nil
		}
	}
	return scanner.Err()
}

// chatOpenAICompatible targets the standard /chat/completions streaming API used
// by OpenAI, Ollama, and most local/self-hosted OpenAI-compatible gateways.
func chatOpenAICompatible(ctx context.Context, cfg Config, messages []Message, onDelta StreamFunc) error {
	payload, err := json.Marshal(map[string]any{
		"model":    cfg.Model,
		"messages": messages,
		"stream":   true,
	})
	if err != nil {
		return fmt.Errorf("marshal chat request: %w", err)
	}
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	if cfg.APIKey != "" {
		headers["Authorization"] = "Bearer " + cfg.APIKey
	}
	resp, err := doRequest(ctx, http.MethodPost, strings.TrimRight(cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(payload), headers)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return readSSE(ctx, resp.Body, func(data string) (bool, error) {
		if data == "[DONE]" {
			return true, nil
		}
		var payload struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			return false, nil
		}
		if len(payload.Choices) > 0 {
			if delta := payload.Choices[0].Delta.Content; delta != "" {
				onDelta(delta)
			}
			if payload.Choices[0].FinishReason != "" {
				return true, nil
			}
		}
		return false, nil
	})
}

func chatAnthropic(ctx context.Context, cfg Config, messages []Message, onDelta StreamFunc) error {
	payload, err := json.Marshal(map[string]any{
		"model":      cfg.Model,
		"max_tokens": 4096,
		"messages":   messages,
		"stream":     true,
	})
	if err != nil {
		return fmt.Errorf("marshal chat request: %w", err)
	}
	headers := map[string]string{
		"Content-Type":      "application/json",
		"x-api-key":         cfg.APIKey,
		"anthropic-version": "2023-06-01",
	}
	resp, err := doRequest(ctx, http.MethodPost, strings.TrimRight(cfg.BaseURL, "/")+"/v1/messages", bytes.NewReader(payload), headers)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return readSSE(ctx, resp.Body, func(data string) (bool, error) {
		var payload struct {
			Type  string `json:"type"`
			Delta *struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			return false, nil
		}
		switch payload.Type {
		case "message_stop":
			return true, nil
		case "content_block_delta":
			if payload.Delta != nil && payload.Delta.Text != "" {
				onDelta(payload.Delta.Text)
			}
		}
		return false, nil
	})
}

func chatGemini(ctx context.Context, cfg Config, messages []Message, onDelta StreamFunc) error {
	payload, err := geminiRequest(messages)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(cfg.BaseURL, "/") +
		"/models/" + url.PathEscape(cfg.Model) +
		":streamGenerateContent?alt=sse&key=" + url.QueryEscape(cfg.APIKey)
	headers := map[string]string{"Content-Type": "application/json"}
	resp, err := doRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload), headers)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return readSSE(ctx, resp.Body, func(data string) (bool, error) {
		if data == "[DONE]" {
			return true, nil
		}
		var payload struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			return false, nil
		}
		if len(payload.Candidates) > 0 {
			for _, part := range payload.Candidates[0].Content.Parts {
				if part.Text != "" {
					onDelta(part.Text)
				}
			}
		}
		return false, nil
	})
}

// geminiRequest maps chat messages to the Google Gemini generateContent shape.
func geminiRequest(messages []Message) ([]byte, error) {
	var system strings.Builder
	contents := make([]map[string]any, 0, len(messages))
	for _, msg := range messages {
		switch msg.Role {
		case "system":
			if system.Len() > 0 {
				system.WriteString("\n")
			}
			system.WriteString(msg.Content)
		case "assistant":
			contents = append(contents, map[string]any{
				"role":  "model",
				"parts": []map[string]any{{"text": msg.Content}},
			})
		default:
			contents = append(contents, map[string]any{
				"role":  "user",
				"parts": []map[string]any{{"text": msg.Content}},
			})
		}
	}
	payload := map[string]any{"contents": contents}
	if system.Len() > 0 {
		payload["system_instruction"] = map[string]any{
			"parts": []map[string]any{{"text": system.String()}},
		}
	}
	return json.Marshal(payload)
}

func listGeminiModels(ctx context.Context, cfg Config) ([]string, error) {
	endpoint := strings.TrimRight(cfg.BaseURL, "/") + "/models?key=" + url.QueryEscape(cfg.APIKey)
	resp, err := doRequest(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var payload struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(payload.Models))
	for _, model := range payload.Models {
		name := strings.TrimPrefix(strings.TrimSpace(model.Name), "models/")
		if name != "" {
			models = append(models, name)
		}
	}
	return models, nil
}

func listOpenAICompatibleModels(ctx context.Context, cfg Config) ([]string, error) {
	headers := map[string]string{}
	if cfg.APIKey != "" {
		headers["Authorization"] = "Bearer " + cfg.APIKey
	}
	resp, err := doRequest(ctx, http.MethodGet, strings.TrimRight(cfg.BaseURL, "/")+"/models", nil, headers)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(payload.Data))
	for _, model := range payload.Data {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, model.ID)
		}
	}
	return models, nil
}

func listAnthropicModels(ctx context.Context, cfg Config) ([]string, error) {
	headers := map[string]string{
		"x-api-key":         cfg.APIKey,
		"anthropic-version": "2023-06-01",
	}
	resp, err := doRequest(ctx, http.MethodGet, strings.TrimRight(cfg.BaseURL, "/")+"/v1/models", nil, headers)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(payload.Data))
	for _, model := range payload.Data {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, model.ID)
		}
	}
	return models, nil
}

func listOllamaModels(ctx context.Context, cfg Config) ([]string, error) {
	base := strings.TrimRight(cfg.BaseURL, "/")
	endpoints := []string{base + "/models", base + "/api/tags"}
	if strings.HasSuffix(base, "/v1") {
		endpoints = append(endpoints, strings.TrimSuffix(base, "/v1")+"/api/tags")
	}
	var lastErr error
	for _, endpoint := range endpoints {
		models, err := ollamaModelsFrom(ctx, endpoint, cfg.APIKey)
		if err == nil {
			return models, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("no Ollama model endpoint responded: %w", lastErr)
}

func ollamaModelsFrom(ctx context.Context, endpoint, apiKey string) ([]string, error) {
	headers := map[string]string{}
	if apiKey != "" {
		headers["Authorization"] = "Bearer " + apiKey
	}
	resp, err := doRequest(ctx, http.MethodGet, endpoint, nil, headers)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var models []string
	if strings.HasSuffix(endpoint, "/api/tags") {
		var payload struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("decode models response: %w", err)
		}
		for _, model := range payload.Models {
			if strings.TrimSpace(model.Name) != "" {
				models = append(models, model.Name)
			}
		}
		return models, nil
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	for _, model := range payload.Data {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, model.ID)
		}
	}
	return models, nil
}
