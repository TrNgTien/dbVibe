import React, { useEffect, useRef } from "react";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { MySQL, PostgreSQL, sql } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { indentUnit, StreamLanguage } from "@codemirror/language";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
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

function createSearchButton(label, title, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-searchButton ${className}`.trim();
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function createSearchPanel(view) {
  let query = getSearchQuery(view.state);
  let replaceVisible = false;

  const dom = document.createElement("div");
  dom.className = "cm-search cm-vscodeSearch";

  const findRow = document.createElement("div");
  findRow.className = "cm-searchRow";
  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-searchRow cm-replaceRow";

  const toggleReplace = createSearchButton("›", "Toggle replace", () => {
    replaceVisible = !replaceVisible;
    dom.classList.toggle("cm-replaceVisible", replaceVisible);
    toggleReplace.textContent = replaceVisible ? "⌄" : "›";
    if (replaceVisible) replaceField.focus();
  }, "cm-toggleReplace");

  const searchField = document.createElement("input");
  searchField.className = "cm-textfield cm-searchField";
  searchField.name = "search";
  searchField.placeholder = "Find";
  searchField.setAttribute("aria-label", "Find");
  searchField.setAttribute("main-field", "true");
  searchField.value = query.search;

  const replaceField = document.createElement("input");
  replaceField.className = "cm-textfield cm-replaceField";
  replaceField.name = "replace";
  replaceField.placeholder = "Replace";
  replaceField.setAttribute("aria-label", "Replace");
  replaceField.value = query.replace;

  const count = document.createElement("span");
  count.className = "cm-searchCount";

  const caseButton = createSearchButton("Aa", "Match case", () => {
    updateQuery({ caseSensitive: !query.caseSensitive });
  }, "cm-searchOption");
  const wordButton = createSearchButton("ab", "Match whole word", () => {
    updateQuery({ wholeWord: !query.wholeWord });
  }, "cm-searchOption cm-wholeWord");
  const regexpButton = createSearchButton(".*", "Use regular expression", () => {
    updateQuery({ regexp: !query.regexp });
  }, "cm-searchOption");
  const previousButton = createSearchButton("↑", "Previous match", () => {
    findPrevious(view);
  });
  const nextButton = createSearchButton("↓", "Next match", () => {
    findNext(view);
  });
  const closeButton = createSearchButton("×", "Close", () => {
    closeSearchPanel(view);
  }, "cm-searchClose");
  const replaceButton = createSearchButton("Replace", "Replace current match", () => {
    replaceNext(view);
  }, "cm-replaceButton");
  const replaceAllButton = createSearchButton("All", "Replace all matches", () => {
    replaceAll(view);
  }, "cm-replaceButton");

  function updateQuery(overrides = {}) {
    const nextQuery = new SearchQuery({
      search: searchField.value,
      replace: replaceField.value,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      ...overrides,
    });
    if (!nextQuery.eq(query)) {
      query = nextQuery;
      view.dispatch({ effects: setSearchQuery.of(nextQuery) });
    }
    updateControls();
  }

  function updateControls() {
    caseButton.classList.toggle("active", query.caseSensitive);
    wordButton.classList.toggle("active", query.wholeWord);
    regexpButton.classList.toggle("active", query.regexp);
    caseButton.setAttribute("aria-pressed", String(query.caseSensitive));
    wordButton.setAttribute("aria-pressed", String(query.wholeWord));
    regexpButton.setAttribute("aria-pressed", String(query.regexp));

    if (!query.valid) {
      count.textContent = query.search ? "Invalid" : "0 of 0";
      return;
    }

    const matches = Array.from(query.getCursor(view.state));
    const selection = view.state.selection.main;
    const currentIndex = matches.findIndex(
      (match) => match.from === selection.from && match.to === selection.to,
    );
    count.textContent = `${currentIndex >= 0 ? currentIndex + 1 : 0} of ${matches.length}`;
  }

  searchField.addEventListener("input", () => updateQuery());
  replaceField.addEventListener("input", () => updateQuery());
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
    }
  });

  findRow.append(
    toggleReplace,
    searchField,
    count,
    caseButton,
    wordButton,
    regexpButton,
    previousButton,
    nextButton,
    closeButton,
  );
  replaceRow.append(replaceField, replaceButton, replaceAllButton);
  dom.append(findRow, replaceRow);
  updateControls();

  return {
    dom,
    top: true,
    update(update) {
      const nextQuery = getSearchQuery(update.state);
      if (!nextQuery.eq(query)) {
        query = nextQuery;
        searchField.value = query.search;
        replaceField.value = query.replace;
      }
      updateControls();
    },
  };
}

export function SqlEditor({
  value,
  onChange,
  detail,
  editorRef,
  fontSize = 14,
  settings = {},
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const showLineNumbers = settings.showLineNumbers ?? true;
  const highlightCurrentLine = settings.highlightCurrentLine ?? true;
  const wordWrap = settings.wordWrap ?? true;
  const tabWidth = settings.tabWidth ?? 4;
  const uppercaseKeywords = settings.uppercaseKeywords ?? false;

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
        : detail?.driver === "mongodb"
          ? json()
        : sql({ dialect });

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          showLineNumbers ? lineNumbers() : [],
          showLineNumbers && highlightCurrentLine
            ? highlightActiveLineGutter()
            : [],
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.tabSize.of(tabWidth),
          indentUnit.of(" ".repeat(tabWidth)),
          languageExtension,
          search({ top: true, createPanel: createSearchPanel }),
          autocompletion({
            activateOnTyping: true,
            override: [
              detail?.driver === "redis" || detail?.driver === "elasticsearch" || detail?.driver === "mongodb"
                ? createBackendCompletionSource(detail)
                : createSqlCompletionSource(detail, { uppercaseKeywords })
            ],
          }),
          keymap.of([
            // Reserve Cmd/Ctrl+Enter (and Shift variant) for run/explain —
            // without this, defaultKeymap's insertBlankLine eats the selection.
            { key: "Mod-Enter", run: () => true },
            { key: "Shift-Mod-Enter", run: () => true },
            ...completionKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          highlightCurrentLine ? highlightActiveLine() : [],
          wordWrap ? EditorView.lineWrapping : [],
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
      getCurrentLine: () => {
        const selection = view.state.selection.main;
        return view.state.doc.lineAt(selection.head).text;
      },
    };

    return () => {
      if (editorRef.current?.focus) editorRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [
    detail,
    editorRef,
    highlightCurrentLine,
    showLineNumbers,
    tabWidth,
    uppercaseKeywords,
    wordWrap,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      className="sqlEditor"
      ref={containerRef}
      style={{ "--editor-font-size": `${fontSize}px` } as React.CSSProperties}
    />
  );
}
