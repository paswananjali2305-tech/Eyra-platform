import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useEyra } from '../context/EyraContext';
import { normalizeDisplayedCode, presentSuggestedFix } from '../lib/codeText.js';
import { loadWorkspaceSlice, saveWorkspaceSlice } from '../lib/workspaceDraft.js';

const QUICK_ACTIONS = [
  {
    id: 'debug',
    label: 'Debug',
    icon: 'bug_report',
    color: '#9CEDFF',
    prompt: 'Debug this code and explain the root cause.',
  },
  {
    id: 'optimize',
    label: 'Optimize',
    icon: 'bolt',
    color: '#35D6F2',
    prompt: 'Optimize this code for better time and space complexity.',
  },
  {
    id: 'explain',
    label: 'Explain',
    icon: 'menu_book',
    color: '#BBC3FF',
    prompt: 'Explain what this code does step by step.',
  },
  {
    id: 'generate',
    label: 'Generate',
    icon: 'auto_awesome',
    color: '#6CF9BB',
    prompt: 'Generate an improved version of this code with tests in mind.',
  },
];

// Cache-bust so a new mascot render shows immediately after swap
const BOT_IMG = '/eyra-cute-bot.png?v=3';

function errorLineFrom(...sources) {
  for (const src of sources) {
    const text = String(src || '');
    const m = text.match(/line (\d+)/i) || text.match(/:(\d+)(?::\d+)?/);
    if (m) return Number(m[1]);
  }
  return null;
}

function isRealErrorType(t) {
  if (!t) return false;
  const s = String(t).trim();
  return s.length > 0 && !/^none$/i.test(s) && s !== 'null' && s !== 'undefined';
}

const PY_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const PY_BUILTINS = new Set([
  'int',
  'float',
  'str',
  'bool',
  'list',
  'dict',
  'set',
  'tuple',
  'len',
  'range',
  'print',
  'type',
  'Exception',
  'ValueError',
  'TypeError',
  'ZeroDivisionError',
]);

/** Lightweight Python-ish highlighter for chatbot code cards. */
function highlightCodeLine(line, language) {
  const lang = String(language || 'python').toLowerCase();
  if (!line) return '\u00a0';
  if (!/python|py|text/.test(lang) && lang !== 'python') {
    // still try python rules for most buffers
  }

  const parts = [];
  let i = 0;
  let key = 0;
  const push = (text, color) => {
    if (!text) return;
    parts.push(
      <span key={`t${key++}`} style={{ color }}>
        {text}
      </span>,
    );
  };

  while (i < line.length) {
    // comments
    if (line[i] === '#') {
      push(line.slice(i), '#8B949E');
      break;
    }
    // strings
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      // triple quotes
      if (line.slice(i, i + 3) === quote + quote + quote) {
        let j = i + 3;
        const end = line.indexOf(quote + quote + quote, j);
        if (end === -1) {
          push(line.slice(i), '#E3B341');
          break;
        }
        push(line.slice(i, end + 3), '#E3B341');
        i = end + 3;
        continue;
      }
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push(line.slice(i, j), '#E3B341');
      i = j;
      continue;
    }
    // numbers
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s([{=,:+\-*/%]/.test(line[i - 1] || ' '))) {
      let j = i;
      while (j < line.length && /[0-9._]/.test(line[j])) j += 1;
      push(line.slice(i, j), '#F0883E');
      i = j;
      continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      const nextNonSpace = line.slice(j).match(/^\s*/)?.[0]?.length ?? 0;
      const after = line[j + nextNonSpace];
      if (PY_KEYWORDS.has(word)) push(word, '#FF7B72');
      else if (PY_BUILTINS.has(word)) push(word, '#79C0FF');
      else if (after === '(') push(word, '#D2A8FF');
      else push(word, '#79C0FF');
      i = j;
      continue;
    }
    // operators / punctuation
    if (/[+\-*/%=<>!&|^~]/.test(line[i])) {
      push(line[i], '#FF7B72');
      i += 1;
      continue;
    }
    push(line[i], '#C9D1D9');
    i += 1;
  }

  return parts.length ? parts : '\u00a0';
}

function CodeResultCard({
  title,
  language,
  code,
  changes = [],
  onCopy,
  highlightLine = null,
  borderTone = 'blue',
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const lines = normalizeDisplayedCode(code).split('\n');
  const langLabel =
    /python|py/i.test(String(language || '')) || !language
      ? 'Python'
      : String(language).charAt(0).toUpperCase() + String(language).slice(1);
  const border =
    borderTone === 'red'
      ? '1px solid rgba(255,138,149,0.35)'
      : borderTone === 'green'
        ? '1px solid rgba(108,249,187,0.35)'
        : '1px solid rgba(56,139,253,0.22)';

  async function handleCopy() {
    await onCopy?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      style={{
        marginTop: 10,
        overflow: 'hidden',
        borderRadius: 14,
        background: '#0a0f18',
        border,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 12px',
          background: '#161b27',
          borderBottom: '1px solid rgba(60,73,76,0.55)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span
            style={{
              color: '#dee2f2',
              fontSize: 12,
              fontWeight: 650,
              letterSpacing: '-0.01em',
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            }}
          >
            {title || 'Code'}
          </span>
          <span
            style={{
              fontSize: 11,
              color: '#859397',
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            }}
          >
            {langLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 9px',
            borderRadius: 8,
            border: '1px solid rgba(60,73,76,0.8)',
            background: '#252a36',
            color: copied ? '#6CF9BB' : '#bbc9cd',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre
        className="eyra-terminal-scroll"
        style={{
          margin: 0,
          maxHeight: 200,
          overflow: 'auto',
          padding: '8px 0',
          background: '#0a0f18',
          fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
          fontSize: 11.5,
          lineHeight: 1.65,
        }}
      >
        {lines.map((line, i) => {
          const hot = highlightLine != null && i + 1 === Number(highlightLine);
          return (
            <div
              key={`c${i}`}
              style={{
                display: 'flex',
                minHeight: 20,
                background: hot ? 'rgba(255,138,149,0.14)' : 'transparent',
                boxShadow: hot ? 'inset 3px 0 0 #ff8a95' : 'none',
              }}
            >
              <span
                style={{
                  width: 34,
                  flexShrink: 0,
                  textAlign: 'right',
                  paddingRight: 10,
                  color: hot ? '#ff8a95' : '#484F58',
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {i + 1}
              </span>
              <span
                style={{
                  flex: 1,
                  paddingRight: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {highlightCodeLine(line, language)}
              </span>
            </div>
          );
        })}
      </pre>

      {changes?.length ? (
        <div style={{ borderTop: '1px solid rgba(60,73,76,0.55)', background: '#161b27' }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              border: 'none',
              background: 'transparent',
              color: '#dee2f2',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 650,
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            }}
          >
            <span>Changes Made</span>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#bbc9cd' }}>
              {open ? 'expand_more' : 'chevron_right'}
            </span>
          </button>
          {open ? (
            <ul
              style={{
                margin: 0,
                padding: '0 12px 12px',
                listStyle: 'none',
                display: 'grid',
                gap: 8,
              }}
            >
              {changes.map((c) => (
                <li
                  key={c}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    color: '#dee2f2',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#005d3f',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 12, color: '#6CF9BB', fontVariationSettings: "'FILL' 1" }}
                    >
                      check
                    </span>
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ErrorAlertCard({ errorType, detail }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(147,0,10,0.28)',
        border: '1px solid rgba(255,138,149,0.45)',
        boxShadow: '0 0 24px rgba(255,138,149,0.12)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'rgba(255,138,149,0.25)',
          border: '1px solid rgba(255,138,149,0.55)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: '#ffb4ab',
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        !
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: '#ffb4ab',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          }}
        >
          {errorType || 'Runtime Error'}
        </div>
        <div
          style={{
            marginTop: 4,
            color: '#dee2f2',
            fontSize: 12,
            lineHeight: 1.45,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function DiagnosisMessage({ msg, fileName, onCopy, onApply, onTests, onExplain }) {
  const fix = presentSuggestedFix(msg.fixSummary, msg.fixCode, msg.originalCode);
  return (
    <>
      <ErrorAlertCard errorType={msg.errorType} detail={msg.errorDetail} />
      {msg.originalCode ? (
        <CodeResultCard
          title={msg.fileName || fileName}
          language={msg.language}
          code={msg.originalCode}
          highlightLine={msg.highlightLine}
          borderTone="red"
          onCopy={() => onCopy(normalizeDisplayedCode(msg.originalCode))}
        />
      ) : null}
      <SuggestedFixBlock
        summary={fix.summary}
        code={fix.code}
        language={msg.language}
        fileName={msg.fileName}
        onCopy={() => onCopy(fix.code)}
      />
      <DiagnosisActions
        onApply={() => onApply(fix.code.trim())}
        onTests={onTests}
        onExplain={onExplain}
      />
    </>
  );
}

function SuggestedFixBlock({ summary, code, language, fileName, onCopy }) {
  if (!summary && !code) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'rgba(75,220,161,0.2)',
            border: '1px solid rgba(108,249,187,0.45)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 14px rgba(108,249,187,0.25)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, color: '#6CF9BB', fontVariationSettings: "'FILL' 1" }}
          >
            check
          </span>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              color: '#dee2f2',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            }}
          >
            Suggested Fix
          </div>
          {summary ? (
            <div
              style={{
                marginTop: 4,
                color: '#bbc9cd',
                fontSize: 12,
                lineHeight: 1.45,
                fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
              }}
            >
              {summary}
            </div>
          ) : null}
          {code ? (
            <CodeResultCard
              title={fileName || 'fixed.py'}
              language={language}
              code={code}
              onCopy={onCopy}
              borderTone="green"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DiagnosisActions({ onApply, onTests, onExplain }) {
  const btnBase = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      <button
        type="button"
        onClick={onApply}
        style={{
          ...btnBase,
          border: '1px solid rgba(57,216,244,0.45)',
          background: 'rgba(53,214,242,0.16)',
          color: '#9CEDFF',
          boxShadow: '0 0 18px rgba(53,214,242,0.15)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          build
        </span>
        Apply Fix
      </button>
      <button
        type="button"
        onClick={onTests}
        style={{
          ...btnBase,
          border: '1px solid rgba(60,73,76,0.9)',
          background: 'rgba(37,42,54,0.9)',
          color: '#dee2f2',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          shield
        </span>
        Add Tests
      </button>
      <button
        type="button"
        onClick={onExplain}
        style={{
          ...btnBase,
          border: '1px solid rgba(60,73,76,0.9)',
          background: 'transparent',
          color: '#dee2f2',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
          menu_book
        </span>
        Explain Step by Step
      </button>
    </div>
  );
}

function SmallBotAvatar({ size = 28 }) {
  return (
    <img
      src={BOT_IMG}
      alt="EYRA"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'contain',
        flexShrink: 0,
        padding: size > 48 ? 4 : 2,
        boxShadow: '0 0 0 1px rgba(57,216,244,0.35), 0 0 22px rgba(191,0,255,0.18)',
        background: 'radial-gradient(circle at 50% 40%, rgba(57,216,244,0.12), transparent 65%)',
      }}
    />
  );
}

let chatMessageSeq = 0;

function nextChatMessageId(prefix) {
  chatMessageSeq += 1;
  return `${prefix}-${Date.now()}-${chatMessageSeq}`;
}

function normalizeChatMessage(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.role !== 'user' && raw.role !== 'bot') return null;
  if (typeof raw.text !== 'string') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `m-${index}`,
    role: raw.role,
    kind: raw.kind === 'diagnosis' ? 'diagnosis' : 'text',
    text: raw.text,
    code: typeof raw.code === 'string' ? raw.code : null,
    codeTitle: typeof raw.codeTitle === 'string' ? raw.codeTitle : null,
    language: typeof raw.language === 'string' ? raw.language : null,
    changes: Array.isArray(raw.changes) ? raw.changes.filter((c) => typeof c === 'string') : [],
    errorType: typeof raw.errorType === 'string' ? raw.errorType : null,
    errorDetail: typeof raw.errorDetail === 'string' ? raw.errorDetail : null,
    originalCode: typeof raw.originalCode === 'string' ? raw.originalCode : null,
    highlightLine: Number.isFinite(raw.highlightLine) ? raw.highlightLine : null,
    fileName: typeof raw.fileName === 'string' ? raw.fileName : null,
    fixSummary: typeof raw.fixSummary === 'string' ? raw.fixSummary : null,
    fixCode: typeof raw.fixCode === 'string' ? raw.fixCode : null,
  };
}

function bootChat() {
  const saved = loadWorkspaceSlice('chat');
  const messages = Array.isArray(saved?.messages)
    ? saved.messages.map(normalizeChatMessage).filter(Boolean).slice(-120)
    : [];
  const followUps = Array.isArray(saved?.followUps)
    ? saved.followUps.filter((item) => typeof item === 'string').slice(0, 8)
    : [];
  return {
    messages,
    input: typeof saved?.input === 'string' ? saved.input : '',
    followUps,
    seenPulseId: typeof saved?.seenPulseId === 'string' ? saved.seenPulseId : null,
  };
}

/**
 * Dark EYRA chatbot — surface navy + soft primary glow to match Obsidian Telemetry.
 */
export function EyraAssistantChat({
  bufferText = '',
  language = 'python',
  fileName = 'snippet.py',
  loading = false,
  liveWatching = false,
  modelLabel: _modelLabel = 'Groq Llama-3-70B',
  runtimePulse = null,
  onAnalyze,
  onSandbox,
  onCopyPatch,
  onApplyFix,
  buildPayload,
}) {
  const { activeResult, status, showToast, adoptResult } = useEyra();
  const chatBootRef = useRef(null);
  if (!chatBootRef.current) chatBootRef.current = bootChat();
  const chatBoot = chatBootRef.current;
  const [messages, setMessages] = useState(chatBoot.messages);
  const [input, setInput] = useState(chatBoot.input);
  const [busy, setBusy] = useState(false);
  const [followUps, setFollowUps] = useState(chatBoot.followUps);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('eyra.chatWidth'));
      if (Number.isFinite(saved) && saved >= 320 && saved <= 720) return saved;
    } catch {
      /* ignore */
    }
    return 400;
  });
  const [resizing, setResizing] = useState(false);
  const scrollerRef = useRef(null);
  const seenPulseRef = useRef(chatBoot.seenPulseId);
  const inputRef = useRef(chatBoot.input);
  const followUpsRef = useRef(chatBoot.followUps);
  const dragRef = useRef({ startX: 0, startW: 400 });
  inputRef.current = input;
  followUpsRef.current = followUps;

  function snapshotChat(nextMessages) {
    saveWorkspaceSlice('chat', {
      messages: nextMessages,
      input: inputRef.current,
      followUps: followUpsRef.current,
      seenPulseId: seenPulseRef.current,
    });
  }

  const online = Boolean(status?.healthy ?? true);
  const userInitial = useMemo(() => {
    try {
      return ((localStorage.getItem('eyra.userInitial') || 'K').trim()[0] || 'K').toUpperCase();
    } catch {
      return 'K';
    }
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, followUps]);

  useEffect(() => {
    try {
      localStorage.setItem('eyra.chatWidth', String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  useEffect(() => {
    saveWorkspaceSlice('chat', {
      messages,
      input: inputRef.current,
      followUps: followUpsRef.current,
      seenPulseId: seenPulseRef.current,
    });
  }, [messages, input, followUps]);

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (e) => {
      const delta = dragRef.current.startX - e.clientX;
      const next = Math.min(720, Math.max(320, dragRef.current.startW + delta));
      setPanelWidth(next);
    };
    const onUp = () => setResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing]);

  function pushUser(text) {
    setMessages((m) => {
      const next = [...m, { id: nextChatMessageId('u'), role: 'user', text }];
      snapshotChat(next);
      return next;
    });
  }

  function pushBot(partial) {
    setMessages((m) => {
      const next = [
        ...m,
        {
          id: nextChatMessageId('b'),
          role: 'bot',
          kind: partial.kind || 'text',
          text: partial.text || '',
          code: partial.code || null,
          codeTitle: partial.codeTitle || 'Optimized Code',
          language: partial.language || language,
          changes: partial.changes || [],
          errorType: partial.errorType || null,
          errorDetail: partial.errorDetail || null,
          originalCode: partial.originalCode || null,
          highlightLine: partial.highlightLine ?? null,
          fileName: partial.fileName || fileName,
          fixSummary: partial.fixSummary || null,
          fixCode: partial.fixCode || null,
        },
      ];
      snapshotChat(next);
      return next;
    });
  }

  function pushDiagnosisFromResult(result, exec, codeSnippet, opts = {}) {
    const errType =
      (isRealErrorType(exec?.error_type) && exec.error_type) ||
      (isRealErrorType(result?.error_type) && result.error_type) ||
      null;
    const failed = exec && !exec.ok;
    const line = errorLineFrom(
      result?.stack_trace,
      exec?.stack_trace,
      exec?.stderr,
      result?.error_summary,
    );
    const detail =
      result?.error_summary ||
      result?.root_cause ||
      exec?.stderr ||
      'A runtime fault was captured from the terminal.';
    const presented = presentSuggestedFix(
      result?.suggested_correction?.summary || result?.root_cause || '',
      result?.suggested_correction?.corrected_code || '',
      codeSnippet || result?.code_snippet || bufferText,
    );
    const fixCode = presented.code || null;
    const fixSummary =
      presented.summary ||
      (fixCode ? 'Review the corrected buffer before pasting it back (HITL).' : null);

    if (!errType && !failed) {
      pushBot({
        text: 'Run completed cleanly — no runtime fault in the terminal output.',
      });
      setFollowUps([]);
      return;
    }

    pushBot({
      kind: 'diagnosis',
      text: "I've analyzed your code and found the issue.",
      errorType: errType || exec?.status || 'Runtime Error',
      errorDetail: detail,
      originalCode: codeSnippet || result?.code_snippet || bufferText,
      highlightLine: line,
      fileName: opts.fileName || result?.file_name || fileName,
      language: opts.language || result?.language || language,
      fixSummary,
      fixCode,
      changes: [result?.root_cause, result?.reasoning_note].filter(Boolean),
    });
    setFollowUps([]);
  }

  useEffect(() => {
    if (!runtimePulse?.id || seenPulseRef.current === runtimePulse.id) return;
    // Only auto-post when the terminal Run failed / threw.
    const failed = runtimePulse.exec && !runtimePulse.exec.ok;
    const errType = runtimePulse.result?.error_type || runtimePulse.exec?.error_type;
    const hasError =
      failed ||
      (errType &&
        String(errType).trim() &&
        !/^none$/i.test(String(errType)) &&
        errType !== 'null');
    if (!hasError) return;
    seenPulseRef.current = runtimePulse.id;
    pushUser('Why is this code throwing an error and how can I fix it?');
    pushDiagnosisFromResult(runtimePulse.result, runtimePulse.exec, runtimePulse.code, {
      fileName: runtimePulse.fileName,
      language: runtimePulse.language,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot per pulse id
  }, [runtimePulse]);

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code || '');
      showToast?.('Code copied', 'info');
    } catch {
      showToast?.('Clipboard blocked', 'error');
    }
  }

  async function runAction(actionId, promptText) {
    const text = (promptText || '').trim();
    if (!text || busy) return;
    inputRef.current = '';
    pushUser(text);
    setInput('');
    setBusy(true);
    setFollowUps([]);

    try {
      const code = bufferText || '';
      if (actionId === 'optimize' || /optim/i.test(text)) {
        const data = await api.performanceOptimize({
          code: code || 'def placeholder():\n    return 0\n',
          language,
          file_name: fileName,
          target_time: 'O(n)',
          target_space: 'O(1)',
          goal: text,
        });
        const sug = data.suggestion || {};
        pushBot({
          text: sug.applied_transform
            ? "Here's an optimized and more Pythonic version of your code with explanations:"
            : 'I reviewed the buffer. Here’s guidance toward your targets:',
          code: sug.optimized_code || code,
          codeTitle: 'Optimized Code',
          changes: sug.reasons || [],
          language,
        });
        setFollowUps([]);
        if (sug.optimized_code) {
          adoptResult?.({
            ...(activeResult || {}),
            file_name: fileName,
            language,
            code_snippet: code,
            suggested_correction: {
              summary: 'Chat optimize suggestion',
              corrected_code: sug.optimized_code,
              apply_mode: 'review_and_copy',
            },
            root_cause: (sug.reasons || []).join('; '),
            status: 'verified',
          });
        }
      } else if (actionId === 'generate' || /generat|test/i.test(text)) {
        const tests = await api.performanceGenerateTests({
          code: code || 'def fibonacci(n):\n    return n\n',
          language,
          file_name: fileName,
        });
        const lines = (tests.cases || [])
          .slice(0, 6)
          .map((c) => `# ${c.id}. ${c.description}  input=${c.input} expected=${c.expected}`)
          .join('\n');
        pushBot({
          text: `Generated ${tests.total || 0} test cases for your buffer.`,
          code: lines || '# No cases',
          codeTitle: 'Generated Tests',
          changes: ['Derived from detected function signature', 'Ready to run in Code Performance & Test Analysis'],
          language: 'text',
        });
        setFollowUps([]);
      } else if (actionId === 'explain' || /explain/i.test(text)) {
        if (activeResult?.root_cause || activeResult?.explanation) {
          const related = presentSuggestedFix(
            activeResult.suggested_correction?.summary || '',
            activeResult.suggested_correction?.corrected_code || '',
            code,
          );
          pushBot({
            text: related.code
              ? activeResult.explanation ||
                activeResult.root_cause ||
                'Here is what the Brain last reported for this buffer.'
              : related.summary ||
                activeResult.explanation ||
                activeResult.root_cause ||
                'Here is what the Brain last reported for this buffer.',
            code: related.code || null,
            codeTitle: 'Related Suggestion',
            changes: activeResult.root_cause ? [activeResult.root_cause] : [],
            language,
          });
        } else {
          const payload = buildPayload?.() || {
            file_name: fileName,
            language,
            code_snippet: code,
          };
          const result = await api.analyze({ ...payload, terminal_output: text });
          adoptResult?.(result);
          const explained = presentSuggestedFix(
            result.suggested_correction?.summary || '',
            result.suggested_correction?.corrected_code || '',
            code,
          );
          pushBot({
            text: explained.code
              ? result.explanation || result.root_cause || explained.summary || 'Analysis complete.'
              : explained.summary || result.explanation || result.root_cause || 'Analysis complete.',
            code: explained.code || null,
            codeTitle: 'Suggested Fix',
            changes: [result.root_cause, result.error_summary].filter(Boolean),
            language: result.language || language,
          });
        }
        setFollowUps([]);
      } else {
        const payload = buildPayload?.() || {
          file_name: fileName,
          language,
          code_snippet: code,
        };
        let result = null;
        if (onAnalyze) result = await onAnalyze(payload);
        if (!result) {
          result = await api.analyze({ ...payload, terminal_output: text });
          adoptResult?.(result);
        }
        if (isRealErrorType(result?.error_type)) {
          pushDiagnosisFromResult(result, null, code, { fileName, language });
        } else {
          const suggested = presentSuggestedFix(
            result?.suggested_correction?.summary || '',
            result?.suggested_correction?.corrected_code || '',
            code,
          );
          pushBot({
            text: suggested.code
              ? result?.explanation || result?.root_cause || suggested.summary || 'Analysis complete.'
              : suggested.summary ||
                result?.explanation ||
                result?.root_cause ||
                'Buffer looks clean — no hard fault detected.',
            code: suggested.code || null,
            codeTitle: 'Suggested Fix',
            changes: [result?.root_cause, result?.verification?.detail, result?.reasoning_note].filter(
              Boolean,
            ),
            language: result?.language || language,
          });
          setFollowUps([]);
        }
      }
    } catch (err) {
      pushBot({
        text: err.message || 'Sorry — I could not complete that request. Is the Brain online?',
      });
      showToast?.(err.message || 'Assistant request failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function onQuick(action) {
    runAction(action.id, action.prompt);
  }

  function onSubmit(e) {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text) return;
    let action = 'debug';
    if (/optim/i.test(text)) action = 'optimize';
    else if (/explain/i.test(text)) action = 'explain';
    else if (/generat|test/i.test(text)) action = 'generate';
    runAction(action, text);
  }

  function onFollowUp(kind) {
    if (kind === 'tests') {
      runAction('generate', 'Generate tests for this code');
      return;
    }
    if (kind === 'explain') runAction('explain', 'Explain step by step');
  }

  const empty = messages.length === 0;

  return (
    <aside
      className="eyra-assistant-dark"
      style={{
        width: panelWidth,
        minWidth: 320,
        maxWidth: 720,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        alignSelf: 'stretch',
        margin: '10px 10px 10px 0',
        borderRadius: '20px 16px 16px 20px',
        border: '1px solid rgba(60,73,76,0.65)',
        boxShadow:
          '0 18px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(57,216,244,0.06), inset 0 1px 0 rgba(157,237,255,0.06)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        background:
          'radial-gradient(ellipse 90% 55% at 100% 0%, rgba(53,214,242,0.14), transparent 55%), radial-gradient(ellipse 70% 45% at 0% 100%, rgba(27,55,190,0.18), transparent 50%), linear-gradient(180deg, #121826 0%, #0e131e 42%, #090e19 100%)',
        color: '#dee2f2',
      }}
    >
      {/* Drag handle — widen / shrink chat panel */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chatbot"
        title="Drag to widen chat"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { startX: e.clientX, startW: panelWidth };
          setResizing(true);
        }}
        style={{
          position: 'absolute',
          left: 0,
          top: 18,
          bottom: 18,
          width: 10,
          zIndex: 6,
          cursor: 'col-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            width: 3,
            height: 42,
            borderRadius: 999,
            background: resizing ? 'rgba(57,216,244,0.75)' : 'rgba(133,147,151,0.55)',
            boxShadow: resizing ? '0 0 12px rgba(53,214,242,0.55)' : 'none',
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        />
      </div>

      {/* Atmospheric glow wash */}
      <div
        aria-hidden
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background:
            'linear-gradient(115deg, transparent 35%, rgba(57,216,244,0.06) 72%, rgba(187,195,255,0.05) 100%)',
          zIndex: 0,
        }}
      />

      {/* Header */}
      <div
        style={{
          position: 'relative',
          padding: '16px 16px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          zIndex: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <SmallBotAvatar size={72} />
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#dee2f2' }}>
            EYRA
          </span>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            padding: '5px 12px',
            borderRadius: 999,
            background: 'rgba(37,42,54,0.95)',
            border: '1px solid rgba(60,73,76,0.8)',
            boxShadow: '0 0 20px rgba(53,214,242,0.08)',
            fontSize: 11,
            fontWeight: 600,
            color: online ? '#6CF9BB' : '#ffb4ab',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: online ? '#4bdca1' : '#ffb4ab',
              boxShadow: online ? '0 0 8px rgba(75,220,161,0.7)' : 'none',
            }}
          />
          {online ? 'Online' : 'Offline'}
          {liveWatching || loading ? ' · syncing' : ''}
        </span>
      </div>

      {/* Scroll body */}
      <div
        ref={scrollerRef}
        className="eyra-terminal-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {empty ? (
          <>
            <div style={{ marginTop: 4 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  color: '#dee2f2',
                  lineHeight: 1.25,
                }}
              >
                Hello, I&apos;m EYRA
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.45, color: '#bbc9cd' }}>
                Your intelligent debugging companion. Ask, debug, optimize, or explore your code.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onQuick(a)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: '14px 6px',
                    borderRadius: 14,
                    border: '1px solid rgba(60,73,76,0.7)',
                    background: 'rgba(27,31,43,0.72)',
                    boxShadow: 'inset 0 1px 0 rgba(57,216,244,0.06), 0 8px 24px rgba(0,0,0,0.28)',
                    backdropFilter: 'blur(10px)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 22, color: a.color }}
                  >
                    {a.icon}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#dee2f2' }}>{a.label}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div
              key={msg.id}
              style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 8 }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '10px 14px',
                  borderRadius: 14,
                  borderBottomRightRadius: 4,
                  background: 'linear-gradient(135deg, #1b37be 0%, #006877 100%)',
                  color: '#dee0ff',
                  fontSize: 12,
                  lineHeight: 1.45,
                  boxShadow: '0 8px 22px rgba(27,55,190,0.35)',
                  border: '1px solid rgba(187,195,255,0.22)',
                }}
              >
                {msg.text}
              </div>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #35d6f2, #1b37be)',
                  color: '#001f25',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  boxShadow: '0 0 12px rgba(53,214,242,0.35)',
                }}
              >
                {userInitial}
              </div>
            </div>
          ) : (
            <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <SmallBotAvatar size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {msg.text ? (
                  <div
                    style={{
                      padding: msg.kind === 'diagnosis' ? '0 0 2px' : '10px 14px',
                      borderRadius: msg.kind === 'diagnosis' ? 0 : 14,
                      borderTopLeftRadius: msg.kind === 'diagnosis' ? 0 : 4,
                      background:
                        msg.kind === 'diagnosis' ? 'transparent' : 'rgba(27,31,43,0.88)',
                      border: msg.kind === 'diagnosis' ? 'none' : '1px solid rgba(60,73,76,0.75)',
                      boxShadow:
                        msg.kind === 'diagnosis'
                          ? 'none'
                          : '0 8px 22px rgba(0,0,0,0.28), inset 0 1px 0 rgba(57,216,244,0.05)',
                      color: '#dee2f2',
                      fontSize: 12,
                      lineHeight: 1.5,
                      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                    }}
                  >
                    {String(msg.text || '').replace(/\*\*/g, '')}
                  </div>
                ) : null}

                {msg.kind === 'diagnosis' ? (
                  <DiagnosisMessage
                    msg={msg}
                    fileName={fileName}
                    onCopy={copyCode}
                    onApply={(patch) => {
                      if (!patch) {
                        showToast?.('No suggested fix to apply yet', 'error');
                        return;
                      }
                      if (typeof onApplyFix === 'function') {
                        onApplyFix(patch);
                        pushBot({
                          text: 'Applied the suggested fix to your editor buffer. It was not written to disk and has not been verified.',
                        });
                        showToast?.('Fix applied to the editor buffer', 'info');
                        return;
                      }
                      void copyCode(patch);
                      onCopyPatch?.();
                      showToast?.('Fix copied — paste into the editor', 'info');
                    }}
                    onTests={() => runAction('generate', 'Generate tests for this code')}
                    onExplain={() => runAction('explain', 'Explain step by step')}
                  />
                ) : msg.code ? (
                  <CodeResultCard
                    title={msg.codeTitle}
                    language={msg.language}
                    code={normalizeDisplayedCode(msg.code)}
                    changes={msg.changes}
                    onCopy={() => copyCode(normalizeDisplayedCode(msg.code))}
                  />
                ) : null}
              </div>
            </div>
          ),
        )}

        {busy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#859397', fontSize: 12 }}>
            <SmallBotAvatar size={24} />
            EYRA is thinking…
          </div>
        ) : null}

        {followUps.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              followUps.includes('tests') && {
                id: 'tests',
                label: 'Add Tests',
                icon: 'shield',
              },
              followUps.includes('explain') && {
                id: 'explain',
                label: 'Explain Step by Step',
                icon: 'menu_book',
              },
            ]
              .filter(Boolean)
              .map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => onFollowUp(chip.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(60,73,76,0.8)',
                    background: 'rgba(37,42,54,0.9)',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                    color: '#dee2f2',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#9CEDFF' }}>
                    {chip.icon}
                  </span>
                  {chip.label}
                </button>
              ))}
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        style={{
          padding: 12,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div
          style={{
            borderRadius: 16,
            background: 'rgba(22,27,39,0.92)',
            border: '1px solid rgba(60,73,76,0.75)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 0 40px rgba(53,214,242,0.06)',
            backdropFilter: 'blur(12px)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
              rows={2}
              placeholder="Ask anything..."
              disabled={busy}
              style={{
                flex: 1,
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 13,
                color: '#dee2f2',
                padding: '4px',
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              style={{
                width: 36,
                height: 36,
                flexShrink: 0,
                borderRadius: '50%',
                border: 'none',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !input.trim() ? 0.45 : 1,
                background: 'linear-gradient(135deg, #35d6f2 0%, #1b37be 100%)',
                color: '#001f25',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px rgba(53,214,242,0.35)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                send
              </span>
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
