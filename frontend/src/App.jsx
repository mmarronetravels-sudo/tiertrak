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

// Format date for display
const formatWeekOf = (dateStr) => {
  if (!dateStr) return 'No date';
  const date = new Date(dateStr);
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

  // Fetch user info
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
          notes: newIntervention.notes,
          assigned_by: user.id
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setNewIntervention({ name: '', notes: '' });
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
              Weekly Logs Needed ({missingLogs.missing_count})
            </h3>
          </div>
          <p className="text-sm text-amber-700 mb-3">
            The following interventions need progress logs for the week of {new Date(missingLogs.week_of + 'T00:00:00').toLocaleDateString()}:
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {missingLogs.interventions.map((item) => (
              <div 
                key={item.intervention_id}
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
                  placeholder="Notes..."
                  value={newIntervention.notes}
                  onChange={(e) => setNewIntervention({ ...newIntervention, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { 
                      setShowAddIntervention(false); 
                      setNewIntervention({ name: '', notes: '' }); 
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
                      <h4 className="font-medium text-slate-800">{intervention.intervention_name}</h4>
                      <p className="text-sm text-slate-500">Started {intervention.start_date}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      intervention.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {intervention.status}
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
    week_of: getCurrentWeekStart(),
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
                  {weeklyProgressLogs.filter(log => log.student_intervention_id === intervention.id).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <h5 className="text-sm font-medium text-slate-600 mb-2">Recent Progress</h5>
                      <div className="space-y-2">
                        {weeklyProgressLogs
                          .filter(log => log.student_intervention_id === intervention.id)
                          .slice(0, 3)
                          .map(log => (
                            <div key={log.id} className="text-sm bg-white p-2 rounded border border-slate-100">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">{formatWeekOf(log.week_of)}</span>
                                <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(log.status)}`}>
                                  {log.status}
                                </span>
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
                    </div>
                  )}
                </div>
              ))}
              {(!selectedStudent.interventions || selectedStudent.interventions.length === 0) && (
                <p className="text-center py-8 text-slate-400">No interventions yet</p>
              )}
            </div>
          </div>

          
          {/* Progress Notes */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">MTSS Meetings</h2>
              </div>
              {!selectedStudent.archived && (
                <button
                  onClick={() => setShowAddNote(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={16} />
                  Add
                </button>
              )}
            </div>

            
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {selectedStudent.progressNotes?.map((note, idx) => (
                <div key={idx} className="p-4 bg-slate-50 rounded-xl border-l-4 border-indigo-400">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-indigo-600">{note.author_name || 'Staff'}</span>
                    <span className="text-xs text-slate-400">{note.meeting_date || note.created_at?.split('T')[0]}</span>
                  </div>
                  <p className="text-sm text-slate-700">{note.note}</p>
                </div>
              ))}
              {(!selectedStudent.progressNotes || selectedStudent.progressNotes.length === 0) && (
                <p className="text-center py-8 text-slate-400">No meeting notes yet</p>
              )}
            </div>
          </div>
        </div>

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

          {csvResult && (
            <div className={`p-4 rounded-xl ${csvResult.error ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              {csvResult.error ? (
                <div className="flex items-center gap-2 text-red-700">
                  <AlertCircle size={20} />
                  <span>{csvResult.error}</span>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 text-emerald-700 mb-4">
                    <CheckCircle size={20} />
                    <span className="font-medium">Import Complete!</span>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="bg-white p-3 rounded-lg text-center">
                      <p className="text-2xl font-bold text-slate-800">{csvResult.summary.totalRows}</p>
                      <p className="text-xs text-slate-500">Total Rows</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg text-center">
                      <p className="text-2xl font-bold text-emerald-600">{csvResult.summary.imported}</p>
                      <p className="text-xs text-slate-500">Imported</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg text-center">
                      <p className="text-2xl font-bold text-amber-600">{csvResult.summary.validationErrors}</p>
                      <p className="text-xs text-slate-500">Validation Errors</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg text-center">
                      <p className="text-2xl font-bold text-red-600">{csvResult.summary.insertErrors}</p>
                      <p className="text-xs text-slate-500">Insert Errors</p>
                    </div>
                  </div>

                  {csvResult.imported?.length > 0 && (
                    <div className="mb-4">
                      <p className="font-medium text-slate-700 mb-2">Successfully Imported:</p>
                      <div className="max-h-40 overflow-y-auto bg-white rounded-lg p-2">
                        {csvResult.imported.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 py-1 text-sm text-slate-600">
                            <CheckCircle size={14} className="text-emerald-500" />
                            Row {item.row}: {item.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {csvResult.errors?.length > 0 && (
                    <div>
                      <p className="font-medium text-slate-700 mb-2">Errors:</p>
                      <div className="max-h-40 overflow-y-auto bg-white rounded-lg p-2">
                        {csvResult.errors.map((item, idx) => (
                          <div key={idx} className="flex items-start gap-2 py-1 text-sm text-red-600">
                            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                            <span>Row {item.row}: {item.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">Week Of (Monday)</label>
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
    </div>
  );
}
// Force redeploy Sun Jan 25 16:54:04 PST 2026
// Redeploy Sun Jan 25 18:51:20 PST 2026
