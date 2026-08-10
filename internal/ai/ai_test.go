package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConfigWithDefaults(t *testing.T) {
	cfg := Config{Provider: "ollama", Model: "llama3.2"}.WithDefaults()
	if cfg.BaseURL != "http://localhost:11434/v1" {
		t.Fatalf("ollama default base = %q", cfg.BaseURL)
	}

	cfg = Config{Provider: "openai", BaseURL: "http://localhost:8080/v1"}.WithDefaults()
	if cfg.Model != "gpt-4o-mini" {
		t.Fatalf("openai default model = %q", cfg.Model)
	}

	if err := (Config{Provider: "openai", BaseURL: "http://x/v1", Model: "m"}).Ready(); err == nil {
		t.Fatal("Ready() with missing API key = nil, want error")
	}
	if err := (Config{Provider: "ollama", BaseURL: "http://localhost:11434/v1", Model: "m"}).Ready(); err != nil {
		t.Fatalf("Ready() ollama = %v, want nil", err)
	}
}

func TestChatOpenAICompatible(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("auth = %q", got)
		}
		flusher, _ := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	cfg := Config{
		Provider: "custom",
		APIKey:   "test-key",
		BaseURL:  server.URL,
		Model:    "gpt-test",
	}.WithDefaults()

	var got strings.Builder
	err := Chat(context.Background(), cfg, []Message{
		{Role: "user", Content: "hi"},
	}, func(delta string) { got.WriteString(delta) })
	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if got.String() != "Hello world" {
		t.Fatalf("Chat() output = %q, want %q", got.String(), "Hello world")
	}
}

func TestChatAnthropic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("x-api-key"); got != "test-key" {
			t.Errorf("x-api-key = %q", got)
		}
		flusher, _ := w.(http.Flusher)
		fmt.Fprint(w, "event: content_block_delta\n")
		fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "event: content_block_delta\n")
		fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\" there\"}}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "event: message_stop\n")
		fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	cfg := Config{
		Provider: "anthropic",
		APIKey:   "test-key",
		BaseURL:  server.URL,
		Model:    "claude-test",
	}.WithDefaults()

	var got strings.Builder
	err := Chat(context.Background(), cfg, []Message{
		{Role: "user", Content: "hi"},
	}, func(delta string) { got.WriteString(delta) })
	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if got.String() != "Hello there" {
		t.Fatalf("Chat() output = %q, want %q", got.String(), "Hello there")
	}
}

func TestChatGemini(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models/gemini-2.0-flash:streamGenerateContent" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("key"); got != "test-key" {
			t.Errorf("key = %q", got)
		}
		flusher, _ := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" world\"}]}}]}\n\n")
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	cfg := Config{
		Provider: "gemini",
		APIKey:   "test-key",
		BaseURL:  server.URL,
		Model:    "gemini-2.0-flash",
	}.WithDefaults()

	var got strings.Builder
	err := Chat(context.Background(), cfg, []Message{
		{Role: "system", Content: "You are a SQL assistant."},
		{Role: "user", Content: "hi"},
	}, func(delta string) { got.WriteString(delta) })
	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if got.String() != "Hello world" {
		t.Fatalf("Chat() output = %q, want %q", got.String(), "Hello world")
	}
}

func TestListModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}`)
	}))
	defer server.Close()

	cfg := Config{Provider: "custom", BaseURL: server.URL, Model: "x"}.WithDefaults()
	models, err := ListModels(context.Background(), cfg)
	if err != nil {
		t.Fatalf("ListModels() error = %v", err)
	}
	if len(models) != 2 || models[0] != "gpt-4o" || models[1] != "gpt-4o-mini" {
		t.Fatalf("ListModels() = %#v", models)
	}
}
