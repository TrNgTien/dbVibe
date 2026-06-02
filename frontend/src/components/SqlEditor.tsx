import React, { useEffect, useRef } from "react";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { createBackendCompletionSource, createSqlCompletionSource } from "../utils/completions";

const redisMode = {
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^".*?"|^'.*?'/)) return "string";
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
    const word = stream.match(/^[\w:-]+/);
    if (word) {
      if (stream.pos === word[0].length || stream.string.substring(0, stream.start).trim().length === 0) {
        return "keyword";
      }
      return "variableName";
    }
    stream.next();
    return null;
  }
};

const elasticsearchMode = {
  token(stream, state) {
    if (stream.pos === 0) {
      state.line++;
    }
    if (state.line === 1) {
      if (stream.eatSpace()) return null;
      if (stream.match(/^(GET|POST|PUT|DELETE|HEAD)\b/i)) return "keyword";
      if (stream.match(/^\S+/)) return "string";
      stream.next();
      return null;
    }
    // Simple JSON fallback if json() fails to mix properly
    if (stream.eatSpace()) return null;
    if (stream.match(/^".*?"/)) return "string";
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/^(true|false|null)\b/)) return "keyword";
    if (stream.match(/^[{}[\]:,]/)) return "punctuation";
    stream.next();
    return null;
  },
  startState() { return { line: 0 }; }
};

const redisLanguage = StreamLanguage.define(redisMode);
const elasticsearchLanguage = StreamLanguage.define(elasticsearchMode);

export function SqlEditor({ value, onChange, detail, editorRef, fontSize = 14 }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    if (!containerRef.current) return;

    const dialect = detail?.driver === "mysql" ? MySQL : PostgreSQL;
    const languageExtension = detail?.driver === "redis" 
      ? redisLanguage 
      : detail?.driver === "elasticsearch" 
        ? elasticsearchLanguage 
        : sql({ dialect });

    const theme = EditorView.theme({
      "&": {
        fontSize: `${fontSize}px`
      }
    });

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          theme,
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          languageExtension,
          autocompletion({
            activateOnTyping: true,
            override: [
              detail?.driver === "redis" || detail?.driver === "elasticsearch"
                ? createBackendCompletionSource(detail)
                : createSqlCompletionSource(detail)
            ],
          }),
          keymap.of([
            ...completionKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          highlightActiveLine(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            valueRef.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });

    viewRef.current = view;
    editorRef.current = {
      focus: () => view.focus(),
      getSelection: () => {
        const selection = view.state.selection.main;
        if (!selection.empty) {
          return view.state.sliceDoc(selection.from, selection.to);
        }
        return "";
      },
    };

    return () => {
      if (editorRef.current?.focus) editorRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [detail, editorRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="sqlEditor" ref={containerRef} />;
}