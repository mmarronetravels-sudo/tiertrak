// apiFetch — global wrapper that owns three pieces of contract for every
// TierTrak frontend request:
//
//   1. credentials: 'include' on every request — the auth_token JWT cookie
//      is httpOnly, so without this flag the cookie does not ride along
//      and requireAuth returns 401. Mirrors Section504/api.js send().
//
//   2. CSRF header on state-changing methods (anything outside
//      GET/HEAD/OPTIONS — matches middleware/csrfProtection.js
//      ignoredMethods). The csrf_token cookie is set by the backend on
//      POST /login, POST /google, and GET /me; the cookie is intentionally
//      NOT httpOnly (see csrfProtection.js getCookieOptions) so this
//      wrapper can read it from document.cookie and echo the value in the
//      X-CSRF-Token header. If no cookie is present (logged-out flows,
//      pre-/me bootstrap) the header is omitted; the request still goes
//      through and the backend handles missing-token via its skip-list
//      (canonical source: SKIP_PATH_PREFIXES in
//      middleware/csrfProtection.js, currently lines 109-118 — keep
//      that list as the single source of truth; do not mirror it here)
//      or by returning 403 once enforce mode is on.
//
//   3. FormData enforcement: when body is FormData, the wrapper actively
//      deletes any caller-set Content-Type before fetch so the browser
//      sets 'multipart/form-data; boundary=...' itself. Setting
//      Content-Type manually for FormData strips the boundary and the
//      multer parser on the server fails. JSON callers continue to set
//      their own Content-Type, same as before.
//
// Callers receive the raw Response — they continue to call .ok, .json(),
// and handle errors themselves. The wrapper never reads the body.
// (Compare Section504/api.js send(), which owns response parsing for
// that feature; this global wrapper deliberately does not.)

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE_NAME = 'csrf_token';

function readCsrfTokenFromCookie() {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie;
  if (!cookie) return null;
  const parts = cookie.split('; ');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === CSRF_COOKIE_NAME) {
      const fullValue = decodeURIComponent(part.slice(eq + 1));
      // csrf-csrf v3 stores `${token}|${hash}` in the cookie. The
      // X-CSRF-Token header must contain only the bare token portion —
      // the library splits the cookie on '|' server-side and compares
      // the header to the cookie's left half. Returning the full value
      // would defeat the contract on every state-changing request.
      const delimiterIdx = fullValue.indexOf('|');
      if (delimiterIdx === -1) return null;
      return fullValue.slice(0, delimiterIdx);
    }
  }
  return null;
}

export function apiFetch(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCsrfTokenFromCookie();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  if (init.body instanceof FormData) {
    headers.delete('Content-Type');
  }

  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}
