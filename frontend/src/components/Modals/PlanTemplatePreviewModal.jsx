import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { logError } from '../../utils/logError';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Read-only preview of a plan template so staff browsing the intervention
// bank can see what the plan will ask them to fill in before activating it.
const PlanTemplatePreviewModal = ({ templateId, interventionName, user, onClose }) => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!templateId || !user?.tenant_id) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `${API_URL}/intervention-plans/templates/${templateId}?tenant_id=${user.tenant_id}`
        );
        if (!res.ok) {
          if (!cancelled) setError('Unable to load plan');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data.hasPlan || !data.template) {
          setError('This intervention has no plan template yet.');
        } else {
          setPlan(data.template);
        }
      } catch (err) {
        logError('Error loading plan preview:', err);
        if (!cancelled) setError('Unable to load plan');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [templateId, user?.tenant_id]);

  const renderField = (field) => {
    const base = 'w-full px-3 py-2 border rounded-lg bg-slate-50 text-slate-500';
    switch (field.type) {
      case 'text':
        return <input type="text" placeholder={field.placeholder} className={base} disabled />;
      case 'textarea':
        return <textarea placeholder={field.placeholder} rows={field.rows || 3} className={base} disabled />;
      case 'number':
        return <input type="number" placeholder={field.placeholder} className={base} disabled />;
      case 'date':
        return <input type="date" className={base} disabled />;
      case 'select':
        return (
          <select className={base} disabled>
            <option value="">Select...</option>
            {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 text-slate-500">
            <input type="checkbox" disabled /> {field.label}
          </label>
        );
      case 'checkboxGroup':
        return (
          <div className="space-y-1">
            {(field.options || []).map(opt => (
              <label key={opt} className="flex items-center gap-2 text-slate-500">
                <input type="checkbox" disabled /> {opt}
              </label>
            ))}
          </div>
        );
      case 'signature':
        return <div className="border-b-2 border-slate-300 py-2 text-slate-400 italic">Type name to sign</div>;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b bg-indigo-50">
          <div>
            <h2 className="text-xl font-bold text-indigo-800">Plan Preview</h2>
            <p className="text-sm text-indigo-600">{interventionName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="text-center text-slate-500 py-8">Loading...</div>}

          {error && (
            <div className="text-center text-slate-500 py-8">{error}</div>
          )}

          {plan && (
            <>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold text-indigo-800">{plan.name}</h3>
                {plan.version && <p className="text-sm text-indigo-600">Version {plan.version}</p>}
              </div>

              {(plan.sections || []).map(section => (
                <div key={section.id} className="mb-6 border rounded-lg p-4">
                  <h4 className="font-semibold text-slate-800 mb-1">{section.title}</h4>
                  {section.description && (
                    <p className="text-sm text-slate-500 mb-3">{section.description}</p>
                  )}
                  <div className="space-y-3">
                    {(section.fields || []).map(field => (
                      <div key={field.id}>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </label>
                        {renderField(field)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {(!plan.sections || plan.sections.length === 0) && (
                <div className="text-center text-slate-500 py-8">
                  This plan template has no sections yet.
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanTemplatePreviewModal;
