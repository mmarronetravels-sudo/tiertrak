import { useState, useEffect } from 'react';
import { Search, Plus, ChevronRight, User, Clock, TrendingUp, AlertCircle, CheckCircle, BookOpen, Users, BarChart3, FileText, ArrowLeft, Save, LogOut, LogIn, Calendar, MapPin, Filter, Settings, Trash2, X, Edit, UserPlus, Upload, Download, FileSpreadsheet } from 'lucide-react';

const API_URL = 'http://localhost:3000/api';

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
  const [showAddIntervention, setShowAddIntervention] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showAddLog, setShowAddLog] = useState(false);
  const [interventionAreaFilter, setInterventionAreaFilter] = useState('all');
  const [newIntervention, setNewIntervention] = useState({ name: '', notes: '' });
  const [newNote, setNewNote] = useState('');
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

  // Check if user is admin
  const isAdmin = user && (user.role === 'district_admin' || user.role === 'school_admin');

  // Check if logged in on load
  useEffect(() => {
    if (token) {
      fetchUserInfo();
      fetchLogOptions();
    } else {
      setLoading(false);
    }
  }, [token]);

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
  const fetchStudents = async (tenantId) => {
    try {
      const res = await fetch(`${API_URL}/students/tenant/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
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
    if (!newNote || !selectedStudent) return;
    try {
      const res = await fetch(`${API_URL}/progress-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          author_id: user.id,
          note: newNote
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setNewNote('');
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
        fetchStudents(user.tenant_id);
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
        fetchStudents(user.tenant_id);
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
        fetchStudents(user.tenant_id);
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
        fetchStudents(user.tenant_id);
        setCsvFile(null);
        // Reset file input
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
        fetchStudents(user.tenant_id);
        if (selectedStudent && selectedStudent.id === studentId) {
          fetchStudentDetails(studentId);
        }
      }
    } catch (error) {
      console.error('Error updating tier:', error);
    }
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

  // Filter students
  const filteredStudents = students.filter(student => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    const matchesSearch = fullName.includes(searchTerm.toLowerCase());
    const matchesTier = filterTier === 'all' || student.tier === parseInt(filterTier);
    const matchesArea = filterArea === 'all' || student.area === filterArea;
    return matchesSearch && matchesTier && matchesArea;
  });

  // Filter students for admin view
  const adminFilteredStudents = students.filter(student => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    return fullName.includes(adminStudentSearch.toLowerCase());
  });

  const tierCounts = {
    1: students.filter(s => s.tier === 1).length,
    2: students.filter(s => s.tier === 2).length,
    3: students.filter(s => s.tier === 3).length
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
            Test login: specialist@lincoln.edu / test123
          </p>
          <p className="mt-2 text-center text-sm text-slate-500">
            Admin login: admin2@lincoln.edu / test123
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
          <p className="text-2xl font-bold text-indigo-900">{students.length}</p>
          <p className="text-sm text-indigo-600">Total Students</p>
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

      {students.length === 0 && (
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
      </div>

      {/* Student Cards */}
      <div className="grid grid-cols-2 gap-4">
        {filteredStudents.map(student => (
          <div
            key={student.id}
            className={`${tierColors[student.tier]?.bg || 'bg-slate-50'} ${tierColors[student.tier]?.border || 'border-slate-200'} border-2 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.01]`}
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
              <span className={`${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'} px-3 py-1 rounded-full text-sm font-semibold`}>
                Tier {student.tier}
              </span>
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
        <div className={`${tierColors[selectedStudent.tier]?.bg || 'bg-slate-50'} ${tierColors[selectedStudent.tier]?.border || 'border-slate-200'} border-2 rounded-2xl p-6`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${tierColors[selectedStudent.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                <User size={32} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-800">
                  {selectedStudent.first_name} {selectedStudent.last_name}
                </h1>
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
              </div>
            </div>
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
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="grid grid-cols-3 gap-6">
          {/* Interventions */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <BookOpen size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">Interventions</h2>
              </div>
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
            </div>

            {showAddIntervention && (
              <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                <h3 className="font-medium text-slate-800 mb-3">New Intervention</h3>
                
                {/* Area Filter */}
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
                </div>
              ))}
              {(!selectedStudent.interventions || selectedStudent.interventions.length === 0) && (
                <p className="text-center py-8 text-slate-400">No interventions yet</p>
              )}
            </div>
          </div>

          {/* Intervention Logs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Calendar size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">Intervention Logs</h2>
              </div>
              <button
                onClick={() => setShowAddLog(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors"
              >
                <Plus size={16} />
                Log
              </button>
            </div>

            {showAddLog && (
              <div className="mb-6 p-4 bg-teal-50 rounded-xl border border-teal-200">
                <h3 className="font-medium text-slate-800 mb-3">New Intervention Log</h3>
                
                <select
                  value={newLog.student_intervention_id}
                  onChange={(e) => setNewLog({ ...newLog, student_intervention_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Link to intervention (optional)...</option>
                  {selectedStudent.interventions?.map(i => (
                    <option key={i.id} value={i.id}>{i.intervention_name}</option>
                  ))}
                </select>

                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={newLog.log_date}
                    onChange={(e) => setNewLog({ ...newLog, log_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Time of Day</label>
                  <select
                    value={newLog.time_of_day}
                    onChange={(e) => setNewLog({ ...newLog, time_of_day: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select time of day...</option>
                    {logOptions.timeOfDay.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                  <select
                    value={newLog.location}
                    onChange={(e) => setNewLog({ ...newLog, location: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select location...</option>
                    {logOptions.location.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <textarea
                  placeholder="Notes (optional)..."
                  value={newLog.notes}
                  onChange={(e) => setNewLog({ ...newLog, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  rows={2}
                />

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { 
                      setShowAddLog(false); 
                      setNewLog({ student_intervention_id: '', log_date: new Date().toISOString().split('T')[0], time_of_day: '', location: '', notes: '' }); 
                    }}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddLog}
                    className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700"
                  >
                    <Save size={14} />
                    Save
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {interventionLogs.map(log => (
                <div key={log.id} className="p-3 bg-slate-50 rounded-xl border-l-4 border-teal-400">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-teal-700">{log.log_date}</span>
                    <span className="text-xs text-slate-400">{log.time_of_day}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                    <MapPin size={12} />
                    <span>{log.location}</span>
                  </div>
                  {log.intervention_name && (
                    <p className="text-xs text-indigo-600 mb-1">{log.intervention_name}</p>
                  )}
                  {log.notes && (
                    <p className="text-sm text-slate-600">{log.notes}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">Logged by {log.logged_by_name || 'Staff'}</p>
                </div>
              ))}
              {interventionLogs.length === 0 && (
                <p className="text-center py-8 text-slate-400">No logs yet</p>
              )}
            </div>
          </div>

          {/* Progress Notes */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText size={20} className="text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-800">Progress Notes</h2>
              </div>
              <button
                onClick={() => setShowAddNote(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
              >
                <Plus size={16} />
                Add
              </button>
            </div>

            {showAddNote && (
              <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                <h3 className="font-medium text-slate-800 mb-3">New Progress Note</h3>
                <textarea
                  placeholder="Document student progress..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={3}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowAddNote(false); setNewNote(''); }}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNote}
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
                  >
                    <Save size={14} />
                    Save
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4 max-h-80 overflow-y-auto">
              {selectedStudent.progressNotes?.map((note, idx) => (
                <div key={idx} className="p-4 bg-slate-50 rounded-xl border-l-4 border-indigo-400">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-indigo-600">{note.author_name || 'Staff'}</span>
                    <span className="text-xs text-slate-400">{note.created_at?.split('T')[0]}</span>
                  </div>
                  <p className="text-sm text-slate-700">{note.note}</p>
                </div>
              ))}
              {(!selectedStudent.progressNotes || selectedStudent.progressNotes.length === 0) && (
                <p className="text-center py-8 text-slate-400">No progress notes yet</p>
              )}
            </div>
          </div>
        </div>
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

          {/* Add Template Form */}
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

          {/* Filter Tabs */}
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

          {/* Templates List */}
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

          {/* Add/Edit Student Form */}
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

          {/* Search */}
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

          {/* Students Table */}
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
            Total: {students.length} students
          </div>
        </div>
      )}

      {/* CSV Import Tab */}
      {adminTab === 'import' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <FileSpreadsheet size={24} className="text-indigo-600" />
            <h2 className="text-xl font-semibold text-slate-800">Import Students from CSV</h2>
          </div>

          {/* Instructions */}
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

          {/* Upload Area */}
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

          {/* Upload Button */}
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

          {/* Results */}
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
    </div>
  );
}
