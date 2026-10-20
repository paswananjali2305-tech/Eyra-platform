import type { ContextErr, ContextOk } from './editorContext';
import { BrainHttpError } from './http';
import { ResponseShapeError } from './parse';

export type RuntimeCapability = {
  language: string;
  displayName: string;
  runtime: string | null;
  available: boolean;
  version: string | null;
  detail: string | null;
  executable: boolean;
};

export type ExecuteRequestBody = {
  code: string;
  language: string;
  file_name: string;
};

export type PerformanceRequestBody = {
  code: string;
  language: string;
  file_name: string;
  target_time: string;
  target_space: string;
};

export type ReviewedCase = {
  id: number;
  description: string;
  call: string | null;
  status: string;
  raw: Record<string, unknown>;
};

export type TestCounts = {
  total: number;
  passed: number;
  failed: number;
  error: number;
  skipped: number;
  executed: number;
  not_run: number;
};

export type CoverageView = {
  status: string;
  measured: boolean;
  percent: number | null;
  reason: string;
  coveredLines: number | null;
  totalLines: number | null;
};

export type ExecuteView = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  errorType: string | null;
  language: string | null;
  runtime: string | null;
  runtimeVersion: string | null;
  runtimeAvailable: boolean | null;
  status: string | null;
  phase: string | null;
  timedOut: boolean;
  durationMs: number | null;
  diagnostics: string | null;
  success: boolean;
  headline: string;
};

export type GeneratedTestsView = {
  cases: ReviewedCase[];
  total: number | null;
  passed: number | null;
  failed: number | null;
  notRun: number | null;
  headline: string;
  mode: string;
  target: string | null;
  coverage: CoverageView;
  notice: string | null;
  language: string;
  fileName: string;
};

export type TestRunView = {
  cases: ReviewedCase[];
  counts: TestCounts;
  log: string;
  passing: boolean;
  headline: string;
  passRatePercent: number | null;
  coverage: CoverageView;
  language: string;
  fileName: string;
};

export type PerformanceView = {
  fileName: string;
  language: string;
  time: string;
  space: string;
  timeLabel: string;
  spaceLabel: string;
  timeSeverity: string;
  spaceSeverity: string;
  notes: string[];
  functionName: string | null;
  pattern: string | null;
  basis: string;
  basisLabel: string;
  targetTime: string;
  targetSpace: string;
  targetGoal: string;
  unrunCases: number | null;
  payloadNotes: string[];
};

export type OptimizeView = {
  fileName: string;
  language: string;
  currentTime: string;
  currentSpace: string;
  optimizedTime: string;
  optimizedSpace: string;
  reasons: string[];
  appliedTransform: boolean;
  reasoningSource: string;
  optimizedCode: string;
  functionName: string | null;
  pattern: string | null;
};

export type ReviewedTests = {
  code: string;
  language: string;
  fileName: string;
  cases: ReviewedCase[];
};

export type RunTestsRequestBody = {
  code: string;
  language: string;
  file_name: string;
  cases: Record<string, unknown>[];
  case_ids: number[];
};

type FlowFailure = {
  phase: 'blocked' | 'unsupported' | 'cancelled' | 'http' | 'timeout' | 'malformed';
  requested: boolean;
  success: false;
  message: string;
  unauthorized?: boolean;
};

function caught(err: unknown, requested: boolean): FlowFailure {
  return {
    phase: failurePhase(err),
    requested,
    success: false,
    message: failureMessage(err),
    unauthorized: err instanceof BrainHttpError && err.unauthorized,
  };
}

export type ExecuteFlowResult =
  | FlowFailure
  | {
    phase: 'result';
    requested: true;
    success: boolean;
    body: ExecuteRequestBody;
    view: ExecuteView;
  };

export type GenerateFlowResult =
  | FlowFailure
  | {
    phase: 'review';
    requested: true;
    success: false;
    body: Pick<PerformanceRequestBody, 'code' | 'language' | 'file_name'>;
    view: GeneratedTestsView;
  };

export type TestRunFlowResult =
  | FlowFailure
  | {
    phase: 'result';
    requested: true;
    success: boolean;
    passing: boolean;
    body: RunTestsRequestBody;
    view: TestRunView;
  };

const LANGUAGE_ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  javascriptreact: 'javascript',
  ts: 'typescript',
  typescriptreact: 'typescript',
  'c++': 'cpp',
  cplusplus: 'cpp',
  cxx: 'cpp',
  golang: 'go',
  jvm: 'java',
  html: 'html',
  css: 'css',
  sql: 'sql',
};

const NON_PROGRAMS = new Set(['html', 'css', 'sql']);

export function canonicalLanguage(raw: string): string {
  const value = (raw || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[value] ?? value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseShapeError(`Brain returned an unexpected ${label}.`);
  }
  return value as Record<string, unknown>;
}

function failureMessage(err: unknown): string {
  if (err instanceof BrainHttpError || err instanceof ResponseShapeError) {
    return err.message;
  }
  return 'EYRA request failed.';
}

function failurePhase(err: unknown): 'timeout' | 'malformed' | 'http' {
  if (err instanceof ResponseShapeError) {
    return 'malformed';
  }
  if (err instanceof BrainHttpError && err.timedOut) {
    return 'timeout';
  }
  return 'http';
}

export function parseRuntimes(body: unknown): RuntimeCapability[] {
  const record = asRecord(body, 'runtimes response');
  if (!Array.isArray(record.runtimes)) {
    throw new ResponseShapeError('Brain runtimes response is missing runtimes.');
  }
  return record.runtimes.map((item) => {
    const row = asRecord(item, 'runtime');
    if (typeof row.language !== 'string' || typeof row.available !== 'boolean') {
      throw new ResponseShapeError('A runtime entry is missing language or available.');
    }
    return {
      language: row.language,
      displayName: typeof row.displayName === 'string' ? row.displayName : row.language,
      runtime: typeof row.runtime === 'string' ? row.runtime : null,
      available: row.available,
      version: typeof row.version === 'string' ? row.version : null,
      detail: typeof row.detail === 'string' ? row.detail : null,
      executable: typeof row.executable === 'boolean' ? row.executable : true,
    };
  });
}

export function executionBlockReason(language: string, runtimes: RuntimeCapability[]): string | null {
  const lang = canonicalLanguage(language);
  const row = runtimes.find((item) => canonicalLanguage(item.language) === lang);
  if (NON_PROGRAMS.has(lang)) {
    const detail = row?.detail || 'The Brain lists this language as analyze-only.';
    return `${language} is not executed as a program. ${detail}`;
  }
  if (!row) {
    return `The Brain has no runtime for ${language}. Nothing was executed.`;
  }
  if (!row.executable || !row.available) {
    return row.detail || `${row.displayName} is not available on the Brain machine. Nothing was executed.`;
  }
  return null;
}

export function buildExecuteRequest(context: ContextOk): ExecuteRequestBody {
  return {
    code: context.code,
    language: context.language,
    file_name: context.fileName,
  };
}

export function buildPerformanceRequest(context: ContextOk): PerformanceRequestBody {
  return {
    code: context.code,
    language: context.language,
    file_name: context.fileName,
    target_time: 'O(n)',
    target_space: 'O(1)',
  };
}

export function buildGenerateRequest(context: ContextOk): Pick<PerformanceRequestBody, 'code' | 'language' | 'file_name'> {
  return {
    code: context.code,
    language: context.language,
    file_name: context.fileName,
  };
}

function parseCoverage(record: Record<string, unknown>): CoverageView {
  const raw = record.coverage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'unavailable',
      measured: false,
      percent: null,
      reason: 'Coverage instrumentation was not reported by the runner.',
      coveredLines: null,
      totalLines: null,
    };
  }
  const row = raw as Record<string, unknown>;
  return {
    status: typeof row.status === 'string' ? row.status : 'unavailable',
    measured: row.measured === true,
    percent: typeof row.percent === 'number' && Number.isFinite(row.percent) ? row.percent : null,
    reason: typeof row.reason === 'string' ? row.reason : 'Coverage instrumentation was not reported by the runner.',
    coveredLines: typeof row.covered_lines === 'number' ? row.covered_lines : null,
    totalLines: typeof row.total_lines === 'number' ? row.total_lines : null,
  };
}

function parseCase(item: unknown): ReviewedCase {
  const row = asRecord(item, 'test case');
  if (typeof row.id !== 'number' || !Number.isInteger(row.id) || row.id <= 0) {
    throw new ResponseShapeError('A test case is missing a positive integer id.');
  }
  return {
    id: row.id,
    description: typeof row.description === 'string' ? row.description : '',
    call: typeof row.call === 'string' && row.call.trim() ? row.call : null,
    status: typeof row.status === 'string' ? row.status : '',
    raw: row,
  };
}

function optionalCount(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ResponseShapeError(`Brain test response has an invalid ${key} count.`);
  }
  return value;
}

function requiredCount(record: Record<string, unknown>, key: string): number {
  const value = optionalCount(record, key);
  if (value === null) {
    throw new ResponseShapeError(`Brain test response is missing ${key}.`);
  }
  return value;
}

export function suiteSummary(counts: TestCounts): { passing: boolean; headline: string } {
  const evaluated = counts.passed + counts.failed;
  if (counts.total <= 0 || evaluated <= 0) {
    return {
      passing: false,
      headline: counts.skipped > 0 || counts.executed > 0
        ? 'No tests were evaluated. Cases without an evaluated expected result are not counted as passed. This is not a passing suite.'
        : 'No tests were evaluated. This is not a passing suite.',
    };
  }
  if (
    counts.passed > 0
    && counts.passed === counts.total
    && counts.failed === 0
    && counts.error === 0
    && counts.skipped === 0
    && counts.executed === 0
    && counts.not_run === 0
  ) {
    return { passing: true, headline: `${counts.passed} passed.` };
  }
  return {
    passing: false,
    headline: `Passed ${counts.passed} · Failed ${counts.failed} · Error ${counts.error} · Skipped ${counts.skipped} · Not run ${counts.not_run}. Cases without an evaluated expected result are not counted as passed.`,
  };
}

export function parseGeneratedTests(body: unknown): GeneratedTestsView {
  const record = asRecord(body, 'generated tests');
  if (!Array.isArray(record.cases)) {
    throw new ResponseShapeError('Brain test generation did not return a cases list.');
  }
  const cases = record.cases.map(parseCase);
  const total = optionalCount(record, 'total');
  const passed = optionalCount(record, 'passed');
  const failed = optionalCount(record, 'failed');
  const notRun = optionalCount(record, 'not_run');
  const notice = typeof record.notice === 'string' && record.notice.trim() ? record.notice.trim() : null;
  const countText = notice
    ? notice
    : cases.length === 0
      ? 'The Brain returned no test cases.'
      : `Generated ${cases.length} case(s) for review. They have not been run.`;
  const returned = [
    passed === null ? '' : `passed ${passed}`,
    failed === null ? '' : `failed ${failed}`,
    notRun === null ? '' : `not_run ${notRun}`,
    total === null ? '' : `total ${total}`,
  ].filter(Boolean).join(', ');
  return {
    cases,
    total,
    passed,
    failed,
    notRun,
    headline: notice ? countText : returned ? `${countText} Returned counts: ${returned}.` : countText,
    mode: typeof record.mode === 'string' ? record.mode : (cases[0]?.raw.mode as string || 'clarification'),
    target: typeof record.target === 'string' ? record.target : null,
    coverage: parseCoverage(record),
    notice,
    language: typeof record.language === 'string' ? record.language : '',
    fileName: typeof record.file_name === 'string' ? record.file_name : '',
  };
}

export function parseTestRun(body: unknown): TestRunView {
  const record = asRecord(body, 'test run');
  if (!Array.isArray(record.cases)) {
    throw new ResponseShapeError('Brain test run did not return a cases list.');
  }
  const counts: TestCounts = {
    total: requiredCount(record, 'total'),
    passed: requiredCount(record, 'passed'),
    failed: requiredCount(record, 'failed'),
    error: optionalCount(record, 'error') ?? 0,
    skipped: optionalCount(record, 'skipped') ?? 0,
    executed: optionalCount(record, 'executed') ?? 0,
    not_run: requiredCount(record, 'not_run'),
  };
  const summary = suiteSummary(counts);
  return {
    cases: record.cases.map(parseCase),
    counts,
    log: typeof record.log === 'string' ? record.log : '',
    passing: summary.passing,
    headline: summary.headline,
    passRatePercent: typeof record.pass_rate_percent === 'number' ? record.pass_rate_percent : null,
    coverage: parseCoverage(record),
    language: typeof record.language === 'string' ? record.language : '',
    fileName: typeof record.file_name === 'string' ? record.file_name : '',
  };
}

export function parseExecuteResponse(body: unknown): ExecuteView {
  const record = asRecord(body, 'execution response');
  if (typeof record.ok !== 'boolean' || typeof record.exit_code !== 'number') {
    throw new ResponseShapeError('Brain execution response is missing ok or exit_code.');
  }
  if (typeof record.stdout !== 'string' || typeof record.stderr !== 'string') {
    throw new ResponseShapeError('Brain execution response is missing stdout or stderr.');
  }
  const runtimeAvailable = typeof record.runtime_available === 'boolean' ? record.runtime_available : null;
  const status = typeof record.status === 'string' ? record.status : null;
  const timedOut = record.timed_out === true || status === 'TIMEOUT';
  const unavailable = runtimeAvailable === false || status === 'RUNTIME_UNAVAILABLE';
  const success = record.ok === true && !timedOut && !unavailable;
  let headline = 'The program finished.';
  if (unavailable) {
    headline = 'The Brain runtime was unavailable. This was not a successful execution.';
  } else if (timedOut) {
    headline = 'The Brain reported a timeout. This was not a successful execution.';
  } else if (!record.ok) {
    headline = 'The program ran and reported a failure. This was not a successful execution.';
  }
  return {
    ok: record.ok,
    exitCode: record.exit_code,
    stdout: record.stdout,
    stderr: record.stderr,
    errorType: typeof record.error_type === 'string' ? record.error_type : null,
    language: typeof record.language === 'string' ? record.language : null,
    runtime: typeof record.runtime === 'string' ? record.runtime : null,
    runtimeVersion: typeof record.runtime_version === 'string' ? record.runtime_version : null,
    runtimeAvailable,
    status,
    phase: typeof record.phase === 'string' ? record.phase : null,
    timedOut,
    durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : null,
    diagnostics: typeof record.diagnostics === 'string' ? record.diagnostics : null,
    success,
    headline,
  };
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ResponseShapeError(`Brain ${label} is not a list of strings.`);
  }
  return value;
}

export function parsePerformance(body: unknown): PerformanceView {
  const record = asRecord(body, 'performance analysis');
  const complexity = asRecord(record.complexity, 'complexity');
  if (typeof complexity.time !== 'string' || typeof complexity.space !== 'string') {
    throw new ResponseShapeError('Brain performance analysis is missing complexity time or space.');
  }
  const targets = record.targets && typeof record.targets === 'object' && !Array.isArray(record.targets)
    ? record.targets as Record<string, unknown>
    : {};
  const tests = record.tests && typeof record.tests === 'object' && !Array.isArray(record.tests)
    ? record.tests as Record<string, unknown>
    : null;
  return {
    fileName: typeof record.file_name === 'string' ? record.file_name : '',
    language: typeof record.language === 'string' ? record.language : '',
    time: complexity.time,
    space: complexity.space,
    timeLabel: typeof complexity.time_label === 'string' ? complexity.time_label : '',
    spaceLabel: typeof complexity.space_label === 'string' ? complexity.space_label : '',
    timeSeverity: typeof complexity.time_severity === 'string' ? complexity.time_severity : '',
    spaceSeverity: typeof complexity.space_severity === 'string' ? complexity.space_severity : '',
    notes: stringList(complexity.notes, 'complexity notes'),
    functionName: typeof complexity.function_name === 'string' ? complexity.function_name : null,
    pattern: typeof complexity.pattern === 'string' ? complexity.pattern : null,
    basis: typeof complexity.basis === 'string' ? complexity.basis : '',
    basisLabel: typeof complexity.basis_label === 'string' ? complexity.basis_label : '',
    targetTime: typeof targets.time === 'string' ? targets.time : '',
    targetSpace: typeof targets.space === 'string' ? targets.space : '',
    targetGoal: typeof targets.goal === 'string' ? targets.goal : '',
    unrunCases: tests ? optionalCount(tests, 'not_run') : null,
    payloadNotes: stringList(record.notes, 'performance notes'),
  };
}

export function parseOptimize(body: unknown): OptimizeView {
  const record = asRecord(body, 'optimization response');
  const suggestion = asRecord(record.suggestion, 'suggestion');
  if (typeof suggestion.applied_transform !== 'boolean') {
    throw new ResponseShapeError('Brain optimization response is missing applied_transform.');
  }
  return {
    fileName: typeof record.file_name === 'string' ? record.file_name : '',
    language: typeof record.language === 'string' ? record.language : '',
    currentTime: typeof suggestion.current_time === 'string' ? suggestion.current_time : '',
    currentSpace: typeof suggestion.current_space === 'string' ? suggestion.current_space : '',
    optimizedTime: typeof suggestion.optimized_time === 'string' ? suggestion.optimized_time : '',
    optimizedSpace: typeof suggestion.optimized_space === 'string' ? suggestion.optimized_space : '',
    reasons: stringList(suggestion.reasons, 'optimization reasons'),
    appliedTransform: suggestion.applied_transform,
    reasoningSource: typeof suggestion.reasoning_source === 'string' ? suggestion.reasoning_source : '',
    optimizedCode: typeof suggestion.optimized_code === 'string' ? suggestion.optimized_code : '',
    functionName: typeof suggestion.function_name === 'string' ? suggestion.function_name : null,
    pattern: typeof suggestion.pattern === 'string' ? suggestion.pattern : null,
  };
}

export async function executeCurrentFileFlow(deps: {
  context: ContextOk | ContextErr;
  loadRuntimes: () => Promise<unknown>;
  confirm: () => Promise<boolean>;
  execute: (body: ExecuteRequestBody) => PromiseLike<unknown>;
}): Promise<ExecuteFlowResult> {
  if (!deps.context.ok) {
    return { phase: 'blocked', requested: false, success: false, message: deps.context.message };
  }
  let runtimes: RuntimeCapability[];
  try {
    runtimes = parseRuntimes(await deps.loadRuntimes());
  } catch (err) {
    return caught(err, false);
  }
  const block = executionBlockReason(deps.context.language, runtimes);
  if (block) {
    return { phase: 'unsupported', requested: false, success: false, message: block };
  }
  if (!await deps.confirm()) {
    return { phase: 'cancelled', requested: false, success: false, message: 'Execution cancelled. No code was sent.' };
  }
  const body = buildExecuteRequest(deps.context);
  try {
    const view = parseExecuteResponse(await deps.execute(body));
    return { phase: 'result', requested: true, success: view.success, body, view };
  } catch (err) {
    return caught(err, true);
  }
}

export async function generateTestsFlow(deps: {
  context: ContextOk | ContextErr;
  generate: (body: Pick<PerformanceRequestBody, 'code' | 'language' | 'file_name'>) => Promise<unknown>;
}): Promise<GenerateFlowResult> {
  if (!deps.context.ok) {
    return { phase: 'blocked', requested: false, success: false, message: deps.context.message };
  }
  const body = buildGenerateRequest(deps.context);
  try {
    const view = parseGeneratedTests(await deps.generate(body));
    return { phase: 'review', requested: true, success: false, body, view };
  } catch (err) {
    return caught(err, true);
  }
}

export function planTestRun(input: {
  context: ContextOk | ContextErr;
  reviewed: ReviewedTests | null;
  selectedIds: number[];
  confirmed: boolean;
}): { request: RunTestsRequestBody | null; failure: FlowFailure | null } {
  if (!input.context.ok) {
    return {
      request: null,
      failure: { phase: 'blocked', requested: false, success: false, message: input.context.message },
    };
  }
  if (!input.reviewed) {
    return {
      request: null,
      failure: {
        phase: 'blocked',
        requested: false,
        success: false,
        message: 'Generate tests and review them before running any case.',
      },
    };
  }
  if (input.reviewed.code !== input.context.code || input.reviewed.language !== input.context.language || input.reviewed.fileName !== input.context.fileName) {
    return {
      request: null,
      failure: {
        phase: 'blocked',
        requested: false,
        success: false,
        message: 'The file changed after the tests were generated. Generate tests again before running them.',
      },
    };
  }
  if (input.reviewed.cases.length === 0) {
    return {
      request: null,
      failure: {
        phase: 'blocked',
        requested: false,
        success: false,
        message: 'The Brain returned no test cases to run.',
      },
    };
  }
  const known = new Set(input.reviewed.cases.map((item) => item.id));
  const caseIds = input.selectedIds.filter((id) => known.has(id));
  if (caseIds.length === 0) {
    return {
      request: null,
      failure: {
        phase: 'blocked',
        requested: false,
        success: false,
        message: 'No test cases were selected. Nothing was sent.',
      },
    };
  }
  if (!input.confirmed) {
    return {
      request: null,
      failure: { phase: 'cancelled', requested: false, success: false, message: 'Test run cancelled. No code was sent.' },
    };
  }
  return {
    request: {
      code: input.context.code,
      language: input.context.language,
      file_name: input.context.fileName,
      cases: input.reviewed.cases.map((item) => item.raw),
      case_ids: caseIds,
    },
    failure: null,
  };
}

export async function runTestsFlow(deps: {
  context: ContextOk | ContextErr;
  reviewed: ReviewedTests | null;
  selectedIds: number[];
  confirm: () => Promise<boolean>;
  run: (body: RunTestsRequestBody) => PromiseLike<unknown>;
}): Promise<TestRunFlowResult> {
  const selected = planTestRun({
    context: deps.context,
    reviewed: deps.reviewed,
    selectedIds: deps.selectedIds,
    confirmed: true,
  });
  if (selected.failure && selected.failure.phase !== 'cancelled') {
    return selected.failure;
  }
  if (!await deps.confirm()) {
    return { phase: 'cancelled', requested: false, success: false, message: 'Test run cancelled. No code was sent.' };
  }
  const planned = planTestRun({
    context: deps.context,
    reviewed: deps.reviewed,
    selectedIds: deps.selectedIds,
    confirmed: true,
  });
  if (!planned.request) {
    return planned.failure ?? {
      phase: 'blocked',
      requested: false,
      success: false,
      message: 'No test cases were sent.',
    };
  }
  try {
    const view = parseTestRun(await deps.run(planned.request));
    return {
      phase: 'result',
      requested: true,
      success: view.passing,
      passing: view.passing,
      body: planned.request,
      view,
    };
  } catch (err) {
    return caught(err, true);
  }
}
