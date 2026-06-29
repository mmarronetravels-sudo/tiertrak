import { useEffect, useState } from 'react';
import { CalendarDays, Pencil, Trash2, Plus, X } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';

// SchoolCalendarManager — school_admin self-service UI to view/add/edit/delete
// their OWN building's academic calendar (term/break date ranges + optional
// label). Backed by GET/POST/PUT/DELETE /api/school/academic-calendar
// (routes/schoolAcademicCalendar.js, migration-052). A later read path makes
// the weekly overdue-progress-logs email calendar-aware; this surface is the
// management UI for those rows.
//
// Visibility / trust boundary (both server-authoritative; this FE is UX only):
//   1. The parent (App.jsx AdminView) renders this only for role ==='school_admin'.
//   2. The server re-checks the school_admin role AND resolves the target school
//      from resolveAccessibleTenantIds on EVERY request. This component sends NO
//      school_tenant_id — the server uses the caller's own school (sole-building
//      admin path, every prod tenant today). A caller bypassing this FE hits
//      403/404 server-side; the role checks here never substitute for that.
//
// §5: no school identifier is ever sent from the client. The school the rows
// belong to is whatever resolveOwnSchoolId returns server-side.
//
// §4B: this surface carries integers, calendar dates, an enum (period_type),
// and the optional non-PII label only — no student/staff names, emails, or
// intervention data. logError carries a static tag + the error object; error
// copy shown to the user is generic and never echoes a server body. No
// localStorage.

// Mirrors the server validators in routes/schoolAcademicCalendarCore.js so the
// user gets fast feedback; the server stays the trust boundary and re-validates.
const PERIOD_TYPES = ['term', 'break'];
const LABEL_MAX = 60; // school_academic_calendar.label VARCHAR(60)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_FORM = { id: null, period_type: 'term', start_date: '', end_date: '', label: '' };

// Client-side echo of validateCalendarBody. Returns an error string or null.
// String comparison of YYYY-MM-DD is chronological, same as the server.
function validateForm(form) {
  if (!PERIOD_TYPES.includes(form.period_type)) {
    return "Type must be 'term' or 'break'.";
  }
  if (!DATE_RE.test(form.start_date)) {
    return 'Start date must be a valid date (YYYY-MM-DD).';
  }
  if (!DATE_RE.test(form.end_date)) {
    return 'End date must be a valid date (YYYY-MM-DD).';
  }
  if (form.end_date < form.start_date) {
    return 'End date must be on or after start date.';
  }
  if (form.label && form.label.trim().length > LABEL_MAX) {
    return `Label must be ${LABEL_MAX} characters or fewer.`;
  }
  return null;
}

export default function SchoolCalendarManager({ API_URL }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isPending, setIsPending] = useState(false);

  const load = async (signal) => {
    try {
      const res = await apiFetch(`${API_URL}/school/academic-calendar`);
      if (signal?.cancelled) return;
      if (!res.ok) {
        setLoadError(true);
        setLoaded(true);
        return;
      }
      const data = await res.json();
      if (signal?.cancelled) return;
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setLoadError(false);
      setLoaded(true);
    } catch (err) {
      logError(err, '[SchoolCalendarManager:load]');
      if (!signal?.cancelled) {
        setLoadError(true);
        setLoaded(true);
      }
    }
  };

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      period_type: row.period_type,
      // GET returns date-only strings; slice guards against any time suffix so
      // the <input type="date"> value stays YYYY-MM-DD (no TZ shift).
      start_date: String(row.start_date).slice(0, 10),
      end_date: String(row.end_date).slice(0, 10),
      label: row.label || '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const clientError = validateForm(form);
    if (clientError) {
      setFormError(clientError);
      return;
    }
    setFormError(null);
    setIsPending(true);

    const trimmedLabel = form.label.trim();
    const body = {
      period_type: form.period_type,
      start_date: form.start_date,
      end_date: form.end_date,
      // Omit label entirely when blank — the server treats absent/empty as null.
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    };
    const isEdit = form.id !== null;

    try {
      const res = await apiFetch(
        `${API_URL}/school/academic-calendar${isEdit ? `/${form.id}` : ''}`,
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        closeForm();
        await load();
      } else {
        setFormError(
          isEdit ? 'Could not save changes.' : 'Could not add this entry.'
        );
      }
    } catch (err) {
      logError(err, '[SchoolCalendarManager:submit]');
      setFormError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (row) => {
    const when = `${String(row.start_date).slice(0, 10)} – ${String(row.end_date).slice(0, 10)}`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete this ${row.period_type} (${when})?`)) return;
    setIsPending(true);
    try {
      const res = await apiFetch(
        `${API_URL}/school/academic-calendar/${row.id}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await load();
      } else {
        setLoadError(true);
      }
    } catch (err) {
      logError(err, '[SchoolCalendarManager:delete]');
      setLoadError(true);
    } finally {
      setIsPending(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <CalendarDays size={22} className="text-indigo-600 mt-0.5" />
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Academic calendar</h2>
            <p className="text-sm text-slate-500 mt-1">
              Add your school's terms and breaks. Weekly overdue-log reminders skip
              weeks when your school is out of session.
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={16} /> Add
          </button>
        )}
      </div>

      {loadError && (
        <p className="text-sm text-rose-600 mb-3">
          Could not load the calendar. Please refresh and try again.
        </p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-slate-50 p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {form.id !== null ? 'Edit entry' : 'New entry'}
            </h3>
            <button type="button" onClick={closeForm} title="Cancel" className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm text-slate-600">
              Type
              <select
                value={form.period_type}
                onChange={(e) => setForm({ ...form, period_type: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="term">Term (in session)</option>
                <option value="break">Break (out of session)</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Label (optional)
              <input
                type="text"
                value={form.label}
                maxLength={LABEL_MAX}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Winter Break"
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-slate-600">
              Start date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-slate-600">
              End date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          {formError && <p className="text-sm text-rose-600">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {form.id !== null ? 'Save changes' : 'Add entry'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={isPending}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No calendar entries yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.period_type === 'break'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {row.period_type === 'break' ? 'Break' : 'Term'}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {String(row.start_date).slice(0, 10)} – {String(row.end_date).slice(0, 10)}
                  </p>
                  {row.label && <p className="text-xs text-slate-500">{row.label}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(row)}
                  disabled={isPending}
                  title="Edit"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(row)}
                  disabled={isPending}
                  title="Delete"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
