/**
 * Brain → Code Audit request authentication.
 * A caller must present HMAC(secret, `${userId}.${ts}`). The user id header alone is ignored.
 */
import crypto from 'crypto';

const MAX_SKEW_S = 300;

export function auditSecret() {
  return String(process.env.EYRA_AUDIT_INTERNAL_SECRET || '').trim();
}

export function signAuditUser(userId, ts, secret = auditSecret()) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${userId}.${ts}`)
    .digest('hex');
}

export function verifyAuditHeaders(headers = {}) {
  const secret = auditSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: 'Audit engine internal auth is not configured (EYRA_AUDIT_INTERNAL_SECRET)',
    };
  }
  const userId = headers['x-eyra-user-id'];
  const ts = headers['x-eyra-ts'];
  const sig = headers['x-eyra-sig'];
  if (!userId || !ts || !sig) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_SKEW_S) {
    return { ok: false, status: 401, error: 'Authentication expired' };
  }
  const expected = signAuditUser(String(userId), String(ts), secret);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Invalid authentication' };
  }
  return { ok: true, userId: String(userId) };
}

export function requireAuditUser(req, res, next) {
  const result = verifyAuditHeaders(req.headers || {});
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  req.eyraUserId = result.userId;
  return next();
}

/**
 * Occupied-port policy: never kill another process. Do not switch ports silently.
 * @returns {{ action: 'fail', message: string }}
 */
export function handleBindError(err, port) {
  if (err && err.code === 'EADDRINUSE') {
    return {
      action: 'fail',
      message:
        `Port ${port} is already in use. EYRA will not stop the process listening there. ` +
        'Free the port or set PORT and the Brain EYRA_AUDIT_BASE_URL to the same free port.',
    };
  }
  return {
    action: 'fail',
    message: err?.message || 'Audit server failed to start',
  };
}
