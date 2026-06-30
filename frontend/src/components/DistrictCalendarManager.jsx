import { useEffect, useState } from 'react';
import { CalendarDays, Pencil, Trash2, Plus, X } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { logError } from '../utils/logError';
import { PERIOD_TYPES, LABEL_MAX, EMPTY_FORM, validateForm } from './calendarFormShared';

// DistrictCalendarManager — district_admin management of ONE in-district
// school's academic calendar (term/break date ranges + optional label). The
// district sibling of SchoolCalendarManager: same UI, but it targets
// /api/districts/:id/academic-calendar and sends the explicit school_tenant_id
// (the school picked in DistrictCalendarReminderPanel) on EVERY request.
//
// §5: the target school is NEVER invented client-side — schoolTenantId comes
// from the server's GET /districts/:id/schools list, threaded down as a prop,
// and the server re-validates on every call that the school belongs to this
// district (resolveDistrictSchool). Unlike the school surface (which sends NO
// school id and lets the server resolve the caller's own building), the
// district surface MUST send school_tenant_id because a district has many
// schools. PERIOD_TYPES/validateForm are shared logic; the markup mirrors the
// school card.
//
// §4B: this surface carries integers, calendar dates, an enum, and the optional
// non-PII label only. The school NAME is shown in the heading for the admin's
// orientation but is NEVER placed in a log line, a URL, or an error body — only
// the integer school_tenant_id rides the query string. logError carries a
// static tag + the error object; user-facing copy is generic.

export default function DistrictCalendarManager({ API_URL, districtId, schoolTenantId, schoolName }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isPending, setIsPending] = useState(false);

  const base = `${API_URL}/districts/${districtId}/academic-calendar`;

  const load = async (signal) => {
    try {
      const res = await apiFetch(`${base}?school_tenant_id=${schoolTenantId}`);
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
      logError(err, '[DistrictCalendarManager:load]');
      if (!signal?.cancelled) {
        setLoadError(true);
        setLoaded(true);
      }
    }
  };

  // Reload whenever the picked school changes. Reset transient form state so a
  // half-open editor never carries across a school switch.
  useEffect(() => {
    if (schoolTenantId == null) return;
    setLoaded(false);
    setShowForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL, districtId, schoolTenantId]);

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
      // §5: the explicit school target on every write. Server re-validates it.
      school_tenant_id: schoolTenantId,
      period_type: form.period_type,
      start_date: form.start_date,
      end_date: form.end_date,
      // Omit label entirely when blank — the server treats absent/empty as null.
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    };
    const isEdit = form.id !== null;

    try {
      const res = await apiFetch(
        `${base}${isEdit ? `/${form.id}` : ''}`,
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
      logError(err, '[DistrictCalendarManager:submit]');
      setFormError('Connection error.');
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (row) => {
    const when = `${String(row.start_date).slice(0, 10)} – ${String(row.end_date).slice(0, 10)}`;
    if (!window.confirm(`Delete this ${row.period_type} (${when})?`)) return;
    setIsPending(true);
    try {
      // DELETE carries no body; school_tenant_id rides the query string (integer
      // only — never the school name, per §4B).
      const res = await apiFetch(
        `${base}/${row.id}?school_tenant_id=${schoolTenantId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await load();
      } else {
        setLoadError(true);
      }
    } catch (err) {
      logError(err, '[DistrictCalendarManager:delete]');
      setLoadError(true);
    } finally {
      setIsPending(false);
    }
  };

  // No school selected yet (multi-school district, nothing picked). Prompt
  // rather than render an empty card.
  if (schoolTenantId == null) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <CalendarDays size={22} className="text-slate-400 mt-0.5" />
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Academic calendar</h2>
            <p className="text-sm text-slate-500 mt-1">
              Select a school above to manage its terms and breaks.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <CalendarDays size={22} className="text-indigo-600 mt-0.5" />
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Academic calendar</h2>
            <p className="text-sm text-slate-500 mt-1">
              {schoolName ? `Terms and breaks for ${schoolName}. ` : ''}
              Weekly overdue-log reminders skip weeks when the school is out of session.
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
                {PERIOD_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt === 'term' ? 'Term (in session)' : 'Break (out of session)'}
                  </option>
                ))}
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
