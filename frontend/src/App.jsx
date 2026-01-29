import { useState, useEffect, useRef } from 'react';
import { 
  X, Plus, Search, ChevronLeft, ChevronRight, Eye, Trash2, Edit, Upload, Download, 
  FileText, Printer, BarChart3, LogIn, LogOut, Settings, Users, User, BookOpen, 
  AlertCircle, Check, Calendar, Clock, MapPin, Archive, RotateCcw, TrendingUp, 
  Target, ClipboardList, ArrowLeft, ArrowRight, Save, RefreshCw, Filter, 
  MoreVertical, Info, CheckCircle, XCircle, AlertTriangle, Home, Menu
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Get Monday of the current week
const getCurrentWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
};

const formatWeekOf = (dateStr) => {
  if (!dateStr) return 'No date';
  // If the date string already has a T (ISO format), don't add another one
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Get rating label
const getRatingLabel = (rating) => {
  const labels = {
    1: 'No Progress',
    2: 'Minimal Progress',
    3: 'Some Progress',
    4: 'Good Progress',
    5: 'Significant Progress'
  };
  return labels[rating] || '';
};

// Get rating color
const getRatingColor = (rating) => {
  if (rating >= 4) return 'text-emerald-600';
  if (rating >= 3) return 'text-amber-600';
  return 'text-rose-600';
};

// Get status color
const getStatusColor = (status) => {
  switch (status) {
    case 'Implemented as Planned': return 'bg-emerald-100 text-emerald-800';
    case 'Partially Implemented': return 'bg-amber-100 text-amber-800';
    case 'Not Implemented': return 'bg-rose-100 text-rose-800';
    case 'Student Absent': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

// Tier colors
const tierColors = {
  1: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', accent: '#059669' },
  2: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', accent: '#d97706' },
  3: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800', accent: '#dc2626' }
};

// Area colors
const areaColors = {
  'Academic': { bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', border: 'border-blue-200' },
  'Behavior': { bg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', border: 'border-purple-200' },
  'Social-Emotional': { bg: 'bg-pink-50', badge: 'bg-pink-100 text-pink-700', border: 'border-pink-200' }
};

const gradeOptions = ['K', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

const archiveReasons = [
  'Completed Interventions',
  'End of School Year',
  'Transferred Out',
  'No Longer Needs Support',
  'Other'
];

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [view, setView] = useState('dashboard');
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [interventionTemplates, setInterventionTemplates] = useState([]);
  const [interventionLogs, setInterventionLogs] = useState([]);
  const [logOptions, setLogOptions] = useState({ timeOfDay: [], location: [] });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('all');
  const [filterArea, setFilterArea] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showAddIntervention, setShowAddIntervention] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showAddLog, setShowAddLog] = useState(false);
  const [interventionAreaFilter, setInterventionAreaFilter] = useState('all');
  const [newIntervention, setNewIntervention] = useState({ name: '', notes: '' });
  const [newNote, setNewNote] = useState('');
  const noteTextareaRef = useRef(null);
  const progressNotesRef = useRef(null);
  const interventionNotesRef = useRef(null);  
  const [noteDate, setNoteDate] = useState(new Date().toISOString().split('T')[0]);
  // Report state
const [showReport, setShowReport] = useState(false);
const [reportDateRange, setReportDateRange] = useState({
  startDate: '',
  endDate: new Date().toISOString().split('T')[0]
});
const [missingLogs, setMissingLogs] = useState({ missing_count: 0, interventions: [] });
const [reportData, setReportData] = useState(null);
  const [newLog, setNewLog] = useState({ 
    student_intervention_id: '', 
    log_date: new Date().toISOString().split('T')[0], 
    time_of_day: '', 
    location: '', 
    notes: '' 
  });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Admin state
  const [adminTab, setAdminTab] = useState('interventions');
  const [adminAreaFilter, setAdminAreaFilter] = useState('all');
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', area: '', tier: '' });
  
  // Admin Template Editor state
  const [adminTemplates, setAdminTemplates] = useState([]);
  const [selectedAdminTemplate, setSelectedAdminTemplate] = useState(null);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [fieldTypes, setFieldTypes] = useState([]);
  const [templateEditorForm, setTemplateEditorForm] = useState({
    name: '',
    version: '1.0',
    sections: []
  });
  const [editorPreviewMode, setEditorPreviewMode] = useState(false);
  const [duplicateSourceId, setDuplicateSourceId] = useState('');
  
  // Student management state
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [studentForm, setStudentForm] = useState({
    first_name: '',
    last_name: '',
    grade: '',
    tier: '1',
    area: '',
    risk_level: 'low'
  });
  const [adminStudentSearch, setAdminStudentSearch] = useState('');
  // Pre-Referral Form state
  const [showMTSSMeetingForm, setShowMTSSMeetingForm] = useState(false);
  // Intervention Plan state
  const [showInterventionPlanModal, setShowInterventionPlanModal] = useState(false);
  const [currentPlanIntervention, setCurrentPlanIntervention] = useState(null);
  const [planTemplate, setPlanTemplate] = useState(null);
  const [planData, setPlanData] = useState({});
  const [planStatus, setPlanStatus] = useState('not_applicable');
  const [planLoading, setPlanLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
const [mtssMeetings, setMTSSMeetings] = useState([]);
const [mtssMeetingOptions, setMTSSMeetingOptions] = useState(null);
const [interventionsSummary, setInterventionsSummary] = useState([]);
const [currentMTSSMeeting, setCurrentMTSSMeeting] = useState(null);
const [mtssMeetingForm, setMTSSMeetingForm] = useState({
  meeting_date: new Date().toISOString().split('T')[0],
  meeting_number: 1,
  meeting_type: '6-week',
  attendees: { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
  parent_attended: false,
  progress_summary: '',
  tier_decision: '',
  next_steps: '',
  next_meeting_date: '',
  intervention_reviews: []
});  const [showPreReferralForm, setShowPreReferralForm] = useState(false);
  const [preReferralForm, setPreReferralForm] = useState(null);
  const [preReferralStep, setPreReferralStep] = useState(1);
  const [preReferralOptions, setPreReferralOptions] = useState(null);
  const [preReferralLoading, setPreReferralLoading] = useState(false);

  // CSV Import state
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  // Archive state
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [archivedStudentSearch, setArchivedStudentSearch] = useState('');

  // Progress tracking state
  const [weeklyProgressLogs, setWeeklyProgressLogs] = useState([]);
  const [showProgressForm, setShowProgressForm] = useState(false);
  const [selectedInterventionForProgress, setSelectedInterventionForProgress] = useState(null);
  const [progressFormData, setProgressFormData] = useState({
    week_of: '',
    status: '',
    rating: '',
    response: '',
    notes: ''
  });
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showProgressChart, setShowProgressChart] = useState(false);
const [selectedInterventionForChart, setSelectedInterventionForChart] = useState(null);
  const [selectedInterventionForGoal, setSelectedInterventionForGoal] = useState(null);
  const [goalFormData, setGoalFormData] = useState({
    goal_description: '',
    goal_target_date: '',
    goal_target_rating: 3
  });
  // Check if user is admin
  const isAdmin = user && (user.role === 'district_admin' || user.role === 'school_admin');
  
  // Check if user can archive (admins and counselors)
  const canArchive = user && ['district_admin', 'school_admin', 'counselor'].includes(user.role);

  // Check if logged in on load
  useEffect(() => {
    if (token) {
      fetchUserInfo();
      fetchLogOptions();
    } else {
      setLoading(false);
    }
  }, [token]);
  // Fetch missing logs when dashboard loads

  useEffect(() => {
    if (view === 'dashboard' && user?.tenant_id) {
      fetchMissingLogs();
    }
  }, [view, user?.tenant_id]);
  
// Fetch admin templates when admin view loads
  useEffect(() => {
    if (view === 'admin') {
      fetchAdminTemplates();
      fetchFieldTypes();
    }
  }, [view]);  // Fetch user info
  const fetchUserInfo = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        fetchStudents(userData.tenant_id);
        fetchInterventionTemplates(userData.tenant_id);
      } else {
        localStorage.removeItem('token');
        setToken(null);
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
    setLoading(false);
  };

  // Fetch log options
  const fetchLogOptions = async () => {
    try {
      const res = await fetch(`${API_URL}/intervention-logs/options`);
      if (res.ok) {
        const data = await res.json();
        setLogOptions(data);
      }
    } catch (error) {
      console.error('Error fetching log options:', error);
    }
  };

  // Fetch students
  const fetchStudents = async (tenantId, includeArchived = false) => {
    try {
      const res = await fetch(`${API_URL}/students/tenant/${tenantId}?includeArchived=${includeArchived}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  // Fetch archived students
  const fetchArchivedStudents = async (tenantId) => {
    try {
      const res = await fetch(`${API_URL}/students/tenant/${tenantId}?onlyArchived=true`);
      if (res.ok) {
        const data = await res.json();
        setArchivedStudents(data);
      }
    } catch (error) {
      console.error('Error fetching archived students:', error);
    }
  };

  // Fetch pre-referral form options
  const fetchPreReferralOptions = async () => {
    try {
      const res = await fetch(`${API_URL}/prereferral-forms/options`);
      if (res.ok) {
        const data = await res.json();
        setPreReferralOptions(data);
      }
    } catch (error) {
      console.error('Error fetching pre-referral options:', error);
    }
  };

  // Fetch existing pre-referral form for a student
  const fetchPreReferralForm = async (studentId) => {
    try {
      const res = await fetch(`${API_URL}/prereferral-forms/student/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        // Return the most recent non-archived form if exists
        const activeForm = data.find(f => f.status !== 'archived');
        return activeForm || null;
      }
    } catch (error) {
      console.error('Error fetching pre-referral form:', error);
    }
    return null;
  };

  // Create new pre-referral form
  const createPreReferralForm = async (studentId) => {
    try {
      const res = await fetch(`${API_URL}/prereferral-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          tenant_id: user.tenant_id,
          referred_by: user.id,
          initiated_by: 'staff'
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (error) {
      console.error('Error creating pre-referral form:', error);
    }
    return null;
  };

  // Save pre-referral form draft
  const savePreReferralForm = async (formId, updates) => {
    try {
      const res = await fetch(`${API_URL}/prereferral-forms/${formId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const data = await res.json();
        setPreReferralForm(data);
        return data;
      }
    } catch (error) {
      console.error('Error saving pre-referral form:', error);
    }
    return null;
  };

  // Submit pre-referral form for approval
  const submitPreReferralForm = async (formId, staffName) => {
    try {
      const res = await fetch(`${API_URL}/prereferral-forms/${formId}/submit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referring_staff_name: staffName })
      });
      if (res.ok) {
        const data = await res.json();
        setPreReferralForm(data);
        return data;
      }
    } catch (error) {
      console.error('Error submitting pre-referral form:', error);
    }
    return null;
  };

  // Open pre-referral form (creates new or opens existing)
  const openPreReferralForm = async (student) => {
    setPreReferralLoading(true);
    
    // Fetch options if not loaded
    if (!preReferralOptions) {
      await fetchPreReferralOptions();
    }
    
    // Check for existing form
    const existingForm = await fetchPreReferralForm(student.id);
    
    if (existingForm) {
      setPreReferralForm(existingForm);
    } else {
      // Create new form
      const newForm = await createPreReferralForm(student.id);
      setPreReferralForm(newForm);
    }
    
    setPreReferralStep(1);
    setPreReferralLoading(false);
    setShowPreReferralForm(true);
  };

  // Fetch weekly progress for a student
  const fetchWeeklyProgress = async (studentId) => {
    try {
      const response = await fetch(`${API_URL}/weekly-progress/student/${studentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setWeeklyProgressLogs(data);
        console.log('Weekly progress data:', data);
      }
    } catch (err) {
      console.error('Error fetching weekly progress:', err);
    }
  };
  
  // Fetch missing weekly logs for dashboard alert
  const fetchMissingLogs = async () => {
    if (!user?.tenant_id) return;
    try {
      const response = await fetch(`${API_URL}/weekly-progress/missing/${user.tenant_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setMissingLogs({
  missing_count: data.length,
  week_of: new Date().toISOString().split('T')[0],
  interventions: data
});
      }
    } catch (error) {
      console.error('Error fetching missing logs:', error);
    }
  };
  // MTSS Meeting Functions
  const fetchMTSSMeetingOptions = async () => {
    try {
      const response = await fetch(`${API_URL}/mtss-meetings/options`);
      if (response.ok) {
        const data = await response.json();
        setMTSSMeetingOptions(data);
      }
    } catch (error) {
      console.error('Error fetching MTSS meeting options:', error);
    }
  };

  const fetchMTSSMeetings = async (studentId) => {
    try {
      const response = await fetch(`${API_URL}/mtss-meetings/student/${studentId}`);
      if (response.ok) {
        const data = await response.json();
        setMTSSMeetings(data);
      }
    } catch (error) {
      console.error('Error fetching MTSS meetings:', error);
    }
  };

  const fetchInterventionsSummary = async (studentId) => {
    try {
      const response = await fetch(`${API_URL}/mtss-meetings/student/${studentId}/interventions-summary`);
      if (response.ok) {
        const data = await response.json();
        setInterventionsSummary(data);
        return data;
      }
    } catch (error) {
      console.error('Error fetching interventions summary:', error);
    }
    return [];
  };

  const fetchMeetingCount = async (studentId) => {
    try {
      const response = await fetch(`${API_URL}/mtss-meetings/student/${studentId}/count`);
      if (response.ok) {
        const data = await response.json();
        return data.count || 0;
      }
    } catch (error) {
      console.error('Error fetching meeting count:', error);
    }
    return 0;
  };
  // ============================================
  // ADMIN TEMPLATE EDITOR FUNCTIONS
  // ============================================

  const fetchAdminTemplates = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/templates`);
      if (response.ok) {
        const data = await response.json();
        setAdminTemplates(data);
      }
    } catch (error) {
      console.error('Error fetching admin templates:', error);
    }
  };

  const fetchFieldTypes = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/field-types`);
      if (response.ok) {
        const data = await response.json();
        setFieldTypes(data);
      }
    } catch (error) {
      console.error('Error fetching field types:', error);
    }
  };

  const openTemplateEditor = async (template) => {
    setSelectedAdminTemplate(template);
    setDuplicateSourceId('');
    
    if (template.has_plan_template) {
      try {
        const response = await fetch(`${API_URL}/admin/templates/${template.id}`);
        if (response.ok) {
          const data = await response.json();
          setTemplateEditorForm({
            name: data.plan_template?.name || template.name,
            version: data.plan_template?.version || '1.0',
            sections: data.plan_template?.sections || []
          });
        }
      } catch (error) {
        console.error('Error fetching template details:', error);
      }
    } else {
      setTemplateEditorForm({
        name: template.name,
        version: '1.0',
        sections: []
      });
    }
    
    setEditorPreviewMode(false);
    setShowTemplateEditor(true);
  };

  const saveTemplateEditor = async () => {
    if (!selectedAdminTemplate) return;
    
    try {
      const response = await fetch(`${API_URL}/admin/templates/${selectedAdminTemplate.id}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_template: templateEditorForm })
      });
      
      if (response.ok) {
        alert('Plan template saved successfully!');
        fetchAdminTemplates();
        setShowTemplateEditor(false);
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
    if (!selectedAdminTemplate) return;
    
    if (!confirm(`Are you sure you want to remove the plan template from "${selectedAdminTemplate.name}"?`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/admin/templates/${selectedAdminTemplate.id}/plan`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        alert('Plan template removed successfully!');
        fetchAdminTemplates();
        setShowTemplateEditor(false);
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
    if (!selectedAdminTemplate || !duplicateSourceId) return;
    
    try {
      const response = await fetch(`${API_URL}/admin/templates/${selectedAdminTemplate.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: duplicateSourceId })
      });
      
      if (response.ok) {
        alert('Template duplicated successfully!');
        openTemplateEditor(selectedAdminTemplate);
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

  // Section management
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

  // Field management
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

  const openMTSSMeetingForm = async (meeting = null) => {
    if (!selectedStudent) return;
    
    await fetchMTSSMeetingOptions();
    const interventions = await fetchInterventionsSummary(selectedStudent.id);
    
    if (meeting) {
      // Editing existing meeting
      setCurrentMTSSMeeting(meeting);
      setMTSSMeetingForm({
        meeting_date: meeting.meeting_date ? meeting.meeting_date.split('T')[0] : '',
        meeting_number: meeting.meeting_number || 1,
        meeting_type: meeting.meeting_type || '6-week',
        attendees: meeting.attendees || { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
        parent_attended: meeting.parent_attended || false,
        progress_summary: meeting.progress_summary || '',
        tier_decision: meeting.tier_decision || '',
        next_steps: meeting.next_steps || '',
        next_meeting_date: meeting.next_meeting_date ? meeting.next_meeting_date.split('T')[0] : '',
        intervention_reviews: meeting.intervention_reviews || interventions.map(inv => ({
          student_intervention_id: inv.id,
          intervention_name: inv.intervention_name,
          implementation_fidelity: '',
          progress_toward_goal: '',
          recommendation: '',
          notes: '',
          avg_rating: inv.avg_rating,
          total_logs: inv.total_logs
        }))
      });
    } else {
      // New meeting
      const count = await fetchMeetingCount(selectedStudent.id);
      setCurrentMTSSMeeting(null);
      setMTSSMeetingForm({
        meeting_date: new Date().toISOString().split('T')[0],
        meeting_number: Math.min(count + 1, 3),
        meeting_type: '6-week',
        attendees: { teacher: false, counselor: false, admin: false, parent: false, specialist: false, other: '' },
        parent_attended: false,
        progress_summary: '',
        tier_decision: '',
        next_steps: '',
        next_meeting_date: '',
        intervention_reviews: interventions.map(inv => ({
          student_intervention_id: inv.id,
          intervention_name: inv.intervention_name,
          implementation_fidelity: '',
          progress_toward_goal: '',
          recommendation: '',
          notes: '',
          avg_rating: inv.avg_rating,
          total_logs: inv.total_logs
        }))
      });
    }
    setShowMTSSMeetingForm(true);
  };

  const saveMTSSMeeting = async () => {
    if (!selectedStudent) return;
    
    try {
      const payload = {
        student_id: selectedStudent.id,
        tenant_id: user.tenant_id,
        created_by: user.id,
        ...mtssMeetingForm
      };
      
      const url = currentMTSSMeeting 
        ? `${API_URL}/mtss-meetings/${currentMTSSMeeting.id}`
        : `${API_URL}/mtss-meetings`;
      
      const response = await fetch(url, {
        method: currentMTSSMeeting ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        setShowMTSSMeetingForm(false);
        fetchMTSSMeetings(selectedStudent.id);
        alert(currentMTSSMeeting ? 'Meeting updated!' : 'Meeting saved!');
      } else {
        const error = await response.json();
        alert('Error saving meeting: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving MTSS meeting:', error);
      alert('Error saving meeting');
    }
  };

  const deleteMTSSMeeting = async (meetingId) => {
    if (!confirm('Delete this meeting? This cannot be undone.')) return;
    
    try {
      const response = await fetch(`${API_URL}/mtss-meetings/${meetingId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        fetchMTSSMeetings(selectedStudent.id);
      }
    } catch (error) {
      console.error('Error deleting meeting:', error);
    }
  };

  const updateInterventionReview = (interventionId, field, value) => {
    setMTSSMeetingForm(prev => ({
      ...prev,
      intervention_reviews: prev.intervention_reviews.map(rev =>
        rev.student_intervention_id === interventionId
          ? { ...rev, [field]: value }
          : rev
      )
    }));
  };
  // Submit weekly progress
  const submitWeeklyProgress = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/weekly-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          student_intervention_id: selectedInterventionForProgress.id,
          student_id: selectedStudent.id,
          week_of: progressFormData.week_of,
          status: progressFormData.status,
          rating: progressFormData.rating || null,
          response: progressFormData.response || null,
          notes: progressNotesRef.current?.value || null,
          logged_by: user.id
        })
      });

      if (response.ok) {
        setShowProgressForm(false);
        setProgressFormData({
          week_of: '',
          status: '',
          rating: '',
          response: '',
          notes: ''
        });
        fetchWeeklyProgress(selectedStudent.id);
      }
    } catch (err) {
      console.error('Error submitting weekly progress:', err);
    }
  };

  // Delete weekly progress log
  const deleteWeeklyProgress = async (logId) => {
    if (!confirm('Are you sure you want to delete this progress log?')) return;
    try {
      const response = await fetch(`${API_URL}/weekly-progress/${logId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        fetchWeeklyProgress(selectedStudent.id);
      }
    } catch (err) {
      console.error('Error deleting weekly progress:', err);
    }
  };
  

  // Update intervention goal
  const updateInterventionGoal = async (interventionId) => {
    try {
      const response = await fetch(`${API_URL}/interventions/${interventionId}/goal`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(goalFormData)
      });

      if (response.ok) {
        setShowGoalForm(false);
        setGoalFormData({
          goal_description: '',
          goal_target_date: '',
          goal_target_rating: 3
        });
        // Refresh student data
        const studentResponse = await fetch(`${API_URL}/students/${selectedStudent.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (studentResponse.ok) {
          setSelectedStudent(await studentResponse.json());
        }
      }
    } catch (err) {
      console.error('Error updating goal:', err);
    }
  };

  
  // Fetch intervention templates
  const fetchInterventionTemplates = async (tenantId) => {
    try {
      const res = await fetch(`${API_URL}/interventions/templates/tenant/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        setInterventionTemplates(data);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  };

  // Fetch single student with details
  const fetchStudentDetails = async (studentId) => {
    try {
      const res = await fetch(`${API_URL}/students/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedStudent(data);
        fetchInterventionLogs(studentId);
        fetchWeeklyProgress(studentId);
        // Fetch MTSS meetings for Tier 2+ students
        if (data.tier > 1) {
          fetchMTSSMeetings(studentId);
          fetchMTSSMeetingOptions();
        }
      }
    } catch (error) {
      console.error('Error fetching student details:', error);
    }
  };

  // Fetch intervention logs for a student
  const fetchInterventionLogs = async (studentId) => {
    try {
      const res = await fetch(`${API_URL}/intervention-logs/student/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        setInterventionLogs(data);
      }
    } catch (error) {
      console.error('Error fetching intervention logs:', error);
    }
  };
  // ========== INTERVENTION PLAN FUNCTIONS ==========
  
  // Fetch plan data for a student intervention
  const fetchInterventionPlan = async (interventionId) => {
    try {
      setPlanLoading(true);
      const response = await fetch(`${API_URL}/intervention-plans/student-interventions/${interventionId}/plan`);
      if (response.ok) {
        const data = await response.json();
        setPlanTemplate(data.plan_template);
        setPlanData(data.plan_data || {});
        setPlanStatus(data.plan_status || 'not_applicable');
        return data;
      }
    } catch (error) {
      console.error('Error fetching intervention plan:', error);
    } finally {
      setPlanLoading(false);
    }
  };

  // Open the plan modal for an intervention
  const openInterventionPlanModal = async (intervention) => {
    setCurrentPlanIntervention(intervention);
    await fetchInterventionPlan(intervention.id);
    setShowInterventionPlanModal(true);
  };

  // Save plan data (auto-save on blur)
  const savePlanData = async (fieldId, value) => {
    if (!currentPlanIntervention) return;
    
    const updatedData = { ...planData, [fieldId]: value };
    setPlanData(updatedData);
    
    try {
      setPlanSaving(true);
      await fetch(`${API_URL}/intervention-plans/student-interventions/${currentPlanIntervention.id}/plan`, {
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
    if (!currentPlanIntervention || !user) return;
    
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
        alert(`Please complete these required fields:\n\n• ${missingRequired.slice(0, 5).join('\n• ')}${missingRequired.length > 5 ? `\n• ... and ${missingRequired.length - 5} more` : ''}`);
        return;
      }
    }
    
    try {
      setPlanSaving(true);
      const response = await fetch(`${API_URL}/intervention-plans/student-interventions/${currentPlanIntervention.id}/plan/complete`, {
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
    if (!currentPlanIntervention) return;
    
    if (!confirm('This will reopen the plan for editing. Continue?')) return;
    
    try {
      const response = await fetch(`${API_URL}/intervention-plans/student-interventions/${currentPlanIntervention.id}/plan/reopen`, {
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

  // Close modal and reset state
  const closeInterventionPlanModal = () => {
    setShowInterventionPlanModal(false);
    setCurrentPlanIntervention(null);
    setPlanTemplate(null);
    setPlanData({});
    setPlanStatus('not_applicable');
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
      
      case 'checkboxGroup':
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

  // Archive student
  const handleArchiveStudent = async () => {
    if (!archiveReason || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/students/${selectedStudent.id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived_reason: archiveReason,
          archived_by: user.id
        })
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
        fetchStudentDetails(selectedStudent.id);
        setShowArchiveModal(false);
        setArchiveReason('');
      }
    } catch (error) {
      console.error('Error archiving student:', error);
    }
  };

  // Unarchive student
  const handleUnarchiveStudent = async (studentId = null) => {
    const id = studentId || selectedStudent?.id;
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/students/${id}/unarchive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
        if (selectedStudent && selectedStudent.id === id) {
          fetchStudentDetails(id);
        }
        if (adminTab === 'archived') {
          fetchArchivedStudents(user.tenant_id);
        }
        setShowUnarchiveModal(false);
      }
    } catch (error) {
      console.error('Error unarchiving student:', error);
    }
  };

// Login
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        fetchStudents(data.user.tenant_id);
        fetchInterventionTemplates(data.user.tenant_id);
        fetchLogOptions();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (error) {
      setLoginError('Connection error. Is the server running?');
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setStudents([]);
    setSelectedStudent(null);
    setInterventionLogs([]);
  };

  // Add intervention
  const handleAddIntervention = async () => {
    if (!newIntervention.name || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/interventions/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          intervention_name: newIntervention.name,
          notes: interventionNotesRef.current?.value || '',
          assigned_by: user.id,
          log_frequency: newIntervention.log_frequency || 'weekly'
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setNewIntervention({ name: '', notes: '', log_frequency: 'weekly' });
        setShowAddIntervention(false);
        setInterventionAreaFilter('all');
      }
    } catch (error) {
      console.error('Error adding intervention:', error);
    }
  };

  // Add progress note
  const handleAddNote = async () => {
    const noteText = noteTextareaRef.current?.value || '';
    if (!noteText || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/progress-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          author_id: user.id,
          note: noteText,
          meeting_date: noteDate
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        if (noteTextareaRef.current) noteTextareaRef.current.value = '';
        setNoteDate(new Date().toISOString().split('T')[0]);
        setShowAddNote(false);
      }
    } catch (error) {
      console.error('Error adding note:', error);
    }
  };

  // Add intervention log
  const handleAddLog = async () => {
    if (!newLog.time_of_day || !newLog.location || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/intervention-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_intervention_id: newLog.student_intervention_id || null,
          student_id: selectedStudent.id,
          logged_by: user.id,
          log_date: newLog.log_date,
          time_of_day: newLog.time_of_day,
          location: newLog.location,
          notes: newLog.notes
        })
      });
      if (res.ok) {
        fetchInterventionLogs(selectedStudent.id);
        setNewLog({ 
          student_intervention_id: '', 
          log_date: new Date().toISOString().split('T')[0], 
          time_of_day: '', 
          location: '', 
          notes: '' 
        });
        setShowAddLog(false);
      }
    } catch (error) {
      console.error('Error adding log:', error);
    }
  };

  // Add custom intervention template
  const handleAddTemplate = async () => {
    if (!newTemplate.name || !newTemplate.area) return;
    try {
      const res = await fetch(`${API_URL}/interventions/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: user.tenant_id,
          name: newTemplate.name,
          description: newTemplate.description,
          area: newTemplate.area,
          tier: newTemplate.tier ? parseInt(newTemplate.tier) : null
        })
      });
      if (res.ok) {
        fetchInterventionTemplates(user.tenant_id);
        setNewTemplate({ name: '', description: '', area: '', tier: '' });
        setShowAddTemplate(false);
      }
    } catch (error) {
      console.error('Error adding template:', error);
    }
  };

  // Delete custom intervention template
  const handleDeleteTemplate = async (templateId) => {
    if (!confirm('Are you sure you want to delete this intervention? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_URL}/interventions/templates/${templateId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchInterventionTemplates(user.tenant_id);
      } else {
        const data = await res.json();
        alert(data.error || 'Could not delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  // Add student
  const handleAddStudent = async () => {
    if (!studentForm.first_name || !studentForm.last_name || !studentForm.grade) return;
    try {
      const res = await fetch(`${API_URL}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: user.tenant_id,
          first_name: studentForm.first_name,
          last_name: studentForm.last_name,
          grade: studentForm.grade,
          tier: parseInt(studentForm.tier),
          area: studentForm.area || null,
          risk_level: studentForm.risk_level
        })
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
        resetStudentForm();
        setShowAddStudent(false);
      }
    } catch (error) {
      console.error('Error adding student:', error);
    }
  };

  // Update student
  const handleUpdateStudent = async () => {
    if (!editingStudent || !studentForm.first_name || !studentForm.last_name || !studentForm.grade) return;
    try {
      const res = await fetch(`${API_URL}/students/${editingStudent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: studentForm.first_name,
          last_name: studentForm.last_name,
          grade: studentForm.grade,
          tier: parseInt(studentForm.tier),
          area: studentForm.area || null,
          risk_level: studentForm.risk_level
        })
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
        resetStudentForm();
        setEditingStudent(null);
      }
    } catch (error) {
      console.error('Error updating student:', error);
    }
  };

  // Delete student
  const handleDeleteStudent = async (studentId) => {
    if (!confirm('Are you sure you want to delete this student? All their interventions and notes will also be deleted. This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_URL}/students/${studentId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
      }
    } catch (error) {
      console.error('Error deleting student:', error);
    }
  };

  // Start editing student
  const startEditStudent = (student) => {
    setEditingStudent(student);
    setStudentForm({
      first_name: student.first_name,
      last_name: student.last_name,
      grade: student.grade,
      tier: student.tier.toString(),
      area: student.area || '',
      risk_level: student.risk_level || 'low'
    });
    setShowAddStudent(false);
  };

  // Reset student form
  const resetStudentForm = () => {
    setStudentForm({
      first_name: '',
      last_name: '',
      grade: '',
      tier: '1',
      area: '',
      risk_level: 'low'
    });
  };

  // CSV Import
  const handleCsvUpload = async () => {
    if (!csvFile) return;
    
    setCsvUploading(true);
    setCsvResult(null);
    
    const formData = new FormData();
    formData.append('file', csvFile);
    
    try {
      const res = await fetch(`${API_URL}/csv/students/${user.tenant_id}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (res.ok) {
        setCsvResult(data);
        fetchStudents(user.tenant_id, showArchived);
        setCsvFile(null);
        const fileInput = document.getElementById('csv-file-input');
        if (fileInput) fileInput.value = '';
      } else {
        setCsvResult({ error: data.error || 'Upload failed' });
      }
    } catch (error) {
      setCsvResult({ error: 'Upload failed. Is the server running?' });
    }
    
    setCsvUploading(false);
  };

  // Download CSV template
  const downloadCsvTemplate = () => {
    window.open(`${API_URL}/csv/template/download`, '_blank');
  };

  // Update student tier
  const handleTierChange = async (studentId, newTier) => {
    try {
      const res = await fetch(`${API_URL}/students/${studentId}/tier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: newTier })
      });
      if (res.ok) {
        fetchStudents(user.tenant_id, showArchived);
        if (selectedStudent && selectedStudent.id === studentId) {
          fetchStudentDetails(studentId);
        }
      }
    } catch (error) {
      console.error('Error updating tier:', error);
    }
  };

  // Generate report data
const generateReport = async () => {
  if (!selectedStudent) return;
  
  // Get the earliest intervention start date as default start
  const interventions = selectedStudent.interventions || [];
  const earliestStart = interventions.length > 0 
    ? interventions.reduce((earliest, int) => {
        const startDate = int.start_date ? int.start_date.split('T')[0] : null;
        if (!startDate) return earliest;
        return !earliest || startDate < earliest ? startDate : earliest;
      }, null)
    : new Date().toISOString().split('T')[0];
  
  // Set default date range if not set
  if (!reportDateRange.startDate) {
    setReportDateRange(prev => ({
      ...prev,
      startDate: earliestStart || new Date().toISOString().split('T')[0]
    }));
  }
  
  // Fetch weekly progress for all interventions
  const progressPromises = interventions.map(async (intervention) => {
    try {
      const res = await fetch(`${API}/weekly-progress/intervention/${intervention.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        return { interventionId: intervention.id, progress: data };
      }
    } catch (err) {
      console.error('Error fetching progress:', err);
    }
    return { interventionId: intervention.id, progress: [] };
  });
  
  const progressResults = await Promise.all(progressPromises);
  const progressMap = {};
  progressResults.forEach(({ interventionId, progress }) => {
    progressMap[interventionId] = progress;
  });
  
  setReportData({
    student: selectedStudent,
    progressMap,
    generatedAt: new Date().toISOString()
  });
  
  setShowReport(true);
};

// Print report
const printReport = () => {
  window.print();
};

// Filter data by date range
const filterByDateRange = (items, dateField) => {
  if (!items) return [];
  return items.filter(item => {
    const itemDate = item[dateField]?.split('T')[0];
    if (!itemDate) return false;
    return itemDate >= reportDateRange.startDate && itemDate <= reportDateRange.endDate;
  });
};

  // Filter intervention templates by area
  const filteredInterventionTemplates = interventionTemplates.filter(t => {
    if (interventionAreaFilter === 'all') return true;
    return t.area === interventionAreaFilter;
  });

  // Filter templates for admin view
  const adminFilteredTemplates = interventionTemplates.filter(t => {
    if (adminAreaFilter === 'all') return true;
    return t.area === adminAreaFilter;
  });

  // Group templates by area for display
  const templatesByArea = {
    'Academic': interventionTemplates.filter(t => t.area === 'Academic'),
    'Behavior': interventionTemplates.filter(t => t.area === 'Behavior'),
    'Social-Emotional': interventionTemplates.filter(t => t.area === 'Social-Emotional')
  };

  // Filter students (excluding archived by default)
  const filteredStudents = students.filter(student => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    const matchesSearch = fullName.includes(searchTerm.toLowerCase());
    const matchesTier = filterTier === 'all' || student.tier === parseInt(filterTier);
    const matchesArea = filterArea === 'all' || student.area === filterArea;
    const matchesArchived = showArchived || !student.archived;
    return matchesSearch && matchesTier && matchesArea && matchesArchived;
  });

  // Filter students for admin view
  const adminFilteredStudents = students.filter(student => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    const matchesSearch = fullName.includes(adminStudentSearch.toLowerCase());
    const notArchived = !student.archived;
    return matchesSearch && notArchived;
  });

  // Filter archived students for admin view
  const filteredArchivedStudents = archivedStudents.filter(student => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    return fullName.includes(archivedStudentSearch.toLowerCase());
  });

  // Count active students only
  const activeStudents = students.filter(s => !s.archived);
  const tierCounts = {
    1: activeStudents.filter(s => s.tier === 1).length,
    2: activeStudents.filter(s => s.tier === 2).length,
    3: activeStudents.filter(s => s.tier === 3).length
  };

  const openStudentProfile = (student) => {
    fetchStudentDetails(student.id);
    setView('student');
    if (student.area) {
      setInterventionAreaFilter(student.area);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  // Login Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BarChart3 size={28} className="text-white" />
            </div>
            <span className="text-2xl font-semibold text-slate-800">TierTrak</span>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@school.edu"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••••"
                required
              />
            </div>
            {loginError && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{loginError}</div>
            )}
            <button
              type="submit"
              className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <LogIn size={18} />
              Sign In
            </button>
          </form>
          
          <p className="mt-6 text-center text-sm text-slate-500">
            Test login: demo@lincoln.edu / test123
          </p>
        </div>
      </div>
    );
  }

// Dashboard View
  const DashboardView = () => (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">MTSS Dashboard</h1>
          <p className="text-slate-500 mt-1">Multi-Tiered System of Supports Overview</p>
        </div>
      </div>
      {/* Missing Logs Alert */}
      {missingLogs.missing_count > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">
              Weekly Reminder: Log Progress ({missingLogs.missing_count})
            </h3>
          </div>
          <p className="text-sm text-amber-700 mb-3">
            The following interventions haven't been logged yet this week. Remember to log progress based on each intervention's frequency.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {missingLogs.interventions.map((item) => (
              <div 
                key={item.id}
                onClick={() => {
                  setSelectedStudent({ id: item.student_id });
                  setView('student');
                }}
                className="flex items-center justify-between p-2 bg-white rounded-lg border border-amber-100 cursor-pointer hover:bg-amber-50 transition-colors"
              >
                <div>
                  <span className="font-medium text-slate-800">
                    {item.first_name} {item.last_name}
                  </span>
                  <span className="text-slate-400 mx-2">—</span>
                  <span className="text-slate-600">{item.intervention_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {item.log_frequency === 'daily' ? 'Daily' :
                     item.log_frequency === '3x_week' ? '3x/wk' :
                     item.log_frequency === '2x_week' ? '2x/wk' :
                     item.log_frequency === 'biweekly' ? 'Bi-wkly' : 'Weekly'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    item.tier === 1 ? 'bg-emerald-100 text-emerald-700' :
                    item.tier === 2 ? 'bg-amber-100 text-amber-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    Tier {item.tier}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier Overview Cards */}

      {/* Tier Overview Cards */}
      <div className="grid grid-cols-3 gap-6">
        {[1, 2, 3].map(tier => (
          <div 
            key={tier} 
            className={`${tierColors[tier].bg} ${tierColors[tier].border} border-2 rounded-2xl p-6 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02]`}
            onClick={() => { setFilterTier(tier.toString()); setView('students'); }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className={`${tierColors[tier].badge} px-3 py-1 rounded-full text-sm font-semibold`}>
                Tier {tier}
              </span>
              <span className={`text-4xl font-bold ${tierColors[tier].text}`}>{tierCounts[tier]}</span>
            </div>
            <p className="text-slate-600 text-sm">
              {tier === 1 && 'Universal supports - classroom-level interventions'}
              {tier === 2 && 'Targeted supports - small group interventions'}
              {tier === 3 && 'Intensive supports - individualized interventions'}
            </p>
            <div className="mt-4 flex items-center text-sm text-slate-500">
              <span>View students</span>
              <ChevronRight size={16} className="ml-1" />
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-5 border border-indigo-200">
          <Users size={24} className="text-indigo-600 mb-2" />
          <p className="text-2xl font-bold text-indigo-900">{activeStudents.length}</p>
          <p className="text-sm text-indigo-600">Active Students</p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200">
          <BookOpen size={24} className="text-blue-600 mb-2" />
          <p className="text-2xl font-bold text-blue-900">{templatesByArea['Academic']?.length || 0}</p>
          <p className="text-sm text-blue-600">Academic Interventions</p>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-5 border border-purple-200">
          <BookOpen size={24} className="text-purple-600 mb-2" />
          <p className="text-2xl font-bold text-purple-900">{templatesByArea['Behavior']?.length || 0}</p>
          <p className="text-sm text-purple-600">Behavior Interventions</p>
        </div>
        <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-5 border border-pink-200">
          <BookOpen size={24} className="text-pink-600 mb-2" />
          <p className="text-2xl font-bold text-pink-900">{templatesByArea['Social-Emotional']?.length || 0}</p>
          <p className="text-sm text-pink-600">Social-Emotional</p>
        </div>
      </div>

      {activeStudents.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Users size={48} className="mx-auto mb-4 text-slate-300" />
          <h3 className="text-lg font-medium text-slate-800 mb-2">No Students Yet</h3>
          <p className="text-slate-500">Students will appear here once they're added to your school.</p>
        </div>
      )}
    </div>
  );

  // Students List View
  const StudentsListView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Students</h1>
          <p className="text-slate-500 mt-1">Browse and manage student interventions</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by student name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={filterTier}
          onChange={(e) => setFilterTier(e.target.value)}
          className="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="all">All Tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <select
          value={filterArea}
          onChange={(e) => setFilterArea(e.target.value)}
          className="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="all">All Areas</option>
          <option value="Behavior">Behavior</option>
          <option value="Academic">Academic</option>
          <option value="Social-Emotional">Social-Emotional</option>
        </select>
        <button
          onClick={() => {
            setShowArchived(!showArchived);
            fetchStudents(user.tenant_id, !showArchived);
          }}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
            showArchived 
              ? 'bg-gray-700 text-white' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Archive size={16} />
          {showArchived ? 'Showing Archived' : 'Show Archived'}
        </button>
      </div>

      {/* Student Cards */}
      <div className="grid grid-cols-2 gap-4">
        {filteredStudents.map(student => (
          <div
            key={student.id}
            className={`${tierColors[student.tier]?.bg || 'bg-slate-50'} ${tierColors[student.tier]?.border || 'border-slate-200'} border-2 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.01] ${student.archived ? 'opacity-60 border-dashed' : ''}`}
            onClick={() => openStudentProfile(student)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                  <User size={22} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{student.first_name} {student.last_name}</h3>
                  <p className="text-sm text-slate-500">{student.grade} Grade</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'} px-3 py-1 rounded-full text-sm font-semibold`}>
                  Tier {student.tier}
                </span>
                {student.archived && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 text-gray-600 text-xs font-medium rounded-full">
                    <Archive size={12} />
                    Archived
                  </span>
                )}
              </div>
            </div>
            {student.area && (
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs ${areaColors[student.area]?.badge || 'bg-slate-100 text-slate-600'}`}>
                  {student.area}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredStudents.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Users size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">No students found</p>
        </div>
      )}
    </div>
  );

  // Student Profile View
  const StudentProfileView = () => {
    if (!selectedStudent) return null;
    
    return (
      <div className="space-y-6">
        <button
          onClick={() => { setView('students'); setSelectedStudent(null); setInterventionLogs([]); }}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={20} />
          <span>Back to Students</span>
        </button>

        {/* Student Header */}
        <div className={`${tierColors[selectedStudent.tier]?.bg || 'bg-slate-50'} ${tierColors[selectedStudent.tier]?.border || 'border-slate-200'} border-2 rounded-2xl p-6 ${selectedStudent.archived ? 'border-dashed' : ''}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${tierColors[selectedStudent.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                <User size={32} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-slate-800">
                    {selectedStudent.first_name} {selectedStudent.last_name}
                  </h1>
                  {selectedStudent.archived && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-600 text-sm font-medium rounded-full">
                      <Archive size={14} />
                      Archived
                    </span>
                  )}
                </div>
                <p className="text-slate-600">{selectedStudent.grade} Grade</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`${tierColors[selectedStudent.tier]?.badge || 'bg-slate-100 text-slate-600'} px-3 py-1 rounded-full text-sm font-semibold`}>
                    Tier {selectedStudent.tier}
                  </span>
                  {selectedStudent.area && (
                    <span className={`px-2 py-1 rounded-full text-xs ${areaColors[selectedStudent.area]?.badge || 'bg-slate-100 text-slate-600'}`}>
                      {selectedStudent.area}
                    </span>
                  )}
                </div>
                {selectedStudent.archived && selectedStudent.archived_reason && (
                  <p className="text-sm text-gray-500 mt-2">
                    Archived: {selectedStudent.archived_reason}
                    {selectedStudent.archived_at && ` on ${new Date(selectedStudent.archived_at).toLocaleDateString()}`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {!selectedStudent.archived && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">Change Tier:</span>
                  {[1, 2, 3].map(tier => (
                    <button
                      key={tier}
                      onClick={() => handleTierChange(selectedStudent.id, tier)}
                      className={`w-8 h-8 rounded-full text-sm font-semibold transition-all ${
                        selectedStudent.tier === tier
                          ? `${tierColors[tier].badge} ring-2 ring-offset-2 ring-slate-400`
                          : 'bg-white text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              )}
             {/* Generate Report Button */}
<button
  onClick={generateReport}
  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
>
  <FileText size={18} />
  Generate Report
</button>

{/* Pre-Referral Form Button - Only for Tier 1 students */}
{selectedStudent.tier === 1 && !selectedStudent.archived && (
  <button
    onClick={() => openPreReferralForm(selectedStudent)}
    disabled={preReferralLoading}
    className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium disabled:opacity-50"
  >
    <ClipboardList size={18} />
    {preReferralLoading ? 'Loading...' : 'Pre-Referral Form'}
  </button>
)}

              {canArchive && !selectedStudent.archived && (
                <button
                  onClick={() => setShowArchiveModal(true)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition flex items-center gap-2"
                >
                  <Archive size={16} />
                  Archive
                </button>
              )}
              {canArchive && selectedStudent.archived && (
                <button
                  onClick={() => setShowUnarchiveModal(true)}
                  className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition flex items-center gap-2"
                >
                  <RotateCcw size={16} />
                  Reactivate
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-3 gap-6">
          {/* Interventions */}
          <div className="col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <BookOpen size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">Interventions</h2>
              </div>
              {!selectedStudent.archived && (
                <button
                  onClick={() => {
                    setShowAddIntervention(true);
                    if (selectedStudent.area) {
                      setInterventionAreaFilter(selectedStudent.area);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={16} />
                  Add
                </button>
              )}
            </div>

            {showAddIntervention && (
              <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                <h3 className="font-medium text-slate-800 mb-3">New Intervention</h3>
                
                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setInterventionAreaFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        interventionAreaFilter === 'all' 
                          ? 'bg-slate-700 text-white' 
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setInterventionAreaFilter('Academic')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        interventionAreaFilter === 'Academic' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      Academic
                    </button>
                    <button
                      onClick={() => setInterventionAreaFilter('Behavior')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        interventionAreaFilter === 'Behavior' 
                          ? 'bg-purple-600 text-white' 
                          : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                      }`}
                    >
                      Behavior
                    </button>
                    <button
                      onClick={() => setInterventionAreaFilter('Social-Emotional')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        interventionAreaFilter === 'Social-Emotional' 
                          ? 'bg-pink-600 text-white' 
                          : 'bg-pink-50 text-pink-700 hover:bg-pink-100'
                      }`}
                    >
                      Social-Emotional
                    </button>
                  </div>
                </div>

                <select
                  value={newIntervention.name}
                  onChange={(e) => setNewIntervention({ ...newIntervention, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select intervention...</option>
                  {filteredInterventionTemplates.map(t => (
                    <option key={t.id} value={t.name}>
                      {t.name} {t.tier ? `(Tier ${t.tier})` : ''}
                    </option>
                  ))}
                </select>

                <p className="text-xs text-slate-500 mb-3">
                  Showing {filteredInterventionTemplates.length} interventions
                  {interventionAreaFilter !== 'all' && ` in ${interventionAreaFilter}`}
                </p>

                <textarea
  ref={interventionNotesRef}
  placeholder="Notes..."
  defaultValue=""
  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
  rows={2}
/>

                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    How often should progress be logged?
                  </label>
                  <select
                    value={newIntervention.log_frequency || 'weekly'}
                    onChange={(e) => setNewIntervention({ ...newIntervention, log_frequency: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="daily">Daily (5x/week)</option>
                    <option value="3x_week">3x per week</option>
                    <option value="2x_week">2x per week</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    This helps staff know how often to log progress.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { 
  setShowAddIntervention(false); 
  setNewIntervention({ name: '', notes: '', log_frequency: 'weekly' }); 
  setInterventionAreaFilter('all');
}}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddIntervention}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
                  >
                    <Save size={14} />
                    Save
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4 max-h-80 overflow-y-auto">
              {selectedStudent.interventions?.map(intervention => (
                <div key={intervention.id} className="p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-800">{intervention.intervention_name}</h4>
                        {['Behavior Contract', 'Parent Communication Plan', 'Anxiety Management Plan', 
                          'Crisis Safety Plan', 'Daily Behavior Report Card', 'Behavior Intervention Plan',
                          'Token Economy System'].includes(intervention.intervention_name) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openInterventionPlanModal(intervention);
                            }}
                            className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors flex items-center gap-1"
                          >
                            <FileText size={12} />
                            Plan
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">Started {formatWeekOf(intervention.start_date)}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      intervention.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {intervention.status}
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                      📅 {intervention.log_frequency === 'daily' ? 'Daily' :
                          intervention.log_frequency === '3x_week' ? '3x/week' :
                          intervention.log_frequency === '2x_week' ? '2x/week' :
                          intervention.log_frequency === 'biweekly' ? 'Bi-weekly' : 'Weekly'}
                    </span>
                  </div>
                  {intervention.notes && (
                    <p className="text-sm text-slate-600 mb-3">{intervention.notes}</p>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all bg-indigo-500"
                        style={{ width: `${intervention.progress || 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-600">{intervention.progress || 0}%</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => {
                        setSelectedInterventionForProgress(intervention);
                        setProgressFormData({
                          week_of: new Date().toISOString().split('T')[0],
                          status: '',
                          rating: '',
                          response: '',
                          notes: ''
                        });
                        if (progressNotesRef.current) progressNotesRef.current.value = '';
                        setShowProgressForm(true);
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Log Progress
                    </button>
                    <button
                      onClick={() => {
                        setSelectedInterventionForGoal(intervention);
                        setGoalFormData({
                          goal_description: intervention.goal_description || '',
                          goal_target_date: intervention.goal_target_date || '',
                          goal_target_rating: intervention.goal_target_rating || 3
                        });
                        setShowGoalForm(true);
                      }}
                      className="px-3 py-1.5 border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-100 flex items-center gap-1"
                    >
                      <Target className="w-3 h-3" />
                      {intervention.goal_description ? 'Edit Goal' : 'Set Goal'}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedInterventionForChart(intervention);
                        setShowProgressChart(true);
                      }}
                      className="px-3 py-1.5 border border-indigo-300 text-indigo-700 text-sm rounded-lg hover:bg-indigo-50 flex items-center gap-1"
                    >
                      <TrendingUp className="w-3 h-3" />
                      View Chart
                    </button>
                  </div>
                  {/* Weekly Progress Logs Display */}
                  {weeklyProgressLogs
                    .filter(log => log.student_intervention_id === intervention.id)
                    .slice(0, 3)
                    .map(log => (
                      <div key={log.id} className="text-sm bg-white p-2 rounded border border-slate-100 mt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">{formatWeekOf(log.week_of)}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(log.status)}`}>
                              {log.status}
                            </span>
                            <button
                              onClick={() => deleteWeeklyProgress(log.id)}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="Delete log"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {log.rating && (
                          <div className="mt-1">
                            <span className="text-slate-500">Rating: </span>
                            <span className={getRatingColor(log.rating)}>{log.rating}/5 - {getRatingLabel(log.rating)}</span>
                          </div>
                        )}
                        {log.notes && <p className="text-slate-600 mt-1">{log.notes}</p>}
                      </div>
                    ))}
                </div>
              ))}
              {(!selectedStudent.interventions || selectedStudent.interventions.length === 0) && (
                <p className="text-center py-8 text-slate-400">No interventions yet</p>
              )}
            </div>
          </div>
          
          {/* MTSS Meetings */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">MTSS Meetings</h2>
              </div>
              {!selectedStudent.archived && selectedStudent.tier > 1 && (
                <button
                  onClick={() => openMTSSMeetingForm()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition-colors"
                >
                  <Plus size={16} />
                  New Meeting
                </button>
              )}
            </div>
            
            {selectedStudent.tier === 1 && (
              <p className="text-sm text-gray-500 italic mb-4">
                MTSS Meetings are for Tier 2 and 3 students. Use the Pre-Referral Form to move this student into the MTSS process.
              </p>
            )}
            
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {/* Structured MTSS Meetings */}
              {mtssMeetings.map((meeting) => (
                <div key={meeting.id} className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-emerald-600 text-white text-xs rounded-full">
                        Meeting #{meeting.meeting_number}
                      </span>
                      <span className="text-sm text-emerald-700 font-medium">
                        {meeting.meeting_type === '4-week' ? '4-Week Review' : 
                         meeting.meeting_type === '6-week' ? '6-Week Review' : 
                         meeting.meeting_type === 'final-review' ? 'Final Review' : 'Other'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {meeting.meeting_date ? new Date(meeting.meeting_date).toLocaleDateString() : 'No date'}
                    </span>
                  </div>
                  
                  {meeting.tier_decision && (
                    <div className="mb-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        meeting.tier_decision === 'move_tier1' ? 'bg-green-100 text-green-700' :
                        meeting.tier_decision === 'move_tier3' ? 'bg-red-100 text-red-700' :
                        meeting.tier_decision.includes('refer') ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {meeting.tier_decision === 'stay_tier2_continue' ? 'Continue Tier 2' :
                         meeting.tier_decision === 'stay_tier2_modify' ? 'Modify Tier 2' :
                         meeting.tier_decision === 'move_tier1' ? 'Move to Tier 1' :
                         meeting.tier_decision === 'move_tier3' ? 'Move to Tier 3' :
                         meeting.tier_decision === 'refer_sped' ? 'Refer for SpEd' :
                         meeting.tier_decision === 'refer_504' ? 'Refer for 504' : meeting.tier_decision}
                      </span>
                    </div>
                  )}
                  
                  {meeting.progress_summary && (
                    <p className="text-sm text-slate-700 mb-2">{meeting.progress_summary}</p>
                  )}
                  
                  {meeting.attendees && (
                    <p className="text-xs text-slate-500">
                      Attendees: {Object.entries(meeting.attendees)
                        .filter(([key, val]) => val === true)
                        .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
                        .join(', ') || 'None recorded'}
                    </p>
                  )}
                  
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => openMTSSMeetingForm(meeting)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteMTSSMeeting(meeting.id)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              
              {/* Legacy Progress Notes */}
              {selectedStudent.progressNotes?.map((note, idx) => (
                <div key={`legacy-${idx}`} className="p-4 bg-slate-50 rounded-xl border-l-4 border-slate-300 border-dashed">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-600">{note.author_name || 'Staff'}</span>
                      <span className="text-xs text-slate-400">📝 Legacy Note</span>
                    </div>
                    <span className="text-xs text-slate-400">{formatWeekOf(note.meeting_date || note.created_at)}</span>
                  </div>
                  <p className="text-sm text-slate-700">{note.note}</p>
                </div>
              ))}
              
              {mtssMeetings.length === 0 && (!selectedStudent.progressNotes || selectedStudent.progressNotes.length === 0) && (
                <p className="text-sm text-gray-400 italic text-center py-4">No meetings recorded yet.</p>
              )}
            </div>
          </div>
        </div>
          
        {/* MTSS Meeting Form Modal */}
      {showMTSSMeetingForm && selectedStudent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">
                {currentMTSSMeeting ? 'Edit' : 'New'} MTSS Progress Review Meeting
              </h2>
              <button onClick={() => setShowMTSSMeetingForm(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Meeting Info Section */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <Calendar size={18} />
                  Meeting Information
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Date</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 border rounded-lg"
                      defaultValue={mtssMeetingForm.meeting_date}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, meeting_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meeting #</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg"
                      defaultValue={mtssMeetingForm.meeting_number}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, meeting_number: parseInt(e.target.value) }))}
                    >
                      <option value={1}>1st Meeting</option>
                      <option value={2}>2nd Meeting</option>
                      <option value={3}>3rd Meeting</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Type</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg"
                      defaultValue={mtssMeetingForm.meeting_type}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, meeting_type: e.target.value }))}
                    >
                      <option value="4-week">4-Week Review</option>
                      <option value="6-week">6-Week Review</option>
                      <option value="final-review">Final Review</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                
                {/* Attendees */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Attendees</label>
                  <div className="flex flex-wrap gap-4">
                    {['teacher', 'counselor', 'admin', 'parent', 'specialist'].map(role => (
                      <label key={role} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={mtssMeetingForm.attendees[role] || false}
                          onChange={(e) => setMTSSMeetingForm(prev => ({
                            ...prev,
                            attendees: { ...prev.attendees, [role]: e.target.checked },
                            parent_attended: role === 'parent' ? e.target.checked : prev.parent_attended
                          }))}
                        />
                        <span className="capitalize">{role}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Intervention Reviews Section */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <ClipboardList size={18} />
                  Intervention Progress Review
                </h3>
                
                {mtssMeetingForm.intervention_reviews.length === 0 ? (
                  <p className="text-gray-500 italic">No active interventions to review.</p>
                ) : (
                  <div className="space-y-4">
                    {mtssMeetingForm.intervention_reviews.map((review, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-4 border">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-medium text-gray-800">{review.intervention_name}</h4>
                            <p className="text-sm text-gray-500">
                              Avg Rating: {review.avg_rating ? Number(review.avg_rating).toFixed(1) : 'N/A'} | 
                              Logs: {review.total_logs || 0}
                            </p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Implementation Fidelity</label>
                            <select
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                              value={review.implementation_fidelity || ''}
                              onChange={(e) => updateInterventionReview(review.student_intervention_id, 'implementation_fidelity', e.target.value)}
                            >
                              <option value="">Select...</option>
                              <option value="yes">Yes - Implemented as planned</option>
                              <option value="partial">Partial - Some modifications</option>
                              <option value="no">No - Not implemented consistently</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Progress Toward Goal</label>
                            <select
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                              value={review.progress_toward_goal || ''}
                              onChange={(e) => updateInterventionReview(review.student_intervention_id, 'progress_toward_goal', e.target.value)}
                            >
                              <option value="">Select...</option>
                              <option value="met">Goal Met</option>
                              <option value="progressing">Progressing</option>
                              <option value="minimal">Minimal Progress</option>
                              <option value="no_progress">No Progress</option>
                              <option value="regression">Regression</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Recommendation</label>
                            <select
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                              value={review.recommendation || ''}
                              onChange={(e) => updateInterventionReview(review.student_intervention_id, 'recommendation', e.target.value)}
                            >
                              <option value="">Select...</option>
                              <option value="continue">Continue as-is</option>
                              <option value="modify">Modify intervention</option>
                              <option value="discontinue_met">Discontinue - Goal met</option>
                              <option value="discontinue_ineffective">Discontinue - Ineffective</option>
                              <option value="add_support">Add additional support</option>
                            </select>
                          </div>
                        </div>
                        
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                          <textarea
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            rows={2}
                            placeholder="Notes about this intervention..."
                            defaultValue={review.notes || ''}
                            onBlur={(e) => updateInterventionReview(review.student_intervention_id, 'notes', e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Overall Decision Section */}
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <CheckCircle size={18} />
                  Team Decision
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Progress Summary</label>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Summarize the student's overall progress..."
                      defaultValue={mtssMeetingForm.progress_summary}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, progress_summary: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tier Decision</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg"
                      defaultValue={mtssMeetingForm.tier_decision}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, tier_decision: e.target.value }))}
                    >
                      <option value="">Select decision...</option>
                      <option value="stay_tier2_continue">Stay at Tier 2 - Continue interventions</option>
                      <option value="stay_tier2_modify">Stay at Tier 2 - Modify interventions</option>
                      <option value="move_tier1">Move to Tier 1 - Goals met</option>
                      <option value="move_tier3">Move to Tier 3 - Needs intensive support</option>
                      <option value="refer_sped">Refer for Special Education evaluation</option>
                      <option value="refer_504">Refer for 504 Plan</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next Steps</label>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Action items and next steps..."
                      defaultValue={mtssMeetingForm.next_steps}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, next_steps: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next Meeting Date</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 border rounded-lg"
                      defaultValue={mtssMeetingForm.next_meeting_date}
                      onBlur={(e) => setMTSSMeetingForm(prev => ({ ...prev, next_meeting_date: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setShowMTSSMeetingForm(false)}
                className="px-4 py-2 border rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={saveMTSSMeeting}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2"
              >
                <Save size={18} />
                {currentMTSSMeeting ? 'Update Meeting' : 'Save Meeting'}
              </button>
            </div>
          </div>
        </div>
      )}  
      {/* Intervention Plan Modal */}
      {showInterventionPlanModal && currentPlanIntervention && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <FileText size={24} />
                  {planTemplate?.name || currentPlanIntervention.intervention_name}
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
                onClick={closeInterventionPlanModal}
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
                  <span className="text-green-600">✓ Auto-saved</span>
                )}
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={closeInterventionPlanModal}
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
      )}      
            {/* Pre-Referral Form Modal */}
      {showPreReferralForm && preReferralForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Pre-Referral Form</h3>
                <p className="text-sm text-slate-500">
                  {selectedStudent?.first_name} {selectedStudent?.last_name} - Step {preReferralStep} of 11
                </p>
              </div>
              <button 
                onClick={() => setShowPreReferralForm(false)} 
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="px-4 py-2 bg-slate-50">
              <div className="flex gap-1">
                {[1,2,3,4,5,6,7,8,9,10,11].map(step => (
                  <div
                    key={step}
                    className={`h-2 flex-1 rounded ${step <= preReferralStep ? 'bg-indigo-500' : 'bg-slate-200'}`}
                  />
                ))}
              </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto p-6">
              
              {/* Step 1: Referral Information */}
              {preReferralStep === 1 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 1: Referral Information</h4>
                  
                  <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                    <div>
                      <span className="text-sm text-slate-500">Student Name</span>
                      <p className="font-medium">{selectedStudent?.first_name} {selectedStudent?.last_name}</p>
                    </div>
                    <div>
                      <span className="text-sm text-slate-500">Grade</span>
                      <p className="font-medium">{selectedStudent?.grade || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-slate-500">Current Tier</span>
                      <p className="font-medium">Tier {selectedStudent?.tier}</p>
                    </div>
                    <div>
                      <span className="text-sm text-slate-500">Area</span>
                      <p className="font-medium">{selectedStudent?.area || 'N/A'}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Referral Initiated By</label>
                    <select
                      defaultValue={preReferralForm.initiated_by || 'staff'}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { initiated_by: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="staff">School Staff</option>
                      <option value="parent">Parent/Guardian</option>
                      <option value="student">Student Self-Referral</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Referral Date</label>
                    <input
                      type="date"
                      defaultValue={preReferralForm.referral_date?.split('T')[0] || new Date().toISOString().split('T')[0]}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { referral_date: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Area of Concern */}
              {preReferralStep === 2 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 2: Area of Concern</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Primary Area(s) of Concern</label>
                    <div className="space-y-2">
                      {['Academic', 'Behavior', 'Social-Emotional'].map(area => (
                        <label key={area} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            defaultChecked={preReferralForm.concern_areas?.includes(area)}
                            onChange={(e) => {
                              const current = preReferralForm.concern_areas || [];
                              const updated = e.target.checked 
                                ? [...current, area]
                                : current.filter(a => a !== area);
                              savePreReferralForm(preReferralForm.id, { concern_areas: updated });
                            }}
                            className="w-4 h-4 text-indigo-600 rounded"
                          />
                          <span>{area}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Specific Concerns</label>
                    <textarea
                      defaultValue={preReferralForm.specific_concerns || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { specific_concerns: e.target.value })}
                      placeholder="Describe specific concerns..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={4}
                    />
                  </div>
                </div>
              )}

              {/* Step 3: Detailed Description */}
              {preReferralStep === 3 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 3: Detailed Description</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Describe the concern in detail</label>
                    <textarea
                      defaultValue={preReferralForm.concern_description || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { concern_description: e.target.value })}
                      placeholder="Provide a detailed description of the concern..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={4}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">When did you first notice?</label>
                      <select
                        defaultValue={preReferralForm.concern_first_noticed || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { concern_first_noticed: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="less_than_1_month">Less than 1 month ago</option>
                        <option value="1_to_3_months">1-3 months ago</option>
                        <option value="3_to_6_months">3-6 months ago</option>
                        <option value="6_to_12_months">6-12 months ago</option>
                        <option value="more_than_1_year">More than 1 year ago</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">How often does it occur?</label>
                      <select
                        defaultValue={preReferralForm.concern_frequency || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { concern_frequency: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="daily">Daily</option>
                        <option value="several_times_week">Several times per week</option>
                        <option value="weekly">Weekly</option>
                        <option value="occasionally">Occasionally</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Medical & Background */}
              {preReferralStep === 4 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 4: Medical & Background Information</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Hearing tested in last 2 years?</label>
                      <select
                        defaultValue={preReferralForm.hearing_tested || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { hearing_tested: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Vision tested in last 2 years?</label>
                      <select
                        defaultValue={preReferralForm.vision_tested || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { vision_tested: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Known Medical Diagnoses</label>
                    <textarea
                      defaultValue={preReferralForm.medical_diagnoses || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { medical_diagnoses: e.target.value })}
                      placeholder="List any known medical diagnoses..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Medications Affecting Learning</label>
                    <textarea
                      defaultValue={preReferralForm.medications || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { medications: e.target.value })}
                      placeholder="List any medications that may affect learning..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Academic Performance */}
              {preReferralStep === 5 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 5: Current Academic Performance</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Grades/Progress</label>
                    <textarea
                      defaultValue={preReferralForm.current_grades || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { current_grades: e.target.value })}
                      placeholder="Describe current academic performance..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Recent Assessment Scores</label>
                    <textarea
                      defaultValue={preReferralForm.assessment_scores || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { assessment_scores: e.target.value })}
                      placeholder="List any recent assessment scores..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Support Classes</label>
                    <textarea
                      defaultValue={preReferralForm.support_classes || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { support_classes: e.target.value })}
                      placeholder="List any current support classes or services..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Step 6: Existing Plans */}
              {preReferralStep === 6 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 6: Existing Plans & Supports</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Current Plans</label>
                    <div className="space-y-2">
                      {['504 Plan', 'IEP', 'Safety Plan', 'Behavior Plan', 'None'].map(plan => (
                        <label key={plan} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            defaultChecked={preReferralForm.current_plans?.includes(plan)}
                            onChange={(e) => {
                              const current = preReferralForm.current_plans || [];
                              const updated = e.target.checked 
                                ? [...current, plan]
                                : current.filter(p => p !== plan);
                              savePreReferralForm(preReferralForm.id, { current_plans: updated });
                            }}
                            className="w-4 h-4 text-indigo-600 rounded"
                          />
                          <span>{plan}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Plan Details</label>
                    <textarea
                      defaultValue={preReferralForm.plan_details || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { plan_details: e.target.value })}
                      placeholder="Provide details about existing plans..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">External Supports</label>
                    <textarea
                      defaultValue={preReferralForm.external_supports || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { external_supports: e.target.value })}
                      placeholder="List any external supports (counseling, tutoring, community services)..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Step 7: Prior Interventions */}
              {preReferralStep === 7 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 7: Prior Interventions Attempted</h4>
                  
                  {preReferralForm.prior_interventions?.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">The following interventions were found in TierTrak:</p>
                      {preReferralForm.prior_interventions.map((intervention, index) => (
                        <div key={index} className="p-3 bg-slate-50 rounded-lg">
                          <p className="font-medium">{intervention.name}</p>
                          <p className="text-sm text-slate-500">Started: {intervention.start_date ? formatWeekOf(intervention.start_date) : 'Unknown'}</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder="Duration used"
                              defaultValue={intervention.duration || ''}
                              onBlur={(e) => {
                                const updated = [...preReferralForm.prior_interventions];
                                updated[index].duration = e.target.value;
                                savePreReferralForm(preReferralForm.id, { prior_interventions: updated });
                              }}
                              className="px-2 py-1 text-sm border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              placeholder="Outcome/response"
                              defaultValue={intervention.outcome || ''}
                              onBlur={(e) => {
                                const updated = [...preReferralForm.prior_interventions];
                                updated[index].outcome = e.target.value;
                                savePreReferralForm(preReferralForm.id, { prior_interventions: updated });
                              }}
                              className="px-2 py-1 text-sm border border-slate-200 rounded"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No interventions found in TierTrak for this student.</p>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Other Interventions Not Listed Above</label>
                    <textarea
                      defaultValue={preReferralForm.other_interventions || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { other_interventions: e.target.value })}
                      placeholder="List any other interventions that were tried..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>
                </div>
              )}

              {/* Step 8: Student Strengths */}
              {preReferralStep === 8 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 8: Student Strengths</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Academic Strengths</label>
                    <textarea
                      defaultValue={preReferralForm.academic_strengths || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { academic_strengths: e.target.value })}
                      placeholder="What are the student's academic strengths?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Social Strengths</label>
                    <textarea
                      defaultValue={preReferralForm.social_strengths || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { social_strengths: e.target.value })}
                      placeholder="What are the student's social strengths?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Interests/Preferred Activities</label>
                    <textarea
                      defaultValue={preReferralForm.interests || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { interests: e.target.value })}
                      placeholder="What does the student enjoy?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">What Motivates This Student?</label>
                    <textarea
                      defaultValue={preReferralForm.motivators || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { motivators: e.target.value })}
                      placeholder="What motivates the student?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Step 9: Parent Contact */}
              {preReferralStep === 9 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 9: Parent/Guardian Contact</h4>
                  <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">⚠️ Parent contact is required before submitting this form.</p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Parent/Guardian Name *</label>
                      <input
                        type="text"
                        defaultValue={preReferralForm.parent_name || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_name: e.target.value })}
                        placeholder="Enter name"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Relationship</label>
                      <select
                        defaultValue={preReferralForm.parent_relationship || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_relationship: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="mother">Mother</option>
                        <option value="father">Father</option>
                        <option value="guardian">Guardian</option>
                        <option value="grandparent">Grandparent</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        defaultValue={preReferralForm.parent_phone || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_phone: e.target.value })}
                        placeholder="(555) 555-5555"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                      <input
                        type="email"
                        defaultValue={preReferralForm.parent_email || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_email: e.target.value })}
                        placeholder="email@example.com"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Date of Contact *</label>
                      <input
                        type="date"
                        defaultValue={preReferralForm.contact_date?.split('T')[0] || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { contact_date: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Contact Method *</label>
                      <select
                        defaultValue={preReferralForm.contact_method || ''}
                        onBlur={(e) => savePreReferralForm(preReferralForm.id, { contact_method: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select...</option>
                        <option value="phone">Phone Call</option>
                        <option value="email">Email</option>
                        <option value="in_person">In Person</option>
                        <option value="text">Text Message</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Parent Input/Concerns Shared *</label>
                    <textarea
                      defaultValue={preReferralForm.parent_input || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_input: e.target.value })}
                      placeholder="What did the parent share during the conversation?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Supports Used at Home</label>
                    <textarea
                      defaultValue={preReferralForm.home_supports || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { home_supports: e.target.value })}
                      placeholder="What strategies are working at home?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Parent Supports This Referral?</label>
                    <select
                      defaultValue={preReferralForm.parent_supports_referral || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { parent_supports_referral: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      <option value="partial">Partially</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Step 10: Reason for Referral */}
              {preReferralStep === 10 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 10: Reason for Referral</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Why are Tier 1 supports insufficient? *</label>
                    <textarea
                      defaultValue={preReferralForm.why_tier1_insufficient || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { why_tier1_insufficient: e.target.value })}
                      placeholder="Explain why current Tier 1 supports are not meeting this student's needs..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={4}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">What data supports this referral?</label>
                    <textarea
                      defaultValue={preReferralForm.supporting_data || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { supporting_data: e.target.value })}
                      placeholder="List data points that support this referral (grades, behavior incidents, assessments, etc.)..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Specific Event(s) Prompting Referral</label>
                    <textarea
                      defaultValue={preReferralForm.triggering_events || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { triggering_events: e.target.value })}
                      placeholder="Were there specific events that prompted this referral?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {/* Step 11: Recommendations */}
              {preReferralStep === 11 && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800 text-lg">Step 11: Recommendations</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Tier *</label>
                    <select
                      defaultValue={preReferralForm.recommended_tier || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { recommended_tier: parseInt(e.target.value) || null })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select recommended tier...</option>
                      <option value="2">Tier 2 - Targeted Support</option>
                      <option value="3">Tier 3 - Intensive Support</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Interventions</label>
                    <textarea
                      defaultValue={preReferralForm.recommended_interventions || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { recommended_interventions: e.target.value })}
                      placeholder="What interventions do you recommend?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Assessments</label>
                    <textarea
                      defaultValue={preReferralForm.recommended_assessments || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { recommended_assessments: e.target.value })}
                      placeholder="What assessments should be conducted?"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Additional Recommendations</label>
                    <textarea
                      defaultValue={preReferralForm.additional_recommendations || ''}
                      onBlur={(e) => savePreReferralForm(preReferralForm.id, { additional_recommendations: e.target.value })}
                      placeholder="Any other recommendations..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      rows={2}
                    />
                  </div>

                  {preReferralForm.status === 'draft' && (
                    <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                      <p className="text-sm text-amber-800 mb-2">
                        <strong>Ready to submit?</strong> Make sure you have contacted the parent (Step 9) before submitting.
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Footer with Navigation */}
            <div className="p-4 border-t border-slate-200 flex items-center justify-between">
              <div>
                {preReferralStep > 1 && (
                  <button
                    onClick={() => setPreReferralStep(preReferralStep - 1)}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800 flex items-center gap-1"
                  >
                    <ArrowLeft className="w-4 h-4" /> Previous
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPreReferralForm(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800"
                >
                  Save & Close
                </button>
                
                {preReferralStep < 11 ? (
                  <button
                    onClick={() => setPreReferralStep(preReferralStep + 1)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1"
                  >
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  preReferralForm.status === 'draft' && (
                    <button
                      onClick={async () => {
                        if (!preReferralForm.parent_name || !preReferralForm.contact_date || !preReferralForm.parent_input) {
                          alert('Please complete the Parent Contact section (Step 9) before submitting.');
                          setPreReferralStep(9);
                          return;
                        }
                        if (!preReferralForm.recommended_tier) {
                          alert('Please select a recommended tier before submitting.');
                          return;
                        }
                        const staffName = prompt('Type your name to sign and submit this form:');
                        if (staffName) {
                          await submitPreReferralForm(preReferralForm.id, staffName);
                          alert('Form submitted for counselor approval!');
                          setShowPreReferralForm(false);
                        }
                      }}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1"
                    >
                      <CheckCircle className="w-4 h-4" /> Submit for Approval
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
        
        {/* MTSS Meeting Modal */}
        {showAddNote && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">New MTSS Meeting Note</h3>
                <button onClick={() => { setShowAddNote(false); setNewNote(''); }} className="text-slate-500 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Meeting Date</label>
                <input
                  type="date"
                  value={noteDate}
                  onChange={(e) => setNoteDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  ref={noteTextareaRef}
                  placeholder="Document meeting discussion, decisions, next steps..."
                  defaultValue=""
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={4}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowAddNote(false); setNewNote(''); setNoteDate(new Date().toISOString().split('T')[0]); }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Save size={16} />
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {/* MTSS Report Modal */}
{showReport && selectedStudent && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:bg-white print:block print:relative">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:mx-0">
      
      {/* Modal Header - Hidden when printing */}
      <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between print:hidden">
        <h2 className="text-xl font-bold text-gray-900">MTSS Progress Report</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">From:</label>
            <input
              type="date"
              value={reportDateRange.startDate}
              onChange={(e) => setReportDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="px-2 py-1 border rounded text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">To:</label>
            <input
              type="date"
              value={reportDateRange.endDate}
              onChange={(e) => setReportDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="px-2 py-1 border rounded text-sm"
            />
          </div>
          <button
            onClick={printReport}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <Printer size={18} />
            Print
          </button>
          <button
            onClick={() => setShowReport(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Report Content */}
      <div className="p-8 print:p-0">
        
        {/* Report Header */}
        <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">MTSS Progress Report</h1>
          <p className="text-gray-600">Multi-Tiered System of Supports</p>
        </div>

        {/* Student Info */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg print:bg-white print:border print:border-gray-300">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Student Name</p>
              <p className="font-semibold text-gray-900">{selectedStudent.first_name} {selectedStudent.last_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Grade</p>
              <p className="font-semibold text-gray-900">{selectedStudent.grade || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Current Tier</p>
              <p className={`font-semibold ${
                selectedStudent.tier === 1 ? 'text-emerald-600' :
                selectedStudent.tier === 2 ? 'text-amber-600' : 'text-rose-600'
              }`}>Tier {selectedStudent.tier}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Focus Area</p>
              <p className="font-semibold text-gray-900">{selectedStudent.area || 'N/A'}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Report Period</p>
            <p className="font-semibold text-gray-900">
              {reportDateRange.startDate ? new Date(reportDateRange.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not set'} — {reportDateRange.endDate ? new Date(reportDateRange.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not set'}
            </p>
          </div>
        </div>

        {/* Interventions & Progress */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">Interventions & Progress</h2>
          
          {(selectedStudent.interventions || []).length === 0 ? (
            <p className="text-gray-500 italic">No interventions assigned.</p>
          ) : (
            (selectedStudent.interventions || []).map(intervention => {
              const progressLogs = reportData?.progressMap?.[intervention.id] || [];
              const filteredLogs = filterByDateRange(progressLogs, 'week_of');
              
              return (
                <div key={intervention.id} className="mb-6 p-4 border rounded-lg print:break-inside-avoid">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{intervention.intervention_name}</h3>
                      <p className="text-sm text-gray-500">
                        Started: {intervention.start_date ? new Date(intervention.start_date + 'T00:00:00').toLocaleDateString() : 'N/A'}
                        {intervention.status !== 'active' && (
                          <span className="ml-2 text-amber-600">({intervention.status})</span>
                        )}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      intervention.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      intervention.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {intervention.status}
                    </span>
                  </div>

                  {/* Goal if set */}
                  {intervention.goal_description && (
                    <div className="mb-3 p-3 bg-indigo-50 rounded print:bg-white print:border print:border-indigo-200">
                      <p className="text-xs text-indigo-600 uppercase tracking-wide font-medium">Goal</p>
                      <p className="text-sm text-gray-900">{intervention.goal_description}</p>
                      {intervention.goal_target_date && (
                        <p className="text-xs text-gray-500 mt-1">
                          Target: {new Date(intervention.goal_target_date + 'T00:00:00').toLocaleDateString()} 
                          {intervention.goal_target_rating && ` • Target Rating: ${intervention.goal_target_rating}/5`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {intervention.notes && (
                    <p className="text-sm text-gray-600 mb-3">{intervention.notes}</p>
                  )}

                  {/* Progress Table */}
                  {filteredLogs.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="text-left py-2 px-3 font-medium text-gray-700">Week Of</th>
                            <th className="text-left py-2 px-3 font-medium text-gray-700">Implementation</th>
                            <th className="text-center py-2 px-3 font-medium text-gray-700">Rating</th>
                            <th className="text-left py-2 px-3 font-medium text-gray-700">Response</th>
                            <th className="text-left py-2 px-3 font-medium text-gray-700">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLogs.sort((a, b) => new Date(b.week_of) - new Date(a.week_of)).map(log => (
                            <tr key={log.id} className="border-b">
                              <td className="py-2 px-3">{new Date(log.week_of + 'T00:00:00').toLocaleDateString()}</td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  log.status === 'Implemented as Planned' ? 'bg-emerald-100 text-emerald-700' :
                                  log.status === 'Partially Implemented' ? 'bg-amber-100 text-amber-700' :
                                  log.status === 'Student Absent' ? 'bg-gray-100 text-gray-600' :
                                  'bg-rose-100 text-rose-700'
                                }`}>
                                  {log.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                {log.rating ? (
                                  <span className={`font-medium ${
                                    log.rating >= 4 ? 'text-emerald-600' :
                                    log.rating === 3 ? 'text-amber-600' : 'text-rose-600'
                                  }`}>
                                    {log.rating}/5
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="py-2 px-3">{log.response || '—'}</td>
                              <td className="py-2 px-3 text-gray-600">{log.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No progress logs during this period.</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* MTSS Meeting Notes */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">MTSS Meeting Notes</h2>
          
          {(() => {
            const filteredNotes = filterByDateRange(selectedStudent.progress_notes || [], 'meeting_date');
            return filteredNotes.length === 0 ? (
              <p className="text-gray-500 italic">No meeting notes during this period.</p>
            ) : (
              <div className="space-y-4">
                {filteredNotes.sort((a, b) => new Date(b.meeting_date) - new Date(a.meeting_date)).map(note => (
                  <div key={note.id} className="p-4 border rounded-lg print:break-inside-avoid">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900">
                        {note.meeting_date ? new Date(note.meeting_date + 'T00:00:00').toLocaleDateString('en-US', { 
                          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                        }) : 'No date'}
                      </p>
                      <p className="text-sm text-gray-500">{note.author_name || 'Unknown'}</p>
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap">{note.note}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Signature Lines */}
        <div className="mt-12 pt-8 border-t-2 border-gray-300 print:break-inside-avoid">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Signatures</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="border-b border-gray-400 mb-2 h-10"></div>
              <p className="text-sm text-gray-600">Counselor</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm text-gray-500">Date:</span>
                <div className="border-b border-gray-300 flex-1"></div>
              </div>
            </div>
            
            <div>
              <div className="border-b border-gray-400 mb-2 h-10"></div>
              <p className="text-sm text-gray-600">Parent/Guardian</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm text-gray-500">Date:</span>
                <div className="border-b border-gray-300 flex-1"></div>
              </div>
            </div>
            
            <div>
              <div className="border-b border-gray-400 mb-2 h-10"></div>
              <p className="text-sm text-gray-600">Administrator</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-sm text-gray-500">Date:</span>
                <div className="border-b border-gray-300 flex-1"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t text-center text-sm text-gray-500">
          <p>Generated on {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
          })}</p>
          <p className="mt-1">TierTrak MTSS Management System</p>
        </div>

      </div>
    </div>
  </div>
)}
        {/* Archive Modal */}
        {showArchiveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Archive className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Archive Student</h3>
                  <p className="text-sm text-gray-500">{selectedStudent.first_name} {selectedStudent.last_name}</p>
                </div>
              </div>
              
              <p className="text-gray-600 mb-4">
                Archiving will remove this student from the active list but preserve all intervention data and notes. You can reactivate them at any time.
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for archiving <span className="text-red-500">*</span>
                </label>
                <select
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Select a reason...</option>
                  {archiveReasons.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowArchiveModal(false); setArchiveReason(''); }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleArchiveStudent}
                  disabled={!archiveReason}
                  className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Archive Student
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Pre-Referral Form Modal */}
        {showPreReferralForm && preReferralForm && (
  <div key={preReferralForm.id} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-amber-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Pre-Referral Form</h2>
                  <p className="text-sm text-slate-600">
                    {selectedStudent?.first_name} {selectedStudent?.last_name} • Step {preReferralFormStep} of 11
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowPreReferralForm(false);
                    setPreReferralFormStep(1);
                  }}
                  className="p-2 hover:bg-amber-100 rounded-lg transition"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="px-6 py-3 bg-slate-50 border-b">
                <div className="flex gap-1">
                  {[1,2,3,4,5,6,7,8,9,10,11].map(step => (
                    <div
                      key={step}
                      className={`h-2 flex-1 rounded-full ${
                        step <= preReferralFormStep ? 'bg-amber-500' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-xs text-slate-500">
                  <span>Start</span>
                  <span>Complete</span>
                </div>
              </div>

              {/* Form Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Step 1: Referral Info */}
                {preReferralFormStep === 1 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 1: Referral Information</h3>
                    
                    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg">
                      <div>
                        <span className="text-sm text-slate-500">Student Name</span>
                        <p className="font-medium">{selectedStudent?.first_name} {selectedStudent?.last_name}</p>
                      </div>
                      <div>
                        <span className="text-sm text-slate-500">Grade</span>
                        <p className="font-medium">{selectedStudent?.grade}</p>
                      </div>
                      <div>
                        <span className="text-sm text-slate-500">Current Tier</span>
                        <p className="font-medium">Tier {selectedStudent?.tier}</p>
                      </div>
                      <div>
                        <span className="text-sm text-slate-500">Area</span>
                        <p className="font-medium">{selectedStudent?.area || 'Not set'}</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Who initiated this referral? *
                      </label>
                      <select
                        value={preReferralForm.initiated_by || 'staff'}
                        onChange={(e) => setPreReferralForm({...preReferralForm, initiated_by: e.target.value})}
                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      >
                        <option value="staff">Staff Member</option>
                        <option value="parent">Parent/Guardian</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {preReferralForm.initiated_by === 'other' && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Please explain:
                        </label>
                        <input
                          type="text"
                          value={preReferralForm.initiated_by_other || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, initiated_by_other: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                          placeholder="Who initiated this referral?"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Area of Concern */}
                {preReferralFormStep === 2 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 2: Area of Concern</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-3">
                        Select all areas of concern: *
                      </label>
                      <div className="space-y-2">
                        {['Academic', 'Behavior', 'Social-Emotional'].map(area => (
                          <label key={area} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(preReferralForm.concern_areas || []).includes(area)}
                              onChange={(e) => {
                                const current = preReferralForm.concern_areas || [];
                                const updated = e.target.checked
                                  ? [...current, area]
                                  : current.filter(a => a !== area);
                                setPreReferralForm({...preReferralForm, concern_areas: updated});
                              }}
                              className="w-5 h-5 text-amber-500 rounded"
                            />
                            <span className="font-medium">{area}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 3: Detailed Description */}
                {preReferralFormStep === 3 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 3: Detailed Description</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Describe the concern in detail: *
                      </label>
                      <textarea
  defaultValue={preReferralForm.concern_description || ''}
  onBlur={(e) => {
  const value = e.target.value;
  setTimeout(() => setPreReferralForm(prev => ({...prev, concern_description: value})), 100);
}}
                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 h-32"
                        placeholder="Describe what you've observed..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          When did you first notice this concern?
                        </label>
                        <select
                          value={preReferralForm.concern_first_noticed || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, concern_first_noticed: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Select...</option>
                          <option value="Less than 1 month">Less than 1 month</option>
                          <option value="1-3 months">1-3 months</option>
                          <option value="3-6 months">3-6 months</option>
                          <option value="6-12 months">6-12 months</option>
                          <option value="More than 1 year">More than 1 year</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          How often does the concern occur?
                        </label>
                        <select
                          value={preReferralForm.concern_frequency || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, concern_frequency: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Select...</option>
                          <option value="Daily">Daily</option>
                          <option value="Several times per week">Several times per week</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Occasionally">Occasionally</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Medical/Background */}
                {preReferralFormStep === 4 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 4: Medical & Background Information</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Hearing tested in last 2 years?
                        </label>
                        <select
                          value={preReferralForm.hearing_tested || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, hearing_tested: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        >
                          <option value="">Select...</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Vision tested in last 2 years?
                        </label>
                        <select
                          value={preReferralForm.vision_tested || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, vision_tested: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        >
                          <option value="">Select...</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Known medical diagnoses
                      </label>
                      <textarea
                        defaultValue={preReferralForm.medical_diagnoses || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, medical_diagnoses: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="List any known medical diagnoses..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Known mental health diagnoses
                      </label>
                      <textarea
  defaultValue={preReferralForm.mental_health_diagnoses || ''}
  onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, mental_health_diagnoses: value})), 100); }}
  className="w-full p-3 border border-slate-200 rounded-lg h-20"
  placeholder="List any known mental health diagnoses..."
/>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Current medications that may affect learning
                      </label>
                      <textarea
                        defaultValue={preReferralForm.medications || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, medications: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="List any relevant medications..."
                      />
                    </div>
                  </div>
                )}

                {/* Step 5: Academic Performance */}
                {preReferralFormStep === 5 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 5: Current Academic Performance</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Current grades/progress
                      </label>
                      <textarea
                        defaultValue={preReferralForm.current_grades || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, current_grades: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="Describe current academic standing..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Recent assessment scores
                      </label>
                      <textarea
                        defaultValue={preReferralForm.assessment_scores || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, assessment_scores: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="List any relevant test scores or assessments..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Current support classes (if any)
                      </label>
                      <textarea
                        defaultValue={preReferralForm.support_classes || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, support_classes: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="E.g., Resource room, reading intervention, etc."
                      />
                    </div>
                  </div>
                )}

                {/* Step 6: Existing Plans */}
                {preReferralFormStep === 6 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 6: Existing Plans & Supports</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-3">
                        Does the student have any existing plans?
                      </label>
                      <div className="space-y-2">
                        {['504', 'IEP', 'Safety Plan', 'Behavior Plan', 'None'].map(plan => (
                          <label key={plan} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(preReferralForm.current_plans || []).includes(plan)}
                              onChange={(e) => {
                                const current = preReferralForm.current_plans || [];
                                const updated = e.target.checked
                                  ? [...current, plan]
                                  : current.filter(p => p !== plan);
                                setPreReferralForm({...preReferralForm, current_plans: updated});
                              }}
                              className="w-5 h-5 text-amber-500 rounded"
                            />
                            <span>{plan}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Plan details (disability category, accommodations, etc.)
                      </label>
                      <textarea
                        defaultValue={preReferralForm.plan_details || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, plan_details: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="Provide details about existing plans..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        External supports (counseling, tutoring, community services)
                      </label>
                      <textarea
                        defaultValue={preReferralForm.external_supports || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, external_supports: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="List any external supports the student receives..."
                      />
                    </div>
                  </div>
                )}

                {/* Step 7: Prior Interventions */}
                {preReferralFormStep === 7 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 7: Prior Interventions Attempted</h3>
                    
                    {(preReferralForm.prior_interventions || []).length > 0 ? (
                      <div className="space-y-4">
                        <p className="text-sm text-slate-600">
                          The following interventions were auto-populated from TierTrak. Please add duration, frequency, and outcome for each:
                        </p>
                        {(preReferralForm.prior_interventions || []).map((intervention, index) => (
                          <div key={index} className="p-4 border rounded-lg bg-slate-50">
                            <p className="font-medium text-slate-800 mb-3">{intervention.name}</p>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Duration</label>
                                <input
                                  type="text"
                                  defaultValue={intervention.duration || ''}
onBlur={(e) => {
  const updated = [...preReferralForm.prior_interventions];
  updated[index].duration = e.target.value;
  setPreReferralForm(prev => ({...prev, prior_interventions: updated}));
}}
                                  className="w-full p-2 border rounded text-sm"
                                  placeholder="e.g., 6 weeks"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Frequency</label>
                                <input
                                  type="text"
                                  defaultValue={intervention.frequency || ''}
onBlur={(e) => {
  const updated = [...preReferralForm.prior_interventions];
  updated[index].frequency = e.target.value;
  setPreReferralForm(prev => ({...prev, prior_interventions: updated}));
}}
                                  className="w-full p-2 border rounded text-sm"
                                  placeholder="e.g., 3x/week"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Outcome</label>
                                <input
                                  type="text"
                                  defaultValue={intervention.outcome || ''}
onBlur={(e) => {
  const updated = [...preReferralForm.prior_interventions];
  updated[index].outcome = e.target.value;
  setPreReferralForm(prev => ({...prev, prior_interventions: updated}));
}}
                                  className="w-full p-2 border rounded text-sm"
                                  placeholder="e.g., Minimal progress"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 italic">No interventions found in TierTrak for this student.</p>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Other interventions not listed above
                      </label>
                      <textarea
                        defaultValue={preReferralForm.other_interventions || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, other_interventions: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="List any other interventions that were tried..."
                      />
                    </div>
                  </div>
                )}

                {/* Step 8: Student Strengths */}
                {preReferralFormStep === 8 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 8: Student Strengths</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Academic strengths *
                      </label>
                      <textarea
                        defaultValue={preReferralForm.academic_strengths || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, academic_strengths: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="What subjects or academic skills does the student excel in?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Social strengths
                      </label>
                      <textarea
                        defaultValue={preReferralForm.social_strengths || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, social_strengths: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="What social skills or relationships are positive?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Interests and preferred activities
                      </label>
                      <textarea
                        defaultValue={preReferralForm.interests || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, interests: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="What does the student enjoy doing?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        What motivates this student?
                      </label>
                      <textarea
                        defaultValue={preReferralForm.motivators || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, motivators: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="What rewards, activities, or approaches work well?"
                      />
                    </div>
                  </div>
                )}

                {/* Step 9: Parent Contact */}
                {preReferralFormStep === 9 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 9: Parent/Guardian Contact & Input</h3>
                    <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
                      ⚠️ Parent contact is required before submitting this form.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Parent/Guardian Name *
                        </label>
                        <input
                          type="text"
                          defaultValue={preReferralForm.parent_name || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, parent_name: value})), 100); }}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Relationship *
                        </label>
                        <select
                          value={preReferralForm.parent_relationship || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, parent_relationship: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        >
                          <option value="">Select...</option>
                          <option value="Parent">Parent</option>
                          <option value="Guardian">Guardian</option>
                          <option value="Grandparent">Grandparent</option>
                          <option value="Foster Parent">Foster Parent</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Phone Number *
                        </label>
                        <input
                          type="tel"
                          defaultValue={preReferralForm.parent_phone || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, parent_phone: value})), 100); }}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Email
                        </label>
                        <input
                          type="email"
                          defaultValue={preReferralForm.parent_email || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, parent_email: value})), 100); }}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Date of contact *
                        </label>
                        <input
                          type="date"
                          value={preReferralForm.contact_date || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, contact_date: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Contact method *
                        </label>
                        <select
                          value={preReferralForm.contact_method || ''}
                          onChange={(e) => setPreReferralForm({...preReferralForm, contact_method: e.target.value})}
                          className="w-full p-3 border border-slate-200 rounded-lg"
                        >
                          <option value="">Select...</option>
                          <option value="Phone call">Phone call</option>
                          <option value="Email">Email</option>
                          <option value="In-person">In-person</option>
                          <option value="Text">Text</option>
                          <option value="Video call">Video call</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preReferralForm.parent_informed || false}
                          onChange={(e) => setPreReferralForm({...preReferralForm, parent_informed: e.target.checked})}
                          className="w-5 h-5 text-amber-500 rounded"
                        />
                        <span className="font-medium">I confirm that I have informed the parent/guardian about the concerns *</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Parent's input and concerns *
                      </label>
                      <textarea
                        defaultValue={preReferralForm.parent_input || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, parent_input: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="What did the parent share? What are their concerns?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        What supports are used at home?
                      </label>
                      <textarea
                        defaultValue={preReferralForm.home_supports || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, home_supports: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="What strategies or supports work at home?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Does the parent support this referral? *
                      </label>
                      <select
                        value={preReferralForm.parent_supports_referral || ''}
                        onChange={(e) => setPreReferralForm({...preReferralForm, parent_supports_referral: e.target.value})}
                        className="w-full p-3 border border-slate-200 rounded-lg"
                      >
                        <option value="">Select...</option>
                        <option value="yes">Yes</option>
                        <option value="partial">Partially</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Step 10: Reason for Referral */}
                {preReferralFormStep === 10 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 10: Reason for Referral</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Why are Tier 1 supports insufficient? *
                      </label>
                      <textarea
                        defaultValue={preReferralForm.why_tier1_insufficient || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, why_tier1_insufficient: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-32"
                        placeholder="Explain why universal supports are not meeting this student's needs..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        What data supports this referral? *
                      </label>
                      <textarea
                        defaultValue={preReferralForm.supporting_data || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, supporting_data: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="Include grades, test scores, behavior data, attendance, etc."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Specific event(s) prompting this referral
                      </label>
                      <textarea
                        defaultValue={preReferralForm.triggering_events || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, triggering_events: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="Were there specific incidents that led to this referral?"
                      />
                    </div>
                  </div>
                )}

                {/* Step 11: Recommendations */}
                {preReferralFormStep === 11 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold text-slate-800">Section 11: Recommendations</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Recommended Tier *
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 p-4 border rounded-lg hover:bg-amber-50 cursor-pointer flex-1">
                          <input
                            type="radio"
                            name="recommended_tier"
                            value={2}
                            checked={preReferralForm.recommended_tier === 2}
                            onChange={(e) => setPreReferralForm({...preReferralForm, recommended_tier: 2})}
                            className="w-5 h-5 text-amber-500"
                          />
                          <div>
                            <span className="font-medium">Tier 2</span>
                            <p className="text-sm text-slate-500">Targeted support</p>
                          </div>
                        </label>
                        <label className="flex items-center gap-2 p-4 border rounded-lg hover:bg-rose-50 cursor-pointer flex-1">
                          <input
                            type="radio"
                            name="recommended_tier"
                            value={3}
                            checked={preReferralForm.recommended_tier === 3}
                            onChange={(e) => setPreReferralForm({...preReferralForm, recommended_tier: 3})}
                            className="w-5 h-5 text-rose-500"
                          />
                          <div>
                            <span className="font-medium">Tier 3</span>
                            <p className="text-sm text-slate-500">Intensive support</p>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Recommended interventions
                      </label>
                      <textarea
                        defaultValue={preReferralForm.recommended_supports || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, recommended_supports: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-24"
                        placeholder="What interventions do you recommend?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Recommended assessments
                      </label>
                      <textarea
                        defaultValue={preReferralForm.recommended_assessments || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, recommended_assessments: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="Are any assessments recommended?"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Additional recommendations
                      </label>
                      <textarea
                        defaultValue={preReferralForm.additional_recommendations || ''}
onBlur={(e) => { const value = e.target.value; setTimeout(() => setPreReferralForm(prev => ({...prev, additional_recommendations: value})), 100); }}
                        className="w-full p-3 border border-slate-200 rounded-lg h-20"
                        placeholder="Any other recommendations..."
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer with Navigation */}
              <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between">
                <button
                  onClick={() => setPreReferralFormStep(Math.max(1, preReferralFormStep - 1))}
                  disabled={preReferralFormStep === 1}
                  className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => savePreReferralForm(preReferralForm)}
                    className="px-6 py-2 border border-amber-500 text-amber-600 rounded-lg hover:bg-amber-50 transition"
                  >
                    Save Draft
                  </button>
                  
                  {preReferralFormStep < 11 ? (
                    <button
                      onClick={() => setPreReferralFormStep(preReferralFormStep + 1)}
                      className="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
                    >
                      Next →
                    </button>
                  ) : (
                    <button
                      onClick={submitPreReferralForm}
                      className="px-6 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                    >
                      Submit for Approval
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Unarchive Modal */}
        {showUnarchiveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <RotateCcw className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Reactivate Student</h3>
                  <p className="text-sm text-gray-500">{selectedStudent.first_name} {selectedStudent.last_name}</p>
                </div>
              </div>
              
              <p className="text-gray-600 mb-2">
                This will return the student to the active list. All previous intervention data and notes will be available.
              </p>
              
              {selectedStudent.archived_reason && (
                <p className="text-sm text-gray-500 mb-4">
                  <span className="font-medium">Previously archived:</span> {selectedStudent.archived_reason}
                  {selectedStudent.archived_at && ` on ${new Date(selectedStudent.archived_at).toLocaleDateString()}`}
                </p>
              )}
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowUnarchiveModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUnarchiveStudent()}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                >
                  Reactivate Student
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  };

  // Admin View
  const AdminView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Admin Panel</h1>
          <p className="text-slate-500 mt-1">Manage {user.tenant_name}</p>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setAdminTab('interventions')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'interventions' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={16} />
            Interventions
          </div>
        </button>
        <button
          onClick={() => setAdminTab('students')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'students' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users size={16} />
            Students
          </div>
        </button>
        <button
          onClick={() => { setAdminTab('archived'); fetchArchivedStudents(user.tenant_id); }}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'archived' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Archive size={16} />
            Archived
          </div>
        </button>
        <button
          onClick={() => setAdminTab('import')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'import' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Upload size={16} />
            Import CSV
          </div>
        </button>
        <button
          onClick={() => setAdminTab('templates')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'templates' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <FileText size={16} />
            Plan Templates
          </div>
        </button>
      </div>   
        
        {/* Interventions Tab */}
      {adminTab === 'interventions' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <BookOpen size={24} className="text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-800">Intervention Templates</h2>
            </div>
            <button
              onClick={() => setShowAddTemplate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus size={18} />
              Add Custom Intervention
            </button>
          </div>

          {showAddTemplate && (
            <div className="mb-6 p-6 bg-indigo-50 rounded-xl border border-indigo-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">New Custom Intervention</h3>
                <button
                  onClick={() => { setShowAddTemplate(false); setNewTemplate({ name: '', description: '', area: '', tier: '' }); }}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Intervention Name *</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., Shortened Assignments"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                  <select
                    value={newTemplate.area}
                    onChange={(e) => setNewTemplate({ ...newTemplate, area: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select category...</option>
                    <option value="Academic">Academic</option>
                    <option value="Behavior">Behavior</option>
                    <option value="Social-Emotional">Social-Emotional</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Recommended Tier</label>
                  <select
                    value={newTemplate.tier}
                    onChange={(e) => setNewTemplate({ ...newTemplate, tier: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Any tier</option>
                    <option value="1">Tier 1</option>
                    <option value="2">Tier 2</option>
                    <option value="3">Tier 3</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={newTemplate.description}
                    onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Brief description of the intervention"
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setShowAddTemplate(false); setNewTemplate({ name: '', description: '', area: '', tier: '' }); }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTemplate}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Save size={16} />
                  Save Intervention
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setAdminAreaFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                adminAreaFilter === 'all' 
                  ? 'bg-slate-700 text-white' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({interventionTemplates.length})
            </button>
            <button
              onClick={() => setAdminAreaFilter('Academic')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                adminAreaFilter === 'Academic' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              Academic ({templatesByArea['Academic']?.length || 0})
            </button>
            <button
              onClick={() => setAdminAreaFilter('Behavior')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                adminAreaFilter === 'Behavior' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
            >
              Behavior ({templatesByArea['Behavior']?.length || 0})
            </button>
            <button
              onClick={() => setAdminAreaFilter('Social-Emotional')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                adminAreaFilter === 'Social-Emotional' 
                  ? 'bg-pink-600 text-white' 
                  : 'bg-pink-50 text-pink-700 hover:bg-pink-100'
              }`}
            >
              Social-Emotional ({templatesByArea['Social-Emotional']?.length || 0})
            </button>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {adminFilteredTemplates.map(template => (
              <div 
                key={template.id} 
                className={`p-4 rounded-xl border-2 ${areaColors[template.area]?.border || 'border-slate-200'} ${areaColors[template.area]?.bg || 'bg-slate-50'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-slate-800">{template.name}</h4>
                      {template.is_system_default ? (
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs">System Default</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">Custom</span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-slate-600 mb-2">{template.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${areaColors[template.area]?.badge || 'bg-slate-100 text-slate-600'}`}>
                        {template.area}
                      </span>
                      {template.tier && (
                        <span className={`px-2 py-0.5 rounded text-xs ${tierColors[template.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                          Tier {template.tier}
                        </span>
                      )}
                    </div>
                  </div>
                  {!template.is_system_default && (
                    <button
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete custom intervention"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Students Tab */}
      {adminTab === 'students' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Users size={24} className="text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-800">Student Management</h2>
            </div>
            <button
              onClick={() => { setShowAddStudent(true); setEditingStudent(null); resetStudentForm(); }}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <UserPlus size={18} />
              Add Student
            </button>
          </div>

          {(showAddStudent || editingStudent) && (
            <div className="mb-6 p-6 bg-indigo-50 rounded-xl border border-indigo-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">
                  {editingStudent ? 'Edit Student' : 'Add New Student'}
                </h3>
                <button
                  onClick={() => { setShowAddStudent(false); setEditingStudent(null); resetStudentForm(); }}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">First Name *</label>
                  <input
                    type="text"
                    value={studentForm.first_name}
                    onChange={(e) => setStudentForm({ ...studentForm, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last Name *</label>
                  <input
                    type="text"
                    value={studentForm.last_name}
                    onChange={(e) => setStudentForm({ ...studentForm, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Last name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade *</label>
                  <select
                    value={studentForm.grade}
                    onChange={(e) => setStudentForm({ ...studentForm, grade: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select grade...</option>
                    {gradeOptions.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tier</label>
                  <select
                    value={studentForm.tier}
                    onChange={(e) => setStudentForm({ ...studentForm, tier: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="1">Tier 1</option>
                    <option value="2">Tier 2</option>
                    <option value="3">Tier 3</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Area of Concern</label>
                  <select
                    value={studentForm.area}
                    onChange={(e) => setStudentForm({ ...studentForm, area: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">None selected</option>
                    <option value="Academic">Academic</option>
                    <option value="Behavior">Behavior</option>
                    <option value="Social-Emotional">Social-Emotional</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Level</label>
                  <select
                    value={studentForm.risk_level}
                    onChange={(e) => setStudentForm({ ...studentForm, risk_level: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setShowAddStudent(false); setEditingStudent(null); resetStudentForm(); }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={editingStudent ? handleUpdateStudent : handleAddStudent}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Save size={16} />
                  {editingStudent ? 'Update Student' : 'Add Student'}
                </button>
              </div>
            </div>
          )}

          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={adminStudentSearch}
              onChange={(e) => setAdminStudentSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Grade</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Tier</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Area</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Risk</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adminFilteredStudents.map(student => (
                  <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tierColors[student.tier]?.badge || 'bg-slate-100'}`}>
                          <User size={16} />
                        </div>
                        <span className="font-medium text-slate-800">{student.first_name} {student.last_name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{student.grade}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${tierColors[student.tier]?.badge || 'bg-slate-100'}`}>
                        Tier {student.tier}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {student.area ? (
                        <span className={`px-2 py-1 rounded-full text-xs ${areaColors[student.area]?.badge || 'bg-slate-100'}`}>
                          {student.area}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        student.risk_level === 'high' ? 'bg-red-100 text-red-700' :
                        student.risk_level === 'moderate' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        {student.risk_level}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => startEditStudent(student)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Edit student"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteStudent(student.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete student"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {adminFilteredStudents.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>No students found</p>
            </div>
          )}

          <div className="mt-4 text-sm text-slate-500">
            Total: {activeStudents.length} active students
          </div>
        </div>
      )}

      {/* Archived Students Tab */}
      {adminTab === 'archived' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Archive size={24} className="text-gray-600" />
              <h2 className="text-xl font-semibold text-slate-800">Archived Students</h2>
            </div>
            <span className="text-gray-600">{archivedStudents.length} archived students</span>
          </div>

          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search archived students..."
              value={archivedStudentSearch}
              onChange={(e) => setArchivedStudentSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {filteredArchivedStudents.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Archive size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">
                {archivedStudentSearch ? 'No archived students match your search' : 'No archived students'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left text-sm text-gray-500">
                    <th className="px-4 py-3 font-medium">Student</th>
                    <th className="px-4 py-3 font-medium">Grade</th>
                    <th className="px-4 py-3 font-medium">Last Tier</th>
                    <th className="px-4 py-3 font-medium">Area</th>
                    <th className="px-4 py-3 font-medium">Archive Reason</th>
                    <th className="px-4 py-3 font-medium">Archived Date</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredArchivedStudents.map(student => (
                    <tr key={student.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">
                          {student.first_name} {student.last_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{student.grade}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${tierColors[student.tier]?.badge || 'bg-slate-100'}`}>
                          Tier {student.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {student.area ? (
                          <span className={`px-2 py-1 rounded-full text-xs ${areaColors[student.area]?.badge || 'bg-slate-100'}`}>
                            {student.area}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">{student.archived_reason}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {student.archived_at ? new Date(student.archived_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openStudentProfile(student)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                            title="View Profile"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => handleUnarchiveStudent(student.id)}
                            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                            title="Reactivate"
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CSV Import Tab */}
      {adminTab === 'import' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <FileSpreadsheet size={24} className="text-indigo-600" />
            <h2 className="text-xl font-semibold text-slate-800">Import Students from CSV</h2>
          </div>

          <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <h3 className="font-medium text-slate-800 mb-2">CSV Format Requirements</h3>
            <p className="text-sm text-slate-600 mb-3">
              Your CSV file must include the following columns:
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium text-slate-700 mb-1">Required Columns:</p>
                <ul className="list-disc list-inside text-slate-600">
                  <li><code className="bg-slate-200 px-1 rounded">first_name</code></li>
                  <li><code className="bg-slate-200 px-1 rounded">last_name</code></li>
                  <li><code className="bg-slate-200 px-1 rounded">grade</code> (e.g., K, 1st, 2nd, 3rd...)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-slate-700 mb-1">Optional Columns:</p>
                <ul className="list-disc list-inside text-slate-600">
                  <li><code className="bg-slate-200 px-1 rounded">tier</code> (1, 2, or 3 — default: 1)</li>
                  <li><code className="bg-slate-200 px-1 rounded">area</code> (Academic, Behavior, Social-Emotional)</li>
                  <li><code className="bg-slate-200 px-1 rounded">risk_level</code> (low, moderate, high — default: low)</li>
                </ul>
              </div>
            </div>
            <button
              onClick={downloadCsvTemplate}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
            >
              <Download size={18} />
              Download CSV Template
            </button>
          </div>

          <div className="mb-6">
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
              <Upload size={48} className="mx-auto mb-4 text-slate-400" />
              <p className="text-slate-600 mb-4">Select a CSV file to import students</p>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files[0])}
                className="hidden"
              />
              <label
                htmlFor="csv-file-input"
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <FileSpreadsheet size={18} />
                Choose CSV File
              </label>
              {csvFile && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <FileText size={18} className="text-indigo-600" />
                  <span className="text-slate-800">{csvFile.name}</span>
                  <button
                    onClick={() => {
                      setCsvFile(null);
                      const fileInput = document.getElementById('csv-file-input');
                      if (fileInput) fileInput.value = '';
                    }}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {csvFile && (
            <div className="flex justify-center mb-6">
              <button
                onClick={handleCsvUpload}
                disabled={csvUploading}
                className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {csvUploading ? (
                  <>
                    <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload size={20} />
                    Import Students
                  </>
                )}
              </button>
            </div>
          )}
         </div>
      )}

      {/* Plan Templates Tab */}
      {adminTab === 'templates' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <FileText size={24} className="text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-800">Intervention Plan Templates</h2>
            </div>
            <div className="text-sm text-slate-500">
              {adminTemplates.filter(t => t.has_plan_template).length} of {adminTemplates.length} interventions have plan templates
            </div>
          </div>
          
          {/* Templates Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Intervention</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Category</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Plan Template</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Sections</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adminTemplates.map(template => (
                  <tr key={template.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{template.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        template.category === 'Academic' ? 'bg-blue-100 text-blue-700' :
                        template.category === 'Behavior' ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {template.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {template.has_plan_template ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle size={16} /> {template.plan_name || 'Yes'}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {template.section_count > 0 ? `${template.section_count} sections` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openTemplateEditor(template)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-sm"
                      >
                        {template.has_plan_template ? 'Edit' : 'Add Template'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {adminTemplates.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              Loading templates...
            </div>
          )}
        </div>
      )}
    </div>
  );

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <BarChart3 size={22} className="text-white" />
                </div>
                <span className="text-xl font-semibold text-slate-800">TierTrak</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setView('dashboard')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    view === 'dashboard' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => { setView('students'); setFilterTier('all'); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    view === 'students' || view === 'student' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Students
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setView('admin')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
                      view === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Settings size={16} />
                    Admin
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-800">{user.full_name}</p>
                <p className="text-xs text-slate-500">{user.role.replace(/_/g, ' ')} • {user.tenant_name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {view === 'dashboard' && <DashboardView />}
        {view === 'students' && <StudentsListView />}
        {view === 'student' && <StudentProfileView />}
        {view === 'admin' && <AdminView />}
      </main>
      {/* Weekly Progress Form Modal */}
        {showProgressForm && selectedInterventionForProgress && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
              <div className="p-4 border-b flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">Log Weekly Progress</h3>
                  <p className="text-sm text-slate-500">{selectedInterventionForProgress.intervention_name}</p>
                </div>
                <button onClick={() => setShowProgressForm(false)} className="text-slate-500 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form key={selectedInterventionForProgress?.id} onSubmit={submitWeeklyProgress} className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={progressFormData.week_of}
                    onChange={(e) => setProgressFormData({ ...progressFormData, week_of: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Implementation Status *</label>
                  <select
                    value={progressFormData.status}
                    onChange={(e) => {
  const newStatus = e.target.value;
  if (newStatus === 'Student Absent') {
    setProgressFormData({ ...progressFormData, status: newStatus, rating: null, response: '' });
  } else {
    setProgressFormData({ ...progressFormData, status: newStatus });
  }
}}
                    className="w-full p-2 border rounded-lg"
                    required
                  >
                    <option value="">Select status...</option>
                    <option value="Implemented as Planned">Implemented as Planned</option>
                    <option value="Partially Implemented">Partially Implemented</option>
                    <option value="Not Implemented">Not Implemented</option>
                    <option value="Student Absent">Student Absent</option>
                  </select>
                </div>

                {progressFormData.status !== 'Student Absent' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Progress Rating (1-5)</label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(rating => (
                          <button
                            key={rating}
                            type="button"
                            onClick={() => setProgressFormData({ ...progressFormData, rating })}
                            className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                              progressFormData.rating === rating
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {rating}
                          </button>
                        ))}
                      </div>
                      {progressFormData.rating && (
                        <p className={`text-sm mt-1 ${getRatingColor(progressFormData.rating)}`}>
                          {getRatingLabel(progressFormData.rating)}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Student Response</label>
                      <div className="flex gap-2">
                        {['Positive', 'Neutral', 'Resistant'].map(response => (
                          <button
                            key={response}
                            type="button"
                            onClick={() => setProgressFormData({ ...progressFormData, response })}
                            className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                              progressFormData.response === response
                                ? response === 'Positive' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                  : response === 'Neutral' ? 'border-amber-500 bg-amber-50 text-amber-700'
                                  : 'border-rose-500 bg-rose-50 text-rose-700'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {response}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
  ref={progressNotesRef}
  defaultValue=""
  className="w-full p-2 border rounded-lg"
  rows="3"
  placeholder="Observations, adjustments made, student behavior..."
/>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowProgressForm(false)}
                    className="flex-1 py-2 px-4 border rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Save Progress Log
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Goal Setting Modal */}
        {showGoalForm && selectedInterventionForGoal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
              <div className="p-4 border-b flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-lg">Set Intervention Goal</h3>
                  <p className="text-sm text-slate-500">{selectedInterventionForGoal.intervention_name}</p>
                </div>
                <button onClick={() => setShowGoalForm(false)} className="text-slate-500 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); updateInterventionGoal(selectedInterventionForGoal.id); }} className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Goal Description</label>
                  <textarea
                    value={goalFormData.goal_description}
                    onChange={(e) => setGoalFormData({ ...goalFormData, goal_description: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                    rows="3"
                    placeholder="e.g., Student will complete 80% of assignments independently..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Date</label>
                  <input
                    type="date"
                    value={goalFormData.goal_target_date}
                    onChange={(e) => setGoalFormData({ ...goalFormData, goal_target_date: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Rating</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(rating => (
                      <button
                        key={rating}
                        type="button"
                        onClick={() => setGoalFormData({ ...goalFormData, goal_target_rating: rating })}
                        className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all ${
                          goalFormData.goal_target_rating === rating
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">Target: {getRatingLabel(goalFormData.goal_target_rating)}</p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowGoalForm(false)}
                    className="flex-1 py-2 px-4 border rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Save Goal
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* Progress Chart Modal */}
{showProgressChart && selectedInterventionForChart && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
      <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
        <div>
          <h3 className="font-semibold text-lg">Progress Over Time</h3>
          <p className="text-sm text-slate-500">{selectedInterventionForChart.intervention_name}</p>
        </div>
        <button onClick={() => setShowProgressChart(false)} className="text-slate-500 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6">
        {(() => {
          const chartData = weeklyProgressLogs
            .filter(log => log.student_intervention_id === selectedInterventionForChart.id && log.rating)
            .sort((a, b) => new Date(a.week_of) - new Date(b.week_of))
            .map(log => ({
              week: new Date(log.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              rating: log.rating,
              status: log.status,
              response: log.response,
              notes: log.notes
            }));

          const goalRating = selectedInterventionForChart.goal_target_rating;

          if (chartData.length === 0) {
            return (
              <div className="text-center py-12 text-slate-400">
                <TrendingUp size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-lg">No progress data yet</p>
                <p className="text-sm mt-2">Log weekly progress to see the chart</p>
              </div>
            );
          }

          return (
            <>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="week" 
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={{ stroke: '#cbd5e1' }}
                    />
                    <YAxis 
                      domain={[0, 5]} 
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={{ stroke: '#cbd5e1' }}
                      label={{ value: 'Rating', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200">
                              <p className="font-medium text-slate-800">{data.week}</p>
                              <p className={`text-sm ${getRatingColor(data.rating)}`}>
                                Rating: {data.rating}/5 - {getRatingLabel(data.rating)}
                              </p>
                              <p className="text-xs text-slate-500 mt-1">{data.status}</p>
                              {data.response && <p className="text-xs text-slate-500">Response: {data.response}</p>}
                              {data.notes && <p className="text-xs text-slate-600 mt-1 max-w-xs">{data.notes}</p>}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    {goalRating && (
                      <ReferenceLine 
                        y={goalRating} 
                        stroke="#6366f1" 
                        strokeDasharray="5 5" 
                        label={{ value: `Goal: ${goalRating}`, position: 'right', fill: '#6366f1', fontSize: 12 }}
                      />
                    )}
                    <Line 
                      type="monotone" 
                      dataKey="rating" 
                      stroke="#3b82f6" 
                      strokeWidth={3}
                      dot={{ fill: '#3b82f6', strokeWidth: 2, r: 6 }}
                      activeDot={{ r: 8, fill: '#1d4ed8' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-blue-500 rounded"></div>
                  <span className="text-slate-600">Progress Rating</span>
                </div>
                {goalRating && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 border-t-2 border-dashed border-indigo-500"></div>
                    <span className="text-slate-600">Goal Target ({goalRating})</span>
                  </div>
                )}
              </div>

              {/* Rating Scale Reference */}
              <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm font-medium text-slate-700 mb-2">Rating Scale</p>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div className="text-center p-2 bg-rose-100 rounded text-rose-700">1 - No Progress</div>
                  <div className="text-center p-2 bg-rose-50 rounded text-rose-600">2 - Minimal</div>
                  <div className="text-center p-2 bg-amber-100 rounded text-amber-700">3 - Some</div>
                  <div className="text-center p-2 bg-emerald-50 rounded text-emerald-600">4 - Good</div>
                  <div className="text-center p-2 bg-emerald-100 rounded text-emerald-700">5 - Significant</div>
                </div>
              </div>

              {/* Summary Stats */}
              {chartData.length >= 2 && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-700">
                      {(chartData.reduce((sum, d) => sum + d.rating, 0) / chartData.length).toFixed(1)}
                    </p>
                    <p className="text-xs text-blue-600">Average Rating</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-emerald-700">
                      {Math.max(...chartData.map(d => d.rating))}
                    </p>
                    <p className="text-xs text-emerald-600">Highest Rating</p>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg text-center">
                    <p className="text-2xl font-bold text-indigo-700">{chartData.length}</p>
                    <p className="text-xs text-indigo-600">Weeks Logged</p>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <div className="p-4 border-t bg-slate-50">
        <button
          onClick={() => setShowProgressChart(false)}
          className="w-full py-2 px-4 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition"
        >
          Close
        </button>
      </div>
    </div>
  </div>
)}

      {/* Template Editor Modal */}
      {showTemplateEditor && selectedAdminTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b bg-indigo-50">
              <div>
                <h2 className="text-xl font-bold text-indigo-800">
                  {selectedAdminTemplate.has_plan_template ? 'Edit' : 'Create'} Plan Template
                </h2>
                <p className="text-sm text-indigo-600">{selectedAdminTemplate.name}</p>
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
                  onClick={() => setShowTemplateEditor(false)}
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
                    {!selectedAdminTemplate.has_plan_template && adminTemplates.filter(t => t.has_plan_template).length > 0 && (
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
                {selectedAdminTemplate.has_plan_template && (
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
                  onClick={() => setShowTemplateEditor(false)}
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
      )}
    </div>
  );
}
// Force redeploy Sun Jan 25 16:54:04 PST 2026
// Redeploy Sun Jan 25 18:51:20 PST 2026
