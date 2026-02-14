import { useState, useEffect } from 'react';
import { X, FileText, Edit, CheckCircle } from 'lucide-react';

const InterventionPlanModal = ({ intervention, onClose, user, selectedStudent, API_URL }) => {
  // All plan state is local to this modal
  const [planTemplate, setPlanTemplate] = useState(null);
  const [planData, setPlanData] = useState({});
  const [planStatus, setPlanStatus] = useState('not_applicable');
  const [planLoading, setPlanLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);

  // Fetch plan data on mount
  useEffect(() => {
    if (intervention?.id) {
      fetchInterventionPlan(intervention.id);
    }
  }, [intervention?.id]);

  // Fetch plan data for a student intervention
  const fetchInterventionPlan = async (interventionId) => {
    try {
      setPlanLoading(true);
      const response = await fetch(API_URL + '/intervention-plans/student-interventions/' + interventionId + '/plan');
      if (response.ok) {
        const data = await response.json();
        setPlanTemplate(data.plan_template);
        setPlanData(data.plan_data || {});
        setPlanStatus(data.plan_status || 'not_applicable');
      }
    } catch (error) {
      console.error('Error fetching intervention plan:', error);
    } finally {
      setPlanLoading(false);
    }
  };

  // Save plan data (auto-save on blur)
  const savePlanData = async (fieldId, value) => {
    if (!intervention) return;
    
    const updatedData = { ...planData, [fieldId]: value };
    setPlanData(updatedData);
    
    try {
      setPlanSaving(true);
      await fetch(API_URL + '/intervention-plans/student-interventions/' + intervention.id + '/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_data: updatedData })
      });
      setPlanStatus('draft');
    } catch (error) {
      console.error('Error saving plan:', error);
    } finally {
      setPlanSaving(false);
    }
  };

  // Mark plan as complete
  const completePlan = async () => {
    if (!intervention || !user) return;
    
    // Check required fields
    if (planTemplate) {
      const missingRequired = [];
      planTemplate.sections.forEach(section => {
        section.fields.forEach(field => {
          if (field.required && !planData[field.id]) {
            missingRequired.push(field.label);
          }
        });
      });
      
      if (missingRequired.length > 0) {
        alert('Please complete these required fields:\n\n\u2022 ' + missingRequired.slice(0, 5).join('\n\u2022 ') + (missingRequired.length > 5 ? '\n\u2022 ... and ' + (missingRequired.length - 5) + ' more' : ''));
        return;
      }
    }
    
    try {
      setPlanSaving(true);
      const response = await fetch(API_URL + '/intervention-plans/student-interventions/' + intervention.id + '/plan/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_data: planData, user_id: user.id })
      });
      
      if (response.ok) {
        setPlanStatus('complete');
        alert('Plan marked as complete!');
      }
    } catch (error) {
      console.error('Error completing plan:', error);
      alert('Error completing plan');
    } finally {
      setPlanSaving(false);
    }
  };

  // Reopen a completed plan for editing
  const reopenPlan = async () => {
    if (!intervention) return;
    
    if (!confirm('This will reopen the plan for editing. Continue?')) return;
    
    try {
      const response = await fetch(API_URL + '/intervention-plans/student-interventions/' + intervention.id + '/plan/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        setPlanStatus('draft');
      }
    } catch (error) {
      console.error('Error reopening plan:', error);
    }
  };

  // Helper function to render plan form fields
  const renderPlanField = (field, isReadOnly) => {
    const value = planData[field.id] || '';
    
    const baseInputClass = "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
    const readOnlyClass = isReadOnly ? "bg-gray-50 cursor-not-allowed" : "bg-white";
    
    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            defaultValue={value}
            placeholder={field.placeholder || ''}
            disabled={isReadOnly}
            onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass}`}
          />
        );
      
      case 'textarea':
        return (
          <textarea
            defaultValue={value}
            placeholder={field.placeholder || ''}
            rows={field.rows || 3}
            disabled={isReadOnly}
            onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass}`}
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            defaultValue={value}
            min={field.min}
            max={field.max}
            disabled={isReadOnly}
            onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass} w-32`}
          />
        );
      
      case 'date':
        return (
          <input
            type="date"
            defaultValue={value}
            disabled={isReadOnly}
            onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass} w-48`}
          />
        );
      
      case 'select':
        return (
          <select
            defaultValue={value}
            disabled={isReadOnly}
            onChange={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass}`}
          >
            <option value="">Select...</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value === true || value === 'true'}
              disabled={isReadOnly}
              onChange={(e) => !isReadOnly && savePlanData(field.id, e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-700">{field.label}</span>
          </label>
        );
      
      case 'checkboxGroup': {
        const selectedItems = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {field.options?.map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedItems.includes(opt)}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    if (isReadOnly) return;
                    const updated = e.target.checked
                      ? [...selectedItems, opt]
                      : selectedItems.filter(i => i !== opt);
                    savePlanData(field.id, updated);
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        );
      }
      
      case 'signature':
        return (
          <div className="space-y-1">
            <input
              type="text"
              defaultValue={value}
              placeholder="Type your full name to sign"
              disabled={isReadOnly}
              onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
              className={`${baseInputClass} ${readOnlyClass} italic`}
              style={{ fontFamily: 'cursive, serif' }}
            />
            {value && (
              <p className="text-xs text-gray-500">
                Signed electronically
              </p>
            )}
          </div>
        );
      
      default:
        return (
          <input
            type="text"
            defaultValue={value}
            disabled={isReadOnly}
            onBlur={(e) => !isReadOnly && savePlanData(field.id, e.target.value)}
            className={`${baseInputClass} ${readOnlyClass}`}
          />
        );
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText size={24} />
              {planTemplate?.name || intervention.intervention_name}
            </h2>
            <p className="text-blue-100 text-sm mt-1">
              {selectedStudent?.first_name} {selectedStudent?.last_name}
              {planStatus === 'complete' && (
                <span className="ml-2 bg-green-500 text-white px-2 py-0.5 rounded text-xs">Complete</span>
              )}
              {planStatus === 'draft' && (
                <span className="ml-2 bg-yellow-500 text-white px-2 py-0.5 rounded text-xs">Draft</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition-colors"
          >
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {planLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Loading plan...</span>
            </div>
          ) : !planTemplate ? (
            <div className="text-center py-12">
              <FileText size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">No plan template available for this intervention.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {planTemplate.sections.map((section, sectionIndex) => (
                <div key={section.id} className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                      <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">
                        {sectionIndex + 1}
                      </span>
                      {section.title}
                    </h3>
                    {section.description && (
                      <p className="text-sm text-gray-500 mt-1 ml-8">{section.description}</p>
                    )}
                  </div>
                  
                  <div className="p-4 space-y-4">
                    {section.fields.map(field => (
                      <div key={field.id}>
                        {field.type !== 'checkbox' && (
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                        )}
                        {renderPlanField(field, planStatus === 'complete')}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="border-t bg-gray-50 px-6 py-4 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {planSaving && (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                Saving...
              </span>
            )}
            {!planSaving && planStatus === 'draft' && (
              <span className="text-green-600">{'\u2713'} Auto-saved</span>
            )}
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Close
            </button>
            
            {planStatus === 'complete' ? (
              <button
                onClick={reopenPlan}
                className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-2"
              >
                <Edit size={18} />
                Edit Plan
              </button>
            ) : planTemplate && (
              <button
                onClick={completePlan}
                disabled={planSaving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <CheckCircle size={18} />
                Mark Complete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterventionPlanModal;