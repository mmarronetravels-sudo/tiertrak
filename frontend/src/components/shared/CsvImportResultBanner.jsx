import { CheckCircle, AlertCircle } from 'lucide-react';

// Shared upload-result banner for the student and staff CSV importers.
// Extracted to deduplicate the two near-identical render blocks at
// App.jsx (the student admin tab and the staff admin tab). The state
// machine is the staff "5-state" form (success | partial-insert |
// partial-email | partial-both | failure); when entityType === 'student'
// the backend response shape omits emailErrors, so partial-email and
// partial-both are unreachable by construction.
//
// §4B doctrine: the data displayed here is the operator's own upload,
// rendered back to the same operator session. The suffix ladders below
// preserve SHAPE B (within-upload dedup) narrowing per the privacy-
// reviewer ruling on commit 01dbb7f — see PRIVACY_REVIEW.md. Do NOT
// widen the ladder to assume both wide + narrow fields are populated;
// the within-upload-dedup error path intentionally narrows data to a
// single identifier ({external_id} for student, {email} for staff) and
// the fallback below must continue to handle that narrow shape.
//
// Tailwind class strings are full literal classnames in the state
// object — do not refactor to dynamic `bg-${...}` construction, which
// Tailwind purges and the banners would lose styling.

function getResultState(result) {
  if (!result || result.error) return null;
  const imported = result.summary?.imported ?? 0;
  const errs = result.errors?.length ?? 0;
  const emailErrs = result.emailErrors?.length ?? 0;
  if (imported > 0 && errs === 0 && emailErrs === 0) {
    return { kind: 'success', bannerClass: 'bg-emerald-50 border-emerald-200', textClass: 'text-emerald-800', rowBorderClass: 'border-emerald-100' };
  }
  if (imported > 0 && errs === 0 && emailErrs > 0) {
    return { kind: 'partial-email', bannerClass: 'bg-amber-50 border-amber-200', textClass: 'text-amber-800', rowBorderClass: 'border-amber-100' };
  }
  if (imported > 0 && errs > 0 && emailErrs === 0) {
    return { kind: 'partial-insert', bannerClass: 'bg-amber-50 border-amber-200', textClass: 'text-amber-800', rowBorderClass: 'border-amber-100' };
  }
  if (imported > 0 && errs > 0 && emailErrs > 0) {
    return { kind: 'partial-both', bannerClass: 'bg-amber-50 border-amber-200', textClass: 'text-amber-800', rowBorderClass: 'border-amber-100' };
  }
  return { kind: 'failure', bannerClass: 'bg-red-50 border-red-200', textClass: 'text-red-800', rowBorderClass: 'border-red-100' };
}

function getHeadline(state, entityType, totalRows, importedCount, errs, emailErrs) {
  if (entityType === 'staff') {
    if (state.kind === 'success') return `Imported ${importedCount} of ${totalRows} staff members.`;
    if (state.kind === 'partial-insert') return `Imported ${importedCount} of ${totalRows} staff. ${errs.length} failed to import.`;
    if (state.kind === 'partial-email') return `Imported ${importedCount} of ${totalRows} staff. ${emailErrs.length} setup emails failed to send.`;
    if (state.kind === 'partial-both') return `Imported ${importedCount} of ${totalRows} staff. ${errs.length} failed to import, ${emailErrs.length} setup emails failed to send.`;
    if (state.kind === 'failure') return `No staff imported. ${errs.length} of ${totalRows} failed.`;
  } else {
    if (state.kind === 'success') return `Imported ${importedCount} of ${totalRows} rows.`;
    if (state.kind === 'partial-insert') return `Imported ${importedCount} of ${totalRows} rows. ${errs.length} failed.`;
    if (state.kind === 'failure') return `No rows imported. ${errs.length} of ${totalRows} failed.`;
  }
  return '';
}

function getErrorSuffix(err, entityType) {
  // SHAPE A/B/C superset ladder. emailErrors entries do NOT route here;
  // they render in the emailErrors block below. §4B doctrine: data is
  // operator's own upload, rendered back to the same operator session.
  // SHAPE B (within-upload dedup) intentionally narrows data to a
  // single identifier per §4B — see PRIVACY_REVIEW.md entry for commit
  // 01dbb7f. Do NOT widen the ladder to assume both wide + narrow
  // fields are populated.
  if (entityType === 'staff') {
    if (err.data?.email && err.data?.full_name) return `${err.data.full_name} (${err.data.email})`;
    if (err.data?.email) return err.data.email;
    return null;
  }
  if (err.data?.first_name && err.data?.last_name) return `${err.data.first_name} ${err.data.last_name}`;
  if (err.data?.external_id) return `ID: ${err.data.external_id}`;
  return null;
}

const CsvImportResultBanner = ({ result, entityType }) => {
  if (result === null) return null;

  // Upload-error branch (network / auth failure). Same JSX shape for
  // both entity types.
  if (result.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <h3 className="font-semibold text-red-800">
            Upload failed: {result.error}
          </h3>
        </div>
      </div>
    );
  }

  const state = getResultState(result);
  if (!state) return null;
  if (!result.summary) return null;

  const totalRows = result.summary.totalRows;
  const importedCount = result.summary.imported;
  const errs = result.errors || [];
  const emailErrs = result.emailErrors || [];

  return (
    <div className={`${state.bannerClass} border rounded-xl p-4`}>
      <div className="flex items-center gap-2">
        {state.kind === 'success'
          ? <CheckCircle className="w-5 h-5 text-emerald-600" />
          : <AlertCircle className={`w-5 h-5 ${state.kind === 'failure' ? 'text-red-600' : 'text-amber-600'}`} />}
        <h3 className={`font-semibold ${state.textClass}`}>
          {getHeadline(state, entityType, totalRows, importedCount, errs, emailErrs)}
        </h3>
      </div>
      {entityType === 'staff' && state.kind === 'success' && (
        <p className="mt-2 text-sm text-emerald-700">Staff have 7 days to set their password before the link expires.</p>
      )}
      {(state.kind === 'partial-insert' || state.kind === 'partial-both' || state.kind === 'failure') && errs.length > 0 && (
        <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
          {errs.map((err, i) => {
            const suffix = getErrorSuffix(err, entityType);
            return (
              <div key={`err-${err.row}-${i}`} className={`flex items-center justify-between p-2 bg-white rounded-lg border ${state.rowBorderClass}`}>
                <div>
                  <span className="font-medium text-slate-800">Row {err.row}</span>
                  <span className="text-slate-400 mx-2">—</span>
                  <span className="text-slate-600">{err.error}</span>
                </div>
                {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
              </div>
            );
          })}
        </div>
      )}
      {entityType === 'staff' && (state.kind === 'partial-email' || state.kind === 'partial-both') && emailErrs.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-amber-700 mb-2">Emails failed to send ({emailErrs.length}):</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {emailErrs.map((entry, i) => (
              <div key={`email-${entry.row}-${i}`} className={`flex items-center justify-between p-2 bg-white rounded-lg border ${state.rowBorderClass}`}>
                <div>
                  <span className="font-medium text-slate-800">Row {entry.row}</span>
                  <span className="text-slate-400 mx-2">—</span>
                  <span className="text-slate-600">{entry.email}</span>
                </div>
                <span className="text-xs text-slate-500">{entry.error}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-600 mt-2">Manually trigger a password reset for these users.</p>
        </div>
      )}
    </div>
  );
};

export default CsvImportResultBanner;
