import { useState } from 'react';
import { X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const TemplateEditorModal = ({ template, adminTemplates, onClose, onRefresh }) => {
  // Local state
  const [editorPreviewMode, setEditorPreviewMode] = useState(false);
  const [duplicateSourceId, setDuplicateSourceId] = useState('');
  const [templateEditorForm, setTemplateEditorForm] = useState({
    name: '',
    version: '1.0',
    sections: []
  });
  const [loaded, setLoaded] = useState(false);

  // Load template data on first render
  if (!loaded) {
    if (template.has_plan_template) {
      fetch(`${API_URL}/admin/templates/${template.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setTemplateEditorForm({
              name: data.plan_template?.name || template.name,
              version: data.plan_template?.version || '1.0',
              sections: data.plan_template?.sections || []
            });
          }
        })
        .catch(err => console.error('Error fetching template details:', err));
    } else {
      setTemplateEditorForm({
        name: template.name,
        version: '1.0',
        sections: []
      });
    }
    setLoaded(true);
  }

  // ============================================
  // SAVE / DELETE / DUPLICATE
  // ============================================

  const saveTemplateEditor = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/templates/${template.id}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_template: templateEditorForm })
      });

      if (response.ok) {
        alert('Plan template saved successfully!');
        onRefresh();
        onClose();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error saving template:', error);
      alert('Failed to save template');
    }
  };

  const removeTemplateEditor = async () => {
    if (!confirm(`Are you sure you want to remove the plan template from "${template.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/admin/templates/${template.id}/plan`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('Plan template removed successfully!');
        onRefresh();
        onClose();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error removing template:', error);
      alert('Failed to remove template');
    }
  };

  const duplicateTemplate = async () => {
    if (!duplicateSourceId) return;

    try {
      const response = await fetch(`${API_URL}/admin/templates/${template.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: duplicateSourceId })
      });

      if (response.ok) {
        alert('Template duplicated successfully!');
        // Reload this template's data
        const res = await fetch(`${API_URL}/admin/templates/${template.id}`);
        if (res.ok) {
          const data = await res.json();
          setTemplateEditorForm({
            name: data.plan_template?.name || template.name,
            version: data.plan_template?.version || '1.0',
            sections: data.plan_template?.sections || []
          });
        }
        setDuplicateSourceId('');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error duplicating template:', error);
      alert('Failed to duplicate template');
    }
  };

  // ============================================
  // SECTION MANAGEMENT
  // ============================================

  const addSection = () => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: 'New Section',
      description: '',
      fields: []
    };
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: [...prev.sections, newSection]
    }));
  };

  const updateSection = (sectionIndex, field, value) => {
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, i) =>
        i === sectionIndex ? { ...s, [field]: value } : s
      )
    }));
  };

  const removeSection = (sectionIndex) => {
    if (!confirm('Remove this section and all its fields?')) return;
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== sectionIndex)
    }));
  };

  const moveSectionUp = (sectionIndex) => {
    if (sectionIndex === 0) return;
    setTemplateEditorForm(prev => {
      const sections = [...prev.sections];
      [sections[sectionIndex - 1], sections[sectionIndex]] = [sections[sectionIndex], sections[sectionIndex - 1]];
      return { ...prev, sections };
    });
  };

  const moveSectionDown = (sectionIndex) => {
    setTemplateEditorForm(prev => {
      if (sectionIndex >= prev.sections.length - 1) return prev;
      const sections = [...prev.sections];
      [sections[sectionIndex], sections[sectionIndex + 1]] = [sections[sectionIndex + 1], sections[sectionIndex]];
      return { ...prev, sections };
    });
  };

  // ============================================
  // FIELD MANAGEMENT
  // ============================================

  const addField = (sectionIndex) => {
    const newField = {
      id: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field',
      placeholder: '',
      required: false
    };
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, i) =>
        i === sectionIndex ? { ...s, fields: [...s.fields, newField] } : s
      )
    }));
  };

  const updateField = (sectionIndex, fieldIndex, property, value) => {
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, si) =>
        si === sectionIndex ? {
          ...s,
          fields: s.fields.map((f, fi) =>
            fi === fieldIndex ? { ...f, [property]: value } : f
          )
        } : s
      )
    }));
  };

  const removeField = (sectionIndex, fieldIndex) => {
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, si) =>
        si === sectionIndex ? {
          ...s,
          fields: s.fields.filter((_, fi) => fi !== fieldIndex)
        } : s
      )
    }));
  };

  const moveFieldUp = (sectionIndex, fieldIndex) => {
    if (fieldIndex === 0) return;
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, si) => {
        if (si !== sectionIndex) return s;
        const fields = [...s.fields];
        [fields[fieldIndex - 1], fields[fieldIndex]] = [fields[fieldIndex], fields[fieldIndex - 1]];
        return { ...s, fields };
      })
    }));
  };

  const moveFieldDown = (sectionIndex, fieldIndex) => {
    setTemplateEditorForm(prev => ({
      ...prev,
      sections: prev.sections.map((s, si) => {
        if (si !== sectionIndex) return s;
        if (fieldIndex >= s.fields.length - 1) return s;
        const fields = [...s.fields];
        [fields[fieldIndex], fields[fieldIndex + 1]] = [fields[fieldIndex + 1], fields[fieldIndex]];
        return { ...s, fields };
      })
    }));
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b bg-indigo-50">
          <div>
            <h2 className="text-xl font-bold text-indigo-800">
              {template.has_plan_template ? 'Edit' : 'Create'} Plan Template
            </h2>
            <p className="text-sm text-indigo-600">{template.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditorPreviewMode(!editorPreviewMode)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                editorPreviewMode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {editorPreviewMode ? '✏️ Edit' : '👁️ Preview'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {editorPreviewMode ? (
            /* Preview Mode */
            <div className="max-w-2xl mx-auto">
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold text-indigo-800">{templateEditorForm.name}</h3>
                <p className="text-sm text-indigo-600">Version {templateEditorForm.version}</p>
              </div>

              {templateEditorForm.sections.map((section, sIdx) => (
                <div key={section.id} className="mb-6 border rounded-lg p-4">
                  <h4 className="font-semibold text-slate-800 mb-1">{section.title}</h4>
                  {section.description && (
                    <p className="text-sm text-slate-500 mb-3">{section.description}</p>
                  )}
                  <div className="space-y-3">
                    {section.fields.map(field => (
                      <div key={field.id}>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </label>
                        {field.type === 'text' && (
                          <input type="text" placeholder={field.placeholder} className="w-full px-3 py-2 border rounded-lg bg-slate-50" disabled />
                        )}
                        {field.type === 'textarea' && (
                          <textarea placeholder={field.placeholder} rows={field.rows || 3} className="w-full px-3 py-2 border rounded-lg bg-slate-50" disabled />
                        )}
                        {field.type === 'number' && (
                          <input type="number" placeholder={field.placeholder} className="w-full px-3 py-2 border rounded-lg bg-slate-50" disabled />
                        )}
                        {field.type === 'date' && (
                          <input type="date" className="w-full px-3 py-2 border rounded-lg bg-slate-50" disabled />
                        )}
                        {field.type === 'select' && (
                          <select className="w-full px-3 py-2 border rounded-lg bg-slate-50" disabled>
                            <option value="">Select...</option>
                            {(field.options || []).map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        )}
                        {field.type === 'checkbox' && (
                          <label className="flex items-center gap-2">
                            <input type="checkbox" disabled /> {field.label}
                          </label>
                        )}
                        {field.type === 'checkboxGroup' && (
                          <div className="space-y-1">
                            {(field.options || []).map(opt => (
                              <label key={opt} className="flex items-center gap-2">
                                <input type="checkbox" disabled /> {opt}
                              </label>
                            ))}
                          </div>
                        )}
                        {field.type === 'signature' && (
                          <div className="border-b-2 border-slate-300 py-2 text-slate-400 italic">
                            Type name to sign
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {templateEditorForm.sections.length === 0 && (
                <div className="text-center text-slate-500 py-8">
                  No sections yet. Switch to Edit mode to add sections.
                </div>
              )}
            </div>
          ) : (
            /* Edit Mode */
            <div className="space-y-4">
              {/* Template Metadata */}
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-700 mb-3">Template Settings</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Template Name</label>
                    <input
                      type="text"
                      value={templateEditorForm.name}
                      onChange={(e) => setTemplateEditorForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Version</label>
                    <input
                      type="text"
                      value={templateEditorForm.version}
                      onChange={(e) => setTemplateEditorForm(prev => ({ ...prev, version: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>

                {/* Duplicate from existing */}
                {!template.has_plan_template && adminTemplates.filter(t => t.has_plan_template).length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Or duplicate from existing template:
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={duplicateSourceId}
                        onChange={(e) => setDuplicateSourceId(e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-lg"
                      >
                        <option value="">Select a template to copy...</option>
                        {adminTemplates.filter(t => t.has_plan_template).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={duplicateTemplate}
                        disabled={!duplicateSourceId}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        Duplicate
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sections */}
              <div className="space-y-4">
                {templateEditorForm.sections.map((section, sIdx) => (
                  <div key={section.id} className="border rounded-lg overflow-hidden">
                    {/* Section Header */}
                    <div className="bg-slate-100 px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-sm">§{sIdx + 1}</span>
                        <input
                          type="text"
                          value={section.title}
                          onChange={(e) => updateSection(sIdx, 'title', e.target.value)}
                          className="font-medium bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none px-1"
                          placeholder="Section Title"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => moveSectionUp(sIdx)} className="p-1 hover:bg-slate-200 rounded" title="Move up">↑</button>
                        <button onClick={() => moveSectionDown(sIdx)} className="p-1 hover:bg-slate-200 rounded" title="Move down">↓</button>
                        <button onClick={() => removeSection(sIdx)} className="p-1 hover:bg-red-100 text-red-600 rounded" title="Remove section">✕</button>
                      </div>
                    </div>

                    {/* Section Content */}
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Section Description (optional)</label>
                        <input
                          type="text"
                          value={section.description || ''}
                          onChange={(e) => updateSection(sIdx, 'description', e.target.value)}
                          className="w-full px-2 py-1 text-sm border rounded"
                          placeholder="Brief description of this section..."
                        />
                      </div>

                      {/* Fields */}
                      <div className="space-y-2">
                        {section.fields.map((field, fIdx) => (
                          <div key={field.id} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg">
                            <div className="flex flex-col gap-1">
                              <button onClick={() => moveFieldUp(sIdx, fIdx)} className="p-0.5 hover:bg-slate-200 rounded text-xs">↑</button>
                              <button onClick={() => moveFieldDown(sIdx, fIdx)} className="p-0.5 hover:bg-slate-200 rounded text-xs">↓</button>
                            </div>

                            <div className="flex-1 grid grid-cols-4 gap-2">
                              <div>
                                <label className="block text-xs text-slate-500">Type</label>
                                <select
                                  value={field.type}
                                  onChange={(e) => updateField(sIdx, fIdx, 'type', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border rounded"
                                >
                                  <option value="text">Single Line Text</option>
                                  <option value="textarea">Multi-Line Text</option>
                                  <option value="number">Number</option>
                                  <option value="date">Date</option>
                                  <option value="select">Dropdown</option>
                                  <option value="checkbox">Checkbox</option>
                                  <option value="checkboxGroup">Checkbox Group</option>
                                  <option value="signature">Signature</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500">Label</label>
                                <input
                                  type="text"
                                  value={field.label}
                                  onChange={(e) => updateField(sIdx, fIdx, 'label', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border rounded"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500">Placeholder</label>
                                <input
                                  type="text"
                                  value={field.placeholder || ''}
                                  onChange={(e) => updateField(sIdx, fIdx, 'placeholder', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border rounded"
                                />
                              </div>
                              <div className="flex items-end gap-2">
                                <label className="flex items-center gap-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={field.required || false}
                                    onChange={(e) => updateField(sIdx, fIdx, 'required', e.target.checked)}
                                  />
                                  Required
                                </label>
                              </div>
                            </div>

                            {/* Options for select/checkboxGroup */}
                            {(field.type === 'select' || field.type === 'checkboxGroup') && (
                              <div className="w-48">
                                <label className="block text-xs text-slate-500">Options (comma-separated)</label>
                                <input
                                  type="text"
                                  value={(field.options || []).join(', ')}
                                  onChange={(e) => updateField(sIdx, fIdx, 'options', e.target.value.split(',').map(o => o.trim()).filter(o => o))}
                                  className="w-full px-2 py-1 text-sm border rounded"
                                  placeholder="Option 1, Option 2"
                                />
                              </div>
                            )}

                            {/* Rows for textarea */}
                            {field.type === 'textarea' && (
                              <div className="w-20">
                                <label className="block text-xs text-slate-500">Rows</label>
                                <input
                                  type="number"
                                  min="2"
                                  max="10"
                                  value={field.rows || 3}
                                  onChange={(e) => updateField(sIdx, fIdx, 'rows', parseInt(e.target.value) || 3)}
                                  className="w-full px-2 py-1 text-sm border rounded"
                                />
                              </div>
                            )}

                            <button
                              onClick={() => removeField(sIdx, fIdx)}
                              className="p-1 hover:bg-red-100 text-red-600 rounded"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => addField(sIdx)}
                        className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-indigo-400 hover:text-indigo-600 text-sm"
                      >
                        + Add Field
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addSection}
                  className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-indigo-400 hover:text-indigo-600 font-medium"
                >
                  + Add Section
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 flex justify-between">
          <div>
            {template.has_plan_template && (
              <button
                onClick={removeTemplateEditor}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
              >
                Remove Template
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={saveTemplateEditor}
              disabled={!templateEditorForm.name || templateEditorForm.sections.length === 0}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateEditorModal;