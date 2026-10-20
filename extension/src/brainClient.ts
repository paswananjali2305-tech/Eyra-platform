import { brainBaseUrl } from './config';
import type { AnalyzeDiagnostic } from './diagnosticsModel';
import { requestJson } from './http';
import { getBrainAbortSignal } from './inflight';
import {
  parseAnalyzeResult,
  parseAuthSession,
  parseAuthUser,
  ResponseShapeError,
  type AnalyzeResult,
  type AuthSession,
  type AuthUser,
} from './parse';
import { historyDetailPath } from './phase4Model';
import type { ExecuteRequestBody, PerformanceRequestBody, RunTestsRequestBody } from './phase3Model';

export type { AnalyzeResult, AuthSession } from './parse';
export type { AnalyzeDiagnostic } from './diagnosticsModel';

function withAbort<T extends Record<string, unknown>>(options: T): T & { signal?: AbortSignal } {
  const signal = getBrainAbortSignal();
  return signal ? { ...options, signal } : options;
}

export type AnalyzeRequestBody = {
  file_name: string;
  language: string;
  code_snippet: string;
  terminal_output: string;
  stack_trace: string;
  project_name: string;
  reasoning_profile: 'runtime';
  /** Optional VS Code Problems; omit or [] when unavailable. */
  diagnostics?: AnalyzeDiagnostic[];
};

export async function login(loginId: string, password: string): Promise<AuthSession> {
  const body = await requestJson({
    baseUrl: brainBaseUrl(),
    path: '/api/auth/login',
    method: 'POST',
    body: { login: loginId, password },
    timeoutMs: 20_000,
  });
  return parseAuthSession(body);
}

export async function registerAccount(input: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<AuthSession> {
  const body = await requestJson({
    baseUrl: brainBaseUrl(),
    path: '/api/auth/register',
    method: 'POST',
    body: {
      email: input.email,
      username: input.username,
      password: input.password,
      display_name: input.displayName || undefined,
    },
    timeoutMs: 20_000,
  });
  return parseAuthSession(body);
}

export async function exchangeExtensionCode(code: string): Promise<AuthSession> {
  const body = await requestJson({
    baseUrl: brainBaseUrl(),
    path: '/api/auth/extension/exchange',
    method: 'POST',
    body: { code },
    timeoutMs: 20_000,
  });
  return parseAuthSession(body);
}

export async function disconnectExtension(token: string): Promise<void> {
  await requestJson({
    baseUrl: brainBaseUrl(),
    path: '/api/auth/extension/disconnect',
    method: 'POST',
    token,
    timeoutMs: 20_000,
  });
}

export async function fetchMe(token: string): Promise<AuthUser> {
  const body = await requestJson({
    baseUrl: brainBaseUrl(),
    path: '/api/auth/me',
    token,
    timeoutMs: 20_000,
  });
  return parseAuthUser(body);
}

export async function analyzeCode(token: string, payload: AnalyzeRequestBody): Promise<AnalyzeResult> {
  const body = await requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/analyze',
    method: 'POST' as const,
    token,
    body: payload,
    timeoutMs: 90_000,
  }));
  return parseAnalyzeResult(body);
}

export function listRuntimes(token?: string): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/runtimes',
    token,
    timeoutMs: 20_000,
  }));
}

export function executeCode(token: string | undefined, body: ExecuteRequestBody): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/execute',
    method: 'POST' as const,
    token,
    body,
    timeoutMs: 45_000,
  }));
}

export function analyzePerformance(token: string | undefined, body: PerformanceRequestBody): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/performance/analyze',
    method: 'POST' as const,
    token,
    body,
    timeoutMs: 60_000,
  }));
}

export function suggestOptimization(token: string | undefined, body: PerformanceRequestBody): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/performance/optimize',
    method: 'POST' as const,
    token,
    body,
    timeoutMs: 90_000,
  }));
}

export function generateTests(
  token: string | undefined,
  body: Pick<PerformanceRequestBody, 'code' | 'language' | 'file_name'>,
): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/performance/tests/generate',
    method: 'POST' as const,
    token,
    body,
    timeoutMs: 30_000,
  }));
}

export function runTests(token: string | undefined, body: RunTestsRequestBody): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path: '/api/performance/tests/run',
    method: 'POST' as const,
    token,
    body,
    timeoutMs: 180_000,
  }));
}

export function fetchHistory(token: string, path: string): Promise<unknown> {
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path,
    token,
    timeoutMs: 20_000,
  }));
}

export function getHistorySession(token: string, sessionId: string): Promise<unknown> {
  const path = historyDetailPath(sessionId);
  if (!path) {
    return Promise.reject(new ResponseShapeError('That session id cannot be requested.'));
  }
  return requestJson(withAbort({
    baseUrl: brainBaseUrl(),
    path,
    token,
    timeoutMs: 20_000,
  }));
}
