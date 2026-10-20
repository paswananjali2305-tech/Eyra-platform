export type AuthUser = {
  id: string;
  email: string;
  username: string;
  display_name: string;
};

export type AuthSession = {
  accessToken: string;
  tokenType: string;
  user: AuthUser;
};

export type EvidenceItem = {
  kind: string;
  detail: string;
  location?: string | null;
};

export type TimelineEvent = {
  step: string;
  detail: string;
  status?: string;
};

export type AnalyzeResult = {
  session_id: string;
  status: string;
  error_type: string;
  error_summary: string;
  root_cause: string;
  explanation: string;
  evidence: EvidenceItem[];
  execution_timeline: TimelineEvent[];
  suggested_correction: {
    summary: string;
    corrected_code: string;
    diff_unified?: string | null;
    apply_mode: string;
  };
  verification: {
    status: string;
    method: string;
    detail: string;
    is_hypothesis_only: boolean;
  };
  reasoning_source: string;
  reasoning_note: string;
  file_name: string;
  language: string;
  code_snippet: string;
  terminal_output: string;
  stack_trace: string;
  project_name: string;
  created_at: string;
  related_session_ids: string[];
  confidence: number | null;
};

export class ResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseShapeError';
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseShapeError(`Brain returned an unexpected ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ResponseShapeError(`Brain ${label} is missing ${key}.`);
  }
  return value;
}

export function parseAuthUser(body: unknown): AuthUser {
  const userRecord = asRecord(body, 'user');
  return {
    id: requiredString(userRecord, 'id', 'user'),
    email: typeof userRecord.email === 'string' ? userRecord.email : '',
    username: requiredString(userRecord, 'username', 'user'),
    display_name: typeof userRecord.display_name === 'string' ? userRecord.display_name : '',
  };
}

export function parseAuthSession(body: unknown): AuthSession {
  const record = asRecord(body, 'sign-in response');
  return {
    accessToken: requiredString(record, 'access_token', 'sign-in response'),
    tokenType: typeof record.token_type === 'string' ? record.token_type : 'bearer',
    user: parseAuthUser(record.user),
  };
}

export function parseAnalyzeResult(body: unknown): AnalyzeResult {
  const record = asRecord(body, 'analysis response');
  const correction = asRecord(record.suggested_correction, 'suggested correction');
  const verification = asRecord(record.verification, 'verification');
  const timeline = Array.isArray(record.execution_timeline)
    ? record.execution_timeline.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const row = item as Record<string, unknown>;
      return [{
        step: typeof row.step === 'string' ? row.step : '',
        detail: typeof row.detail === 'string' ? row.detail : '',
        status: typeof row.status === 'string' ? row.status : '',
      }];
    })
    : [];
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const row = item as Record<string, unknown>;
      return [{
        kind: typeof row.kind === 'string' ? row.kind : '',
        detail: typeof row.detail === 'string' ? row.detail : '',
        location: typeof row.location === 'string' ? row.location : null,
      }];
    })
    : [];
  return {
    session_id: requiredString(record, 'session_id', 'analysis response'),
    status: typeof record.status === 'string' ? record.status : '',
    error_type: typeof record.error_type === 'string' ? record.error_type : '',
    error_summary: typeof record.error_summary === 'string' ? record.error_summary : '',
    root_cause: typeof record.root_cause === 'string' ? record.root_cause : '',
    explanation: typeof record.explanation === 'string' ? record.explanation : '',
    evidence,
    execution_timeline: timeline,
    suggested_correction: {
      summary: typeof correction.summary === 'string' ? correction.summary : '',
      corrected_code: typeof correction.corrected_code === 'string' ? correction.corrected_code : '',
      diff_unified: typeof correction.diff_unified === 'string' ? correction.diff_unified : null,
      apply_mode: typeof correction.apply_mode === 'string' ? correction.apply_mode : '',
    },
    verification: {
      status: typeof verification.status === 'string' ? verification.status : '',
      method: typeof verification.method === 'string' ? verification.method : '',
      detail: typeof verification.detail === 'string' ? verification.detail : '',
      is_hypothesis_only: verification.is_hypothesis_only !== false,
    },
    reasoning_source: typeof record.reasoning_source === 'string' ? record.reasoning_source : '',
    reasoning_note: typeof record.reasoning_note === 'string' ? record.reasoning_note : '',
    file_name: typeof record.file_name === 'string' ? record.file_name : '',
    language: typeof record.language === 'string' ? record.language : '',
    code_snippet: typeof record.code_snippet === 'string' ? record.code_snippet : '',
    terminal_output: typeof record.terminal_output === 'string' ? record.terminal_output : '',
    stack_trace: typeof record.stack_trace === 'string' ? record.stack_trace : '',
    project_name: typeof record.project_name === 'string' ? record.project_name : '',
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    related_session_ids: Array.isArray(record.related_session_ids)
      ? record.related_session_ids.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [],
    confidence: typeof record.confidence === 'number' ? record.confidence : null,
  };
}
