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
//      or by returning 403 once enforce mode is on.
//
//   3. FormData branch: when body is FormData, the wrapper does NOT touch
//      Content-Type so the browser can set
//      'multipart/form-data; boundary=...' itself. Setting Content-Type
//      manually for FormData strips the boundary and the multer parser
//      on the server fails. JSON callers continue to set their own
//      Content-Type, same as before.
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
      return decodeURIComponent(part.slice(eq + 1));
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

  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}
