import { useState, useEffect, useRef } from 'react';
import { 
  X, Plus, Search, ChevronLeft, ChevronRight, ChevronDown, Eye, Trash2, Edit, Upload, Download, 
  FileText, Printer, BarChart3, LogIn, LogOut, Pencil, settings, Users, User, BookOpen, 
  AlertCircle, Check, Calendar, Clock, MapPin, Archive, RotateCcw, TrendingUp, 
  Target, ClipboardList, ArrowLeft, ArrowRight, Save, RefreshCw, Filter, 
MoreVertical, Info, CheckCircle, XCircle, AlertTriangle, Home, Menu
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import MTSSMeetingFormModal from './components/Modals/MTSSMeetingFormModal';
import ReportModal from './components/Modals/ReportModal';
import PreReferralFormModal from './components/Modals/PreReferralFormModal';
import { tierColors, areaColors, gradeOptions, archiveReasons } from './utils/constants';
import { getCurrentWeekStart, formatWeekOf, getRatingLabel, getRatingColor, getStatusColor } from './utils/helpers';
import TemplateEditorModal from './components/Modals/TemplateEditorModal';
import ProgressFormModal from './components/Modals/ProgressFormModal';
import GoalFormModal from './components/Modals/GoalFormModal';
import ProgressChartModal from './components/Modals/ProgressChartModal';
import { ArchiveStudentModal, UnarchiveStudentModal } from './components/Modals/ArchiveModal';
import { AddStaffModal, EditStaffModal } from './components/Modals/StaffModals';
import { useApp } from './context/AppContext';
import InterventionPlanModal from './components/Modals/InterventionPlanModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';


// Get days until expiration and urgency level
const getExpirationUrgency = (expirationDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(expirationDate + 'T00:00:00');
  const diffTime = expDate - today;
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let urgency = 'notice'; // 22-30 days
  if (daysRemaining <= 7) urgency = 'critical';
  else if (daysRemaining <= 21) urgency = 'warning';
  
  return { daysRemaining, urgency };
};

// FERPA Compliance Badge Component
const FERPABadge = ({ compact = false }) => (
  <div className={`flex items-center gap-2 ${compact ? 'bg-emerald-50/80' : 'bg-emerald-50'} border border-emerald-200 rounded-lg ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
    <CheckCircle className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-emerald-600`} fill="currentColor" />
    <div>
      <span className={`text-emerald-800 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>FERPA Compliant</span>
      {!compact && (
        <span className="text-emerald-600 text-xs block">Student data encrypted & protected</span>
      )}
    </div>
  </div>
);

export default function App() {
  const appContext = useApp();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [view, setView] = useState('dashboard');
  const [students, setStudents] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [showEditStaffModal, setShowEditStaffModal] = useState(false);
  const [selectedStaffMember, setSelectedStaffMember] = useState(null);
  const loadStaffList = async (tenantId) => {
    const tid = tenantId || user?.tenant_id;
    if (!tid) return;
    try {
      const res = await fetch(`${API_URL}/staff/${tid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStaffList(data);
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };
  const [parentsList, setParentsList] = useState([]);
  const [showAssignmentManager, setShowAssignmentManager] = useState(false);
  const [selectedInterventionForAssignment, setSelectedInterventionForAssignment] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [interventionTemplates, setInterventionTemplates] = useState([]);
  const [interventionLogs, setInterventionLogs] = useState([]);
  const [logOptions, setLogOptions] = useState({ timeOfDay: [], location: [] });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('2_3');
  const [filterArea, setFilterArea] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [studentDocuments, setStudentDocuments] = useState([]);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [documentUploadLoading, setDocumentUploadLoading] = useState(false);
  const [documentCategories] = useState(['504 Plan', 'IEP', 'Evaluation Report', 'Progress Report', 'Parent Communication', 'Medical Record', 'Other']);
  const [showAddIntervention, setShowAddIntervention] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showAddLog, setShowAddLog] = useState(false);
  const [interventionAreaFilter, setInterventionAreaFilter] = useState('all');
  const [newIntervention, setNewIntervention] = useState({ name: '', notes: '' });
  const [newNote, setNewNote] = useState('');
  const noteTextareaRef = useRef(null);
  const googleButtonRef = useRef(null); 
  const interventionNotesRef = useRef(null);
  const [expiringDocuments, setExpiringDocuments] = useState([]);
  const [showExpiringDocsDetail, setShowExpiringDocsDetail] = useState(false);
  const [editingProgressLog, setEditingProgressLog] = useState(null);
  const [noteDate, setNoteDate] = useState(new Date().toISOString().split('T')[0]);
  // Report state
const [showReport, setShowReport] = useState(false);
const [missingLogs, setMissingLogs] = useState({ missing_count: 0, interventions: [] });
const [referralCandidates, setReferralCandidates] = useState({ count: 0, candidates: [] });
const [monitoredStudents, setMonitoredStudents] = useState({ count: 0, monitored: [] });
const [newLog, setNewLog] = useState({ 
    student_intervention_id: '', 
    log_date: new Date().toISOString().split('T')[0], 
    time_of_day: '', 
    location: '', 
    notes: '' 
  });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(null); // 'set' or 'reset'
const [passwordToken, setPasswordToken] = useState(null);
const [tokenEmail, setTokenEmail] = useState('');
const [newPassword, setNewPassword] = useState('');
const [confirmPassword, setConfirmPassword] = useState('');
const [passwordMessage, setPasswordMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('app');
  
  // Admin state
  const [adminTab, setAdminTab] = useState('interventions');
  const [adminAreaFilter, setAdminAreaFilter] = useState('all');
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', area: '', tier: '' });
  // Intervention Bank state
  const [bankInterventions, setBankInterventions] = useState([]);
  const [bankFilter, setBankFilter] = useState('all');
  const [bankSearch, setBankSearch] = useState('');
  const [bankView, setBankView] = useState('activated');
  const [bankTierFilter, setBankTierFilter] = useState('All');

  // Parent management state
const [adminParentTab, setAdminParentTab] = useState('accounts');
const [newParent, setNewParent] = useState({ 
  full_name: '', 
  email: '', 
  password: 'parent123',
  student_id: '', 
  relationship: 'parent' 
});
const [parentAccounts, setParentAccounts] = useState([]);
const [parentStudentLinks, setParentStudentLinks] = useState([]);
const [parentLinksLoading, setParentLinksLoading] = useState(false);
  
  // Admin Template Editor state
  const [adminTemplates, setAdminTemplates] = useState([]);
  const [selectedAdminTemplate, setSelectedAdminTemplate] = useState(null);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [fieldTypes, setFieldTypes] = useState([]);
  

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
  // Parent account creation state
const [showCreateParent, setShowCreateParent] = useState(false);
const [parentForm, setParentForm] = useState({ email: '', full_name: '', student_ids: [] });
const [parentCreateMessage, setParentCreateMessage] = useState({ type: '', text: '' });
const [parentCreateLoading, setParentCreateLoading] = useState(false);
  // Pre-Referral Form state
  const [showMTSSMeetingForm, setShowMTSSMeetingForm] = useState(false);
  // Intervention Plan state
  const [showInterventionPlanModal, setShowInterventionPlanModal] = useState(false);
  const [currentPlanIntervention, setCurrentPlanIntervention] = useState(null);
  const [mtssMeetings, setMTSSMeetings] = useState([]);
  const [showPreReferralForm, setShowPreReferralForm] = useState(false);
  
  // MTSS Meeting Report state
  const [showMTSSMeetingReport, setShowMTSSMeetingReport] = useState(false);
  const [editingMTSSMeeting, setEditingMTSSMeeting] = useState(null);
  const [selectedMeetingForReport, setSelectedMeetingForReport] = useState(null);
   const [preReferralLoading, setPreReferralLoading] = useState(false);

  // CSV Import state
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  // Archive state
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false);
   const [archivedStudents, setArchivedStudents] = useState([]);
  const [archivedStudentSearch, setArchivedStudentSearch] = useState('');

  // Progress tracking state
  const [weeklyProgressLogs, setWeeklyProgressLogs] = useState([]);
  const [expandedProgressLogs, setExpandedProgressLogs] = useState({});
  const [showProgressForm, setShowProgressForm] = useState(false);
  const [selectedInterventionForProgress, setSelectedInterventionForProgress] = useState(null);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showProgressChart, setShowProgressChart] = useState(false);
  const [selectedInterventionForChart, setSelectedInterventionForChart] = useState(null);
  const [selectedInterventionForGoal, setSelectedInterventionForGoal] = useState(null);
  // Archive/Delete Intervention state
  const [showArchiveInterventionModal, setShowArchiveInterventionModal] = useState(false);
  const [showDeleteInterventionModal, setShowDeleteInterventionModal] = useState(false);
  const [selectedInterventionForAction, setSelectedInterventionForAction] = useState(null);
  const [interventionArchiveReason, setInterventionArchiveReason] = useState('');
  const [showArchivedInterventions, setShowArchivedInterventions] = useState(false);
  
  // Check if user is admin (includes counselor and behavior_specialist with full admin access)
const isAdmin = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);
  
  // Check if user can archive (admins and counselors)
const canArchive = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);
  
// Check if user can add students (admins + mtss_support)
const canAddStudents = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist', 'mtss_support'].includes(user.role);

// Check if user can assign interventions and log progress (everyone except mtss_support and parent)
const canManageInterventions = user && user.role !== 'mtss_support' && user.role !== 'parent';

// Check if user can delete documents (admin-level only)
const canDeleteDocs = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);

// Check if user is a parent
const isParent = user && user.role === 'parent';
  
// Check URL for special pages (password setup, reset)
  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    
    if (path === '/set-password' && params.get('token')) {
      setCurrentPage('set-password');
      setLoading(false);
    } else if (path === '/reset-password' && params.get('token')) {
      setCurrentPage('reset-password');
      setLoading(false);
    }
  }, []);

// Check if logged in on load
  useEffect(() => {
    if (token) {
      fetchUserInfo();
      fetchLogOptions();
    } else {
      setLoading(false);
    }
  }, [token]);

  // Sync App.jsx state into AppContext for extracted modals
  useEffect(() => {
    if (user) appContext.setUser(user);
  }, [user]);
  useEffect(() => {
    if (token) appContext.setToken(token);
  }, [token]);
  useEffect(() => {
    appContext.setSelectedStudent(selectedStudent);
  }, [selectedStudent]);
  useEffect(() => {
    appContext.setWeeklyProgressLogs(weeklyProgressLogs);
  }, [weeklyProgressLogs]);
  useEffect(() => {
    appContext.setStaffList(staffList);
  }, [staffList]);

  // Fetch missing logs when dashboard loads

  useEffect(() => {
  if (view === 'dashboard' && user?.tenant_id) {
    fetchMissingLogs();
    fetchReferralCandidates();
    fetchMonitoredStudents();
  }
}, [view, user?.tenant_id]);

    // Fetch MTSS referral candidates for dashboard
const fetchReferralCandidates = async () => {
  if (!user?.tenant_id) return;
  try {
    const response = await fetch(`${API_URL}/students/referral-candidates/${user.tenant_id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const data = await response.json();
      setReferralCandidates(data);
    }
  } catch (error) {
    console.error('Error fetching referral candidates:', error);
  }
};

// Fetch monitored referral students
const fetchMonitoredStudents = async () => {
  if (!user?.tenant_id) return;
  try {
    const response = await fetch(`${API_URL}/students/referral-monitoring/${user.tenant_id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const data = await response.json();
      setMonitoredStudents(data);
    }
  } catch (error) {
    console.error('Error fetching monitored students:', error);
  }
};

// Mark student as monitoring or remove from monitoring
const handleReferralMonitoring = async (studentId, action) => {
  try {
    if (action === 'monitor') {
      await fetch(`${API_URL}/students/referral-monitoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ student_id: studentId, tenant_id: user.tenant_id, monitored_by: user.id })
      });
    } else if (action === 'remove') {
      await fetch(`${API_URL}/students/referral-monitoring/${studentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
    fetchReferralCandidates();
    fetchMonitoredStudents();
  } catch (error) {
    console.error('Error updating monitoring:', error);
  }
};
  
// Fetch admin templates when admin view loads
  useEffect(() => {
    if (view === 'admin') {
      fetchAdminTemplates();
      fetchFieldTypes();
    }
  }, [view]);  // Fetch admin templates

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

  // Fetch expiring documents when dashboard loads
useEffect(() => {
  if (view === 'dashboard' && user?.tenant_id) {
    fetchExpiringDocuments();
  }
}, [view, user?.tenant_id]);
  
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

  // Fetch all parent accounts
const fetchParentAccounts = async () => {
  try {
    const res = await fetch(`${API_URL}/users/parents?tenant_id=${user.tenant_id}`);
    if (res.ok) {
      const data = await res.json();
      setParentAccounts(data);
    }
  } catch (error) {
    console.error('Error fetching parent accounts:', error);
  }
};

// Fetch all parent-student links for admin
const fetchAllParentLinks = async () => {
  setParentLinksLoading(true);
  try {
    const res = await fetch(`${API_URL}/parent-links/tenant/${user.tenant_id}`);
    if (res.ok) {
      const data = await res.json();
      setParentStudentLinks(data);
    }
  } catch (error) {
    console.error('Error fetching parent links:', error);
  }
  setParentLinksLoading(false);
};

  // Fetch students
  const fetchStudents = async (tenantId, includeArchived = false) => {
  if (!user) return;
  try {
      const res = await fetch(`${API_URL}/students/tenant/${tenantId}?includeArchived=${includeArchived}`, {
        headers: {
          'x-user-id': user.id.toString(),
          'x-user-role': user.role,
          'x-school-wide-access': (user.school_wide_access || false).toString()
        }
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

const fetchParentsList = async (tenantId) => {
  try {
    const response = await fetch(`${API_URL}/users/parents?tenant_id=${tenantId}`);
    if (response.ok) {
      const data = await response.json();
      setParentsList(data);
    }
  } catch (error) {
    console.error('Error fetching parents:', error);
  }
};

const fetchInterventionAssignments = async (studentInterventionId) => {
  try {
    const response = await fetch(`${API_URL}/intervention-assignments/${studentInterventionId}`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('Error fetching assignments:', error);
  }
  return [];
};

const addInterventionAssignment = async (studentInterventionId, userId, assignmentType) => {
  try {
    const response = await fetch(`${API_URL}/intervention-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_intervention_id: studentInterventionId,
        user_id: userId,
        assignment_type: assignmentType
      })
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('Error adding assignment:', error);
  }
  return null;
};

const removeInterventionAssignment = async (assignmentId) => {
  try {
    await fetch(`${API_URL}/intervention-assignments/${assignmentId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Error removing assignment:', error);
  }

 
// Delete staff member
const handleDeleteStaff = async (staffId, staffName) => {
  if (!confirm(`Remove ${staffName}? This will revoke their access to TierTrak.`)) return;
  try {
    const response = await fetch(`${API_URL}/staff/${staffId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      loadStaffList();
    }
  } catch (error) {
    console.error('Error deleting staff:', error);
  }
};};  // Fetch archived students
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

// Fetch expiring documents
const fetchExpiringDocuments = async () => {
  if (!user?.tenant_id) return;
  try {
    const res = await fetch(`${API_URL}/student-documents/expiring/${user.tenant_id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setExpiringDocuments(data);
    }
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
  }
};

   const openPreReferralForm = () => {
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

    // ============================================
  // ADMIN TEMPLATE EDITOR FUNCTIONS
  // ============================================

  const fetchAdminTemplates = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/templates?tenant_id=${user.tenant_id}`);
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

  
const openMTSSMeetingForm = (meeting = null) => {
    setEditingMTSSMeeting(meeting || null);
    setShowMTSSMeetingForm(true);
  };

  // Open MTSS Meeting Report for printing
  const openMTSSMeetingReport = (meeting) => {
    setSelectedMeetingForReport(meeting);
    setShowMTSSMeetingReport(true);
  };

  // Print MTSS Meeting Report
  const printMTSSMeetingReport = () => {
    window.print();
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

  const openEditProgressLog = (log, intervention) => {
  setEditingProgressLog(log);
  setSelectedInterventionForProgress(intervention);
  setShowProgressForm(true);
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

  // Fetch intervention bank
  const fetchBankInterventions = async (tenantId) => {
    try {
      const res = await fetch(API_URL + '/intervention-bank/all?tenant_id=' + tenantId, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        setBankInterventions(data);
      }
    } catch (err) {
      console.error('Error fetching bank:', err);
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
        fetchStudentDocuments(studentId);
        // Fetch MTSS meetings for Tier 2+ students
        if (data.tier > 1) {
          fetchMTSSMeetings(studentId);
       }
      }
    } catch (error) {
      console.error('Error fetching student details:', error);
    }
  };

  // Handle document upload
const handleDocumentUpload = async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  
  formData.append('student_id', selectedStudent.id);
  formData.append('tenant_id', user.tenant_id);
  formData.append('uploaded_by', user.id);
  
  setDocumentUploadLoading(true);
  
  try {
    const response = await fetch(`${API_URL}/student-documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (response.ok) {
      await fetchStudentDocuments(selectedStudent.id);
      setShowDocumentUpload(false);
      form.reset();
    } else {
      const error = await response.json();
      alert('Upload failed: ' + error.error);
    }
  } catch (error) {
    console.error('Error uploading document:', error);
    alert('Upload failed: ' + error.message);
  } finally {
    setDocumentUploadLoading(false);
  }
};

// Handle document download
const handleDocumentDownload = async (documentId) => {
  try {
    const response = await fetch(`${API_URL}/student-documents/download/${documentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      window.open(data.url, '_blank');
    } else {
      alert('Download failed');
    }
  } catch (error) {
    console.error('Error downloading document:', error);
    alert('Download failed: ' + error.message);
  }
};

// Handle document delete
const handleDocumentDelete = async (documentId) => {
  if (!confirm('Are you sure you want to delete this document? This cannot be undone.')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/student-documents/${documentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      await fetchStudentDocuments(selectedStudent.id);
    } else {
      alert('Delete failed');
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    alert('Delete failed: ' + error.message);
  }
};

  // Fetch student documents
const fetchStudentDocuments = async (studentId) => {
  try {
    const response = await fetch(`${API_URL}/student-documents/student/${studentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const data = await response.json();
      setStudentDocuments(data);
    }
  } catch (error) {
    console.error('Error fetching student documents:', error);
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
 // Open the plan modal for an intervention
  const openInterventionPlanModal = (intervention) => {
    setCurrentPlanIntervention(intervention);
    setShowInterventionPlanModal(true);
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
// Handle Google Sign-In
const handleGoogleSignIn = async (response) => {
  try {
    setLoginError('');
    const res = await fetch(`${API_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
    } else {
      setLoginError(data.error || 'Google sign-in failed');
    }
  } catch (err) {
    setLoginError('Connection error. Please try again.');
  }
};

// Handle set/Reset Password Submit
const handlesetPassword = async (e) => {
  e.preventDefault();
  setPasswordMessage('');
  
  if (newPassword.length < 8) {
    setPasswordMessage('Password must be at least 8 characters.');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    setPasswordMessage('Passwords do not match.');
    return;
  }
  
  try {
    const res = await fetch(`${API_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: passwordToken, password: newPassword })
    });
    const data = await res.json();
    
    if (res.ok) {
      setPasswordMessage('Password set successfully! Redirecting to login...');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } else {
      setPasswordMessage(data.error || 'Failed to set password. Please try again.');
    }
  } catch (err) {
    setPasswordMessage('Connection error. Please try again.');
  }
};

// Handle Forgot Password
const handleForgotPassword = async (e) => {
  e.preventDefault();
  try {
    const res = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginForm.email })
    });
    const data = await res.json();
    setLoginError('');
    alert(data.message || 'If an account exists, a reset link has been sent.');
    setShowForgotPassword(false);
  } catch (err) {
    setLoginError('Connection error. Please try again.');
  }
};

// Check URL for password reset/set tokens
useEffect(() => {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  
  if (token && (path === '/set-password' || path === '/reset-password')) {
    setPasswordToken(token);
    setPasswordResetMode(path === '/set-password' ? 'set' : 'reset');
    
    // Verify token is valid
    fetch(`${API_URL}/auth/verify-token/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setTokenEmail(data.email);
        } else {
          setPasswordMessage('This link is invalid or has expired. Please request a new one.');
        }
      })
      .catch(() => {
        setPasswordMessage('Error verifying link. Please try again.');
      });
  }
}, []);

// Initialize Google Sign-In
useEffect(() => {
  const initGoogle = () => {
    if (window.google && !user && googleButtonRef.current) {
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleSignIn
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 352,
        text: 'signin_with'
      });
    }
  };

  initGoogle();

  // If Google script hasn't loaded yet, wait for it
  if (!window.google) {
    const interval = setInterval(() => {
      if (window.google) {
        clearInterval(interval);
        initGoogle();
      }
    }, 100);
    return () => clearInterval(interval);
  }
}, [user]);
    
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
        loadStaffList(data.user.tenant_id);
        fetchParentsList(data.user.tenant_id);
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
          log_frequency: newIntervention.log_frequency || 'weekly',
          start_date: newIntervention.start_date || new Date().toISOString().split('T')[0],
          end_date: newIntervention.end_date || null
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setNewIntervention({ name: '', notes: '', log_frequency: 'weekly', start_date: '', end_date: '' });
        setShowAddIntervention(false);
        setInterventionAreaFilter('all');
      }
    } catch (error) {
      console.error('Error adding intervention:', error);
    }
  };

  // Create parent account
const handleCreateParent = async (e) => {
  e.preventDefault();
  try {
    // Create user account
    const userRes = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newParent.email,
        password: newParent.password,
        full_name: newParent.full_name,
        role: 'parent',
        tenant_id: user.tenant_id,
        school_wide_access: false
      })
    });
    
    if (!userRes.ok) {
      const err = await userRes.json();
      alert(`Error creating parent: ${err.error}`);
      return;
    }
    
    const newUser = await userRes.json();
    
    // If student selected, create link
    if (newParent.student_id) {
      await fetch(`${API_URL}/parent-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_user_id: newUser.id,
          student_id: newParent.student_id,
          relationship: newParent.relationship
        })
      });
    }
    
    // Reset form and refresh
    setNewParent({ 
      full_name: '', 
      email: '', 
      password: 'parent123', 
      student_id: '', 
      relationship: 'parent' 
    });
    fetchParentAccounts();
    fetchAllParentLinks();
    alert(`Parent account created!\n\nEmail: ${newParent.email}\nPassword: ${newParent.password}`);
  } catch (error) {
    console.error('Error creating parent:', error);
    alert('Error creating parent account');
  }
};

// Link existing parent to student
const handleLinkParent = async (parentId, studentId, relationship) => {
  try {
    const res = await fetch(`${API_URL}/parent-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_user_id: parentId,
        student_id: studentId,
        relationship
      })
    });
    
    if (res.ok) {
      fetchAllParentLinks();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (error) {
    console.error('Error linking parent:', error);
  }
};

// Unlink parent from student
const handleUnlinkParent = async (linkId) => {
  if (!confirm('Remove this parent-student link?')) return;
  
  try {
    await fetch(`${API_URL}/parent-links/${linkId}`, { method: 'DELETE' });
    fetchAllParentLinks();
  } catch (error) {
    console.error('Error unlinking parent:', error);
  }
};

  // Archive intervention
  const handleArchiveIntervention = async () => {
    console.log('Archive clicked, intervention:', selectedInterventionForAction);
    if (!selectedInterventionForAction) return;
    try {
      const res = await fetch(`${API_URL}/interventions/student-interventions/${selectedInterventionForAction.id}/archive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived_by: user.id,
          archive_reason: interventionArchiveReason || null
        })
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setShowArchiveInterventionModal(false);
        setSelectedInterventionForAction(null);
        setInterventionArchiveReason('');
      } else {
        const data = await res.json();
        console.error('Archive failed:', res.status, data);
        alert('Archive failed: ' + (data.error || res.status));
      }
    } catch (error) {
      console.error('Error archiving intervention:', error);
    }
  };

  // Unarchive intervention
  const handleUnarchiveIntervention = async (interventionId) => {
    try {
      const res = await fetch(`${API_URL}/interventions/student-interventions/${interventionId}/unarchive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
      }
    } catch (error) {
      console.error('Error unarchiving intervention:', error);
    }
  };

  // Delete intervention permanently
  const handleDeleteIntervention = async () => {
    if (!selectedInterventionForAction) return;
    try {
      const res = await fetch(`${API_URL}/interventions/student-interventions/${selectedInterventionForAction.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchStudentDetails(selectedStudent.id);
        setShowDeleteInterventionModal(false);
        setSelectedInterventionForAction(null);
      } else {
        const data = await res.json();
        alert(data.error || 'Could not delete intervention');
      }
    } catch (error) {
      console.error('Error deleting intervention:', error);
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

  const generateReport = () => {
    setShowReport(true);
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
    const matchesTier = filterTier === 'all' ? true : filterTier === '2_3' ? (student.tier === 2 || student.tier === 3) : student.tier === parseInt(filterTier);
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

  // Password set/Reset Screen
if (passwordResetMode) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <BarChart3 size={28} className="text-white" />
          </div>
          <span className="text-2xl font-semibold text-slate-800">TierTrak</span>
        </div>
        
        <h2 className="text-xl font-semibold text-center mb-2">
          {passwordResetMode === 'set' ? 'set Up Your Password' : 'Reset Your Password'}
        </h2>
        
        {tokenEmail && (
          <p className="text-center text-slate-500 mb-6">for {tokenEmail}</p>
        )}
        
        {passwordMessage && (
          <div className={`p-3 rounded-lg mb-4 text-sm ${
            passwordMessage.includes('successfully') 
              ? 'bg-emerald-50 text-emerald-700' 
              : 'bg-red-50 text-red-600'
          }`}>
            {passwordMessage}
          </div>
        )}
        
        {!passwordMessage?.includes('successfully') && !passwordMessage?.includes('invalid') && !passwordMessage?.includes('expired') && (
          <form onSubmit={handlesetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Enter password again"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              {passwordResetMode === 'set' ? 'Create Password' : 'Reset Password'}
            </button>
          </form>
        )}
        
        {(passwordMessage?.includes('invalid') || passwordMessage?.includes('expired')) && (
          <button
            onClick={() => window.location.href = '/'}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            Go to Login
          </button>
        )}
        
        {/* FERPA Badge */}
        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
            <div className="text-left">
              <div className="text-sm font-semibold text-emerald-800">FERPA Compliant</div>
              <div className="text-xs text-emerald-600">Student data encrypted & protected</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
  
 // set Password Page (for new parent accounts and password resets)
  if (currentPage === 'set-password' || currentPage === 'reset-password') {
    const params = new URLSearchParams(window.location.search);
    const setupToken = params.get('token');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [tokenValid, setTokenValid] = useState(null);
    const [userEmail, setUserEmail] = useState('');
    
    useEffect(() => {
      // Verify token on load
      const verifyToken = async () => {
        try {
          const res = await fetch(`${API_URL}/auth/verify-token/${setupToken}`);
          const data = await res.json();
          if (data.valid) {
            setTokenValid(true);
            setUserEmail(data.email);
          } else {
            setTokenValid(false);
          }
        } catch (err) {
          setTokenValid(false);
        }
      };
      verifyToken();
    }, [setupToken]);
    
    const handlesetPassword = async (e) => {
      e.preventDefault();
      setPasswordError('');
      
      if (newPassword.length < 8) {
        setPasswordError('Password must be at least 8 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return;
      }
      
      try {
        const res = await fetch(`${API_URL}/auth/set-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: setupToken, password: newPassword })
        });
        const data = await res.json();
        if (res.ok) {
          setPasswordSuccess(true);
        } else {
          setPasswordError(data.error || 'Failed to set password');
        }
      } catch (err) {
        setPasswordError('An error occurred. Please try again.');
      }
    };
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BarChart3 size={28} className="text-white" />
            </div>
            <span className="text-2xl font-semibold text-slate-800">TierTrak</span>
          </div>
          
          {tokenValid === null && (
            <div className="text-center text-slate-600">Verifying link...</div>
          )}
          
          {tokenValid === false && (
            <div className="text-center">
              <div className="text-red-600 bg-red-50 p-4 rounded-lg mb-4">
                This link is invalid or has expired. Please request a new password reset.
              </div>
              <a href="/" className="text-indigo-600 hover:underline">Return to login</a>
            </div>
          )}
          
          {tokenValid === true && !passwordSuccess && (
            <>
              <h2 className="text-xl font-semibold text-slate-800 text-center mb-2">
                {currentPage === 'set-password' ? 'set Up Your Password' : 'Reset Your Password'}
              </h2>
              <p className="text-slate-500 text-center mb-6">{userEmail}</p>
              
              <form onSubmit={handlesetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="At least 8 characters"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Confirm your password"
                    required
                  />
                </div>
                {passwordError && (
                  <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{passwordError}</div>
                )}
                <button
                  type="submit"
                  className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                  set Password
                </button>
              </form>
            </>
          )}
          
          {passwordSuccess && (
            <div className="text-center">
              <div className="text-emerald-600 bg-emerald-50 p-4 rounded-lg mb-4">
                <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                Your password has been set successfully!
              </div>
              <a 
                href="/" 
                className="inline-block w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors text-center"
              >
                Sign In
              </a>
            </div>
          )}
        </div>
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
        
        {showForgotPassword ? (
          // Forgot Password Form
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-sm text-slate-600 mb-4">Enter your email address and we'll send you a link to reset your password.</p>
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
            {loginError && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{loginError}</div>
            )}
            <button
              type="submit"
              className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              Send Reset Link
            </button>
            <button
              type="button"
              onClick={() => { setShowForgotPassword(false); setLoginError(''); }}
              className="w-full py-2 text-slate-600 hover:text-indigo-600 transition-colors text-sm"
            >
              ← Back to Sign In
            </button>
          </form>
        ) : (
          // Regular Login Form
          <>
            {/* Google Sign-In Button */}
            <div className="mb-6">
              <div 
                id="googleSignInButton" 
                ref={googleButtonRef}
                className="w-full"
              ></div>
            </div>
            
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500">or</span>
              </div>
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
            
            <button
              type="button"
              onClick={() => { setShowForgotPassword(true); setLoginError(''); }}
              className="w-full mt-4 text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Forgot your password?
            </button>
          </>
        )}
        
        {/* FERPA Badge */}
        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
            <div className="text-left">
              <div className="text-sm font-semibold text-emerald-800">FERPA Compliant</div>
              <div className="text-xs text-emerald-600">Student data encrypted & protected</div>
            </div>
          </div>
        </div>
        
                
        {/* Privacy Policy & Terms of Service */}
        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-slate-400">
          <a 
            href="https://www.scholarpathsystems.org/privacy.html" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-indigo-600 transition-colors"
          >
            Privacy Policy
          </a>
          <span>·</span>
          <a 
            href="https://www.scholarpathsystems.org/terms.html" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-indigo-600 transition-colors"
          >
            Terms of Service
          </a>
        </div>
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

      {/* Expiring Documents Alert */}
{expiringDocuments.length > 0 && (
  <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
    <div 
      className="flex items-center justify-between cursor-pointer"
      onClick={() => setShowExpiringDocsDetail(!showExpiringDocsDetail)}
    >
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-orange-600" />
        <h3 className="font-semibold text-orange-800">
          Documents Expiring Soon ({expiringDocuments.length})
        </h3>
      </div>
      <ChevronRight 
        className={`w-5 h-5 text-orange-400 transition-transform ${showExpiringDocsDetail ? 'rotate-90' : ''}`} 
      />
    </div>
    
    {showExpiringDocsDetail && (
      <>
        <p className="text-sm text-orange-700 mt-3 mb-3">
          The following documents need renewal attention:
        </p>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {expiringDocuments.map((doc) => {
            const { daysRemaining, urgency } = getExpirationUrgency(doc.expiration_date);
            return (
              <div 
                key={doc.id}
                onClick={() => {
                  setSelectedStudent({ id: doc.student_id });
                  setView('student');
                }}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-orange-100 cursor-pointer hover:bg-orange-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {doc.first_name} {doc.last_name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      doc.document_category === '504 Plan' ? 'bg-blue-100 text-blue-700' :
                      doc.document_category === 'IEP' ? 'bg-purple-100 text-purple-700' :
                      doc.document_category === 'Medical Record' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {doc.document_category}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{doc.file_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className={`text-sm font-medium ${
                      urgency === 'critical' ? 'text-red-600' :
                      urgency === 'warning' ? 'text-orange-600' :
                      'text-yellow-600'
                    }`}>
                      {daysRemaining <= 0 ? 'Expired!' : `${daysRemaining} days`}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(doc.expiration_date + 'T00:00:00').toLocaleDateString()}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            );
          })}
        </div>
      </>
    )}
  </div>
)}

      {/* MTSS Referral Candidates Alert */}
      {referralCandidates.count > 0 && !['teacher', 'mtss_support', 'parent'].includes(user?.role) && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-orange-600" />
            <h3 className="font-semibold text-orange-800">
              MTSS Referral Candidates ({referralCandidates.count})
            </h3>
          </div>
          <p className="text-sm text-orange-700 mb-3">
            These Tier 1 students are receiving significant supports with limited progress — consider starting a Pre-Referral Form.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {referralCandidates.candidates.map((student) => (
              <div 
                key={student.id}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-orange-100"
              >
                <div 
                  className="flex-1 min-w-0 cursor-pointer hover:bg-orange-50 -m-2 p-2 rounded-lg transition-colors"
                  onClick={() => {
                    setSelectedStudent({ id: student.id });
                    setView('student');
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {student.last_name}, {student.first_name}
                    </span>
                    <span className="text-xs text-slate-500">{student.grade}</span>
                    {student.has_prereferral_draft && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        Draft Started
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>{student.active_interventions} intervention{student.active_interventions !== 1 ? 's' : ''}</span>
                    <span>•</span>
                    <span>{student.total_logs} log{student.total_logs !== 1 ? 's' : ''}</span>
                    {student.avg_rating !== null && (
                      <>
                        <span>•</span>
                        <span className={student.avg_rating < 3 ? 'text-rose-600 font-medium' : 'text-amber-600'}>
                          Avg: {student.avg_rating}/5
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <button
                    onClick={() => handleReferralMonitoring(student.id, 'monitor')}
                    className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                  >
                    👁 Monitor
                  </button>
                  <span 
                    onClick={() => {
                      setSelectedStudent({ id: student.id });
                      setView('student');
                    }}
                    className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 cursor-pointer hover:bg-orange-200 whitespace-nowrap"
                  >
                    Review →
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monitoring Section */}
      {monitoredStudents.count > 0 && !['teacher', 'mtss_support', 'parent'].includes(user?.role) && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-5 h-5 text-slate-600" />
            <h3 className="font-semibold text-slate-700">
              Monitoring ({monitoredStudents.count})
            </h3>
          </div>
          <p className="text-sm text-slate-500 mb-3">
            These students have been acknowledged and are being monitored. Stats update automatically.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {monitoredStudents.monitored.map((student) => (
              <div 
                key={student.id}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100"
              >
                <div 
                  className="flex-1 min-w-0 cursor-pointer hover:bg-slate-50 -m-2 p-2 rounded-lg transition-colors"
                  onClick={() => {
                    setSelectedStudent({ id: student.id });
                    setView('student');
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {student.last_name}, {student.first_name}
                    </span>
                    <span className="text-xs text-slate-500">{student.grade}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>{student.active_interventions} intervention{student.active_interventions !== 1 ? 's' : ''}</span>
                    <span>•</span>
                    <span>{student.total_logs} log{student.total_logs !== 1 ? 's' : ''}</span>
                    {student.avg_rating !== null && (
                      <>
                        <span>•</span>
                        <span className={student.avg_rating < 3 ? 'text-rose-600 font-medium' : 'text-amber-600'}>
                          Avg: {student.avg_rating}/5
                        </span>
                      </>
                    )}
                    <span>•</span>
                    <span>Since {new Date(student.monitoring_since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <button
                    onClick={() => handleReferralMonitoring(student.id, 'remove')}
                    className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap"
                  >
                    ✕ Remove
                  </button>
                  <span 
                    onClick={() => {
                      setSelectedStudent({ id: student.id });
                      setView('student');
                    }}
                    className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 cursor-pointer hover:bg-orange-200 whitespace-nowrap"
                  >
                    Start Referral →
                  </span>
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
<p className="text-slate-500 mt-1">
  {filterTier === '2_3' ? 'Active MTSS caseload — Tier 2 & 3 students' :
   filterTier === '1' ? 'Tier 1 — Universal supports' :
   filterTier === 'all' ? 'All students across all tiers' :
   `Tier ${filterTier} students`}
</p>
        </div>
        {canAddStudents && !isAdmin && (
          <button
            onClick={() => { setShowAddStudent(true); setEditingStudent(null); resetStudentForm(); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <UserPlus size={18} />
            Add Student
          </button>
        )}
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
          <option value="2_3">Tier 2 & 3</option>
<option value="1">Tier 1</option>
<option value="2">Tier 2</option>
<option value="3">Tier 3</option>
<option value="all">All Tiers</option>
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

      {/* Compact Table View - for Tier 1 and All Tiers */}
      {(filterTier === '1' || filterTier === 'all') ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Grade</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Tier</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Area</th>
                {filterTier === 'all' && (
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Status</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student, idx) => (
                <tr
                  key={student.id}
                  onClick={() => openStudentProfile(student)}
                  className={`border-b border-slate-100 cursor-pointer transition-colors hover:bg-indigo-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${student.archived ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                        <User size={14} />
                      </div>
                      <span className="font-medium text-slate-800">{student.last_name}, {student.first_name}</span>
                      {student.archived && <Archive size={12} className="text-gray-400" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{student.grade}</td>
                  <td className="px-4 py-3">
                    <span className={`${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'} px-2 py-0.5 rounded-full text-xs font-semibold`}>
                      Tier {student.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {student.area && (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${areaColors[student.area]?.badge || 'bg-slate-100 text-slate-600'}`}>
                        {student.area}
                      </span>
                    )}
                  </td>
                  {filterTier === 'all' && (
                    <td className="px-4 py-3">
                      {student.archived && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 text-gray-600 text-xs font-medium rounded-full">
                          Archived
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filteredStudents.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-sm text-slate-500">
              Showing {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      ) : (
        /* Card Grid View - for Tier 2, Tier 3, and Tier 2 & 3 */
        <div className="grid grid-cols-3 gap-3">
          {filteredStudents.map(student => (
            <div
              key={student.id}
              className={`${tierColors[student.tier]?.bg || 'bg-slate-50'} ${tierColors[student.tier]?.border || 'border-slate-200'} border rounded-xl p-3 cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] ${student.archived ? 'opacity-60 border-dashed' : ''}`}
              onClick={() => openStudentProfile(student)}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tierColors[student.tier]?.badge || 'bg-slate-100 text-slate-600'}`}>
                  <User size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-slate-800 truncate">{student.last_name}, {student.first_name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-slate-500">{student.grade}</span>
                    <span className="text-slate-300">·</span>
                    <span className={`text-xs font-medium ${tierColors[student.tier]?.text || 'text-slate-600'}`}>T{student.tier}</span>
                    {student.area && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className={`text-xs px-1.5 rounded ${areaColors[student.area]?.badge || 'bg-slate-100 text-slate-600'}`}>
                          {student.area === 'Social-Emotional' ? 'SEL' : student.area.slice(0, 4)}
                        </span>
                      </>
                    )}
                    {student.archived && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-0.5 text-xs text-gray-500">
                          <Archive size={10} />
                          Archived
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight size={14} className="text-slate-400 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredStudents.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Users size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">No students found</p>
          {filterTier === '2_3' && students.filter(s => !s.archived).length > 0 && (
            <p className="text-sm mt-2">No Tier 2 or 3 students yet. Check Tier 1 to see all students.</p>
          )}
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
    onClick={() => openPreReferralForm()}
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
  <span className="text-xs text-slate-400 ml-2">Plan Status:</span>
  <span className="text-xs text-slate-400 ml-4 flex items-center gap-1">🟠 Not Started</span>
<span className="text-xs text-slate-400 flex items-center gap-1">🟡 In Progress</span>
<span className="text-xs text-slate-400 flex items-center gap-1">🟢 Complete</span>
</div>
              {!selectedStudent.archived && canManageInterventions && (
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

                <div className="grid grid-cols-2 gap-3 mb-3">
  <div>
    <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
    <input
      type="date"
      value={newIntervention.start_date || new Date().toISOString().split('T')[0]}
      onChange={(e) => setNewIntervention({ ...newIntervention, start_date: e.target.value })}
      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  </div>
  <div>
    <label className="block text-xs font-medium text-slate-600 mb-1">End Date <span className="text-slate-400">(optional)</span></label>
    <input
      type="date"
      value={newIntervention.end_date || ''}
      onChange={(e) => setNewIntervention({ ...newIntervention, end_date: e.target.value })}
      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  </div>
</div>

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
  setNewIntervention({ name: '', notes: '', log_frequency: 'weekly', start_date: '', end_date: '' });
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
              {selectedStudent.interventions?.filter(i => i.status !== 'archived').map(intervention => (
                <div key={intervention.id} className="p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-800">{intervention.intervention_name}</h4>
                        {['Behavior Contract', 'Parent Communication Plan', 'Anxiety Management Plan', 
                          'Crisis Safety Plan', 'Daily Behavior Report Card', 'Behavior Intervention Plan',
                          'Token Economy System', 'ABC Behavior Tracker'].includes(intervention.intervention_name) && (
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
                        {intervention.plan_status === 'complete' && (
  <span className="ml-1" title="Plan Complete">🟢</span>
)}
{intervention.plan_status === 'draft' && (
  <span className="ml-1" title="Plan In Progress">🟡</span>
)}
{(!intervention.plan_status || intervention.plan_status === 'not_applicable') && (
  <span className="ml-1" title="Plan Not Started">🟠</span>
)}
                      </div>
                      <p className="text-sm text-slate-500">
  {formatWeekOf(intervention.start_date)}
  {intervention.end_date && ` – ${formatWeekOf(intervention.end_date)}`}
  {intervention.end_date && new Date(intervention.end_date + 'T00:00:00') <= new Date(new Date().setDate(new Date().getDate() + 3)) && new Date(intervention.end_date + 'T00:00:00') >= new Date() && (
    <span className="ml-2 text-xs text-amber-600 font-medium">⏰ Ending soon</span>
  )}
</p>
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
                    {canManageInterventions && <button
                      onClick={() => {
  setSelectedInterventionForProgress({...intervention, student_id: selectedStudent?.id});
  setEditingProgressLog(null);
  setShowProgressForm(true);
}}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Log Progress
                    </button>
                    }{canManageInterventions && <button
                      onClick={() => {
                        setSelectedInterventionForGoal(intervention);
                        setShowGoalForm(true);
                      }}
                      className="px-3 py-1.5 border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-100 flex items-center gap-1"
                    >
                      <Target className="w-3 h-3" />
                      {intervention.goal_description ? 'Edit Goal' : 'set Goal'}
                    </button>}
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
                    {canManageInterventions && <button
                      onClick={() => {
                        setSelectedInterventionForAssignment(intervention);
                        setShowAssignmentManager(true);
                      }}
                      className="px-3 py-1.5 border border-emerald-300 text-emerald-700 text-sm rounded-lg hover:bg-emerald-50 flex items-center gap-1"
                    >
                      <Users className="w-3 h-3" />
                      Assign
                    </button>}
                    {/* Archive button - all staff */}
                    {intervention.status === 'active' && (
                      <button
                        onClick={() => {
                          setSelectedInterventionForAction(intervention);
                          setInterventionArchiveReason('');
                          setShowArchiveInterventionModal(true);
                        }}
                        className="px-3 py-1.5 border border-amber-300 text-amber-700 text-sm rounded-lg hover:bg-amber-50 flex items-center gap-1"
                        title="Archive intervention"
                      >
                        <Archive className="w-3 h-3" />
                        Archive
                      </button>
                    )}
                    {/* Delete button - admin only */}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          setSelectedInterventionForAction(intervention);
                          setShowDeleteInterventionModal(true);
                        }}
                        className="px-3 py-1.5 border border-rose-300 text-rose-600 text-sm rounded-lg hover:bg-rose-50 flex items-center gap-1"
                        title="Delete intervention permanently"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                  {/* Weekly Progress Logs Display */}
                  {weeklyProgressLogs
                    .filter(log => log.student_intervention_id === intervention.id)
                    .slice(0, expandedProgressLogs[intervention.id] ? undefined : 3)
                    .map(log => (
                      <div key={log.id} className="text-sm bg-white p-2 rounded border border-slate-100 mt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">{formatWeekOf(log.week_of)}</span>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(log.status)}`}>
                              {log.status}
                            </span>
                            <button
  onClick={() => openEditProgressLog(log, intervention)}
  className="text-slate-400 hover:text-blue-600 p-1"
  title="Edit log"
>
  <Pencil className="w-3 h-3" />
</button>
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
                      <p className={`text-xs mt-1 ${log.logged_by_role === 'parent' ? 'text-emerald-600' : 'text-slate-400'}`}>
                        Logged by: {log.logged_by_name || 'Unknown'}
                        {log.logged_by_role === 'parent' && ' (Parent)'}
                      </p>
                    </div>
                  ))}
                  {weeklyProgressLogs.filter(log => log.student_intervention_id === intervention.id).length > 3 && (
                    <button
                      onClick={() => setExpandedProgressLogs(prev => ({
                        ...prev,
                        [intervention.id]: !prev[intervention.id]
                      }))}
                      className="text-sm text-indigo-600 hover:text-indigo-800 mt-2 flex items-center gap-1"
                    >
                      {expandedProgressLogs[intervention.id] ? (
                        <>Show Less</>
                      ) : (
                        <>Show More ({weeklyProgressLogs.filter(log => log.student_intervention_id === intervention.id).length - 3} more)</>
                      )}
                    </button>
                  )}
                </div>
              ))}
              {(!selectedStudent.interventions || selectedStudent.interventions.filter(i => i.status !== 'archived').length === 0) && (
                <p className="text-center py-8 text-slate-400">No active interventions</p>
              )}
            </div>

            {/* Archived Interventions Section */}
            {selectedStudent.interventions?.filter(i => i.status === 'archived').length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowArchivedInterventions(!showArchivedInterventions)}
                  className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-2"
                >
                  <Archive size={14} />
                  {showArchivedInterventions ? 'Hide' : 'Show'} Archived Interventions 
                  ({selectedStudent.interventions?.filter(i => i.status === 'archived').length})
                  <ChevronRight size={14} className={`transform transition-transform ${showArchivedInterventions ? 'rotate-90' : ''}`} />
                </button>
                
                {showArchivedInterventions && (
                  <div className="space-y-3">
                    {selectedStudent.interventions
                      ?.filter(i => i.status === 'archived')
                      .map(intervention => (
                        <div key={intervention.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 opacity-75">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h4 className="font-medium text-slate-600">{intervention.intervention_name}</h4>
                              <p className="text-sm text-slate-400">
                                Started {formatWeekOf(intervention.start_date)}
                                {intervention.end_date && ` • Ended ${formatWeekOf(intervention.end_date)}`}
                              </p>
                              {intervention.archive_reason && (
                                <p className="text-xs text-slate-400 mt-1">Reason: {intervention.archive_reason}</p>
                              )}
                            </div>
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                              archived
                            </span>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => handleUnarchiveIntervention(intervention.id)}
                              className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-sm rounded-lg hover:bg-emerald-200 flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Restore
                            </button>
                            <button
                              onClick={() => {
                                setSelectedInterventionForChart(intervention);
                                setShowProgressChart(true);
                              }}
                              className="px-3 py-1.5 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-100 flex items-center gap-1"
                            >
                              <TrendingUp className="w-3 h-3" />
                              View Chart
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  setSelectedInterventionForAction(intervention);
                                  setShowDeleteInterventionModal(true);
                                }}
                                className="px-3 py-1.5 border border-rose-300 text-rose-600 text-sm rounded-lg hover:bg-rose-50 flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                      onClick={() => openMTSSMeetingReport(meeting)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Print
                    </button>
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

         {/* Student Documents Section */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <FileText size={20} className="text-slate-400" />
              <h2 className="text-lg font-semibold text-slate-800">Documents</h2>
              <span className="text-sm text-slate-500">({studentDocuments.length})</span>
            </div>
            {!selectedStudent.archived && (
              <button
                onClick={() => setShowDocumentUpload(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
              >
                <Upload size={16} />
                Upload Document
              </button>
            )}
          </div>

          {/* Upload Form */}
          {showDocumentUpload && (
            <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
              <h3 className="font-medium text-slate-800 mb-3">Upload New Document</h3>
              <form onSubmit={handleDocumentUpload}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">File *</label>
                    <input
                      type="file"
                      name="file"
                      required
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                    <p className="text-xs text-slate-500 mt-1">PDF, DOC, DOCX, PNG, JPG (max 25MB)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                    <select
                      name="document_category"
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="">Select category...</option>
                      {documentCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                    <input
                      type="text"
                      name="description"
                      placeholder="Optional description..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Expiration Date</label>
                    <input
                      type="date"
                      name="expiration_date"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                    <p className="text-xs text-slate-500 mt-1">Auto-set for 504/IEP (1 year)</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDocumentUpload(false)}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={documentUploadLoading}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {documentUploadLoading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Documents List */}
          {studentDocuments.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-8">No documents uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {studentDocuments.map(doc => (
                <div 
                  key={doc.id} 
                  className={`p-4 rounded-xl border ${
                    doc.expiring_soon 
                      ? 'bg-amber-50 border-amber-300' 
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText size={20} className={doc.expiring_soon ? 'text-amber-600' : 'text-slate-400'} />
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        doc.document_category === '504 Plan' ? 'bg-blue-100 text-blue-700' :
                        doc.document_category === 'IEP' ? 'bg-purple-100 text-purple-700' :
                        doc.document_category === 'Evaluation Report' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {doc.document_category}
                      </span>
                    </div>
                    {doc.expiring_soon && (
                      <span className="text-xs px-2 py-0.5 bg-amber-200 text-amber-800 rounded-full flex items-center gap-1">
                        <AlertCircle size={12} />
                        Expiring Soon
                      </span>
                    )}
                  </div>
                  
                  <h4 className="font-medium text-slate-800 text-sm truncate mb-1" title={doc.file_name}>
                    {doc.file_name}
                  </h4>
                  
                  {doc.description && (
                    <p className="text-xs text-slate-500 mb-2 line-clamp-2">{doc.description}</p>
                  )}
                  
                  <div className="text-xs text-slate-400 mb-3">
                    <p>Uploaded by {doc.uploaded_by_name || 'Unknown'}</p>
                    <p>{new Date(doc.uploaded_at).toLocaleDateString()}</p>
                    {doc.expiration_date && (
                      <p className={doc.expiring_soon ? 'text-amber-600 font-medium' : ''}>
                        Expires: {new Date(doc.expiration_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDocumentDownload(doc.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs hover:bg-indigo-200 transition-colors"
                    >
                      <Download size={14} />
                      Download
                    </button>
                    {(user?.role === 'district_admin' || user?.role === 'school_admin') && (
                      <button
                        onClick={() => handleDocumentDelete(doc.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg text-xs hover:bg-rose-200 transition-colors"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MTSS Meeting Form Modal */}
        {showMTSSMeetingForm && selectedStudent && (
          <MTSSMeetingFormModal
            meeting={editingMTSSMeeting}
            onClose={() => setShowMTSSMeetingForm(false)}
            user={user}
            selectedStudent={selectedStudent}
            API_URL={API_URL}
            fetchMTSSMeetings={fetchMTSSMeetings}
          />
        )}
      {/* Intervention Plan Modal */}
{showInterventionPlanModal && currentPlanIntervention && (
  <InterventionPlanModal
    intervention={currentPlanIntervention}
    onClose={() => { setShowInterventionPlanModal(false); setCurrentPlanIntervention(null); }}
    user={user}
    selectedStudent={selectedStudent}
    API_URL={API_URL}
  />
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
          <ReportModal
            onClose={() => setShowReport(false)}
            selectedStudent={selectedStudent}
            API_URL={API_URL}
            token={token}
          />
        )}
        
        {/* MTSS Meeting Report Modal */}
{showMTSSMeetingReport && selectedStudent && selectedMeetingForReport && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:bg-white print:block print:relative">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:mx-0">
      
      {/* Modal Header - Hidden when printing */}
      <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between print:hidden">
        <h2 className="text-xl font-bold text-gray-900">MTSS Meeting Summary</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={printMTSSMeetingReport}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <Printer size={18} />
            Print
          </button>
          <button
            onClick={() => setShowMTSSMeetingReport(false)}
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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">MTSS Progress Review Meeting</h1>
          <p className="text-gray-600">Multi-Tiered System of Supports</p>
          <p className="text-lg font-semibold text-indigo-600 mt-2">
            Meeting #{selectedMeetingForReport.meeting_number} - {
              selectedMeetingForReport.meeting_type === '4-week' ? '4-Week Review' : 
              selectedMeetingForReport.meeting_type === '6-week' ? '6-Week Review' : 
              selectedMeetingForReport.meeting_type === 'final-review' ? 'Final Review' : 'Other'
            }
          </p>
        </div>

        {/* Meeting Info */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg print:bg-white print:border print:border-gray-300">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
          <div className="pt-4 border-t border-gray-200 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Meeting Date</p>
              <p className="font-semibold text-gray-900">
                {selectedMeetingForReport.meeting_date 
                  ? new Date(selectedMeetingForReport.meeting_date + 'T00:00:00').toLocaleDateString('en-US', { 
                      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                    })
                  : 'Not set'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Attendees</p>
              <p className="font-semibold text-gray-900">
                {selectedMeetingForReport.attendees 
                  ? Object.entries(selectedMeetingForReport.attendees)
                      .filter(([key, val]) => val === true)
                      .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
                      .join(', ') || 'None recorded'
                  : 'None recorded'}
              </p>
            </div>
          </div>
        </div>

        {/* Intervention Reviews */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">Intervention Progress Review</h2>
          
          {(!selectedMeetingForReport.intervention_reviews || selectedMeetingForReport.intervention_reviews.length === 0) ? (
            <p className="text-gray-500 italic">No interventions reviewed in this meeting.</p>
          ) : (
            <div className="space-y-4">
              {selectedMeetingForReport.intervention_reviews.map((review, idx) => (
                <div key={idx} className="p-4 border rounded-lg print:break-inside-avoid">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900">{review.intervention_name}</h3>
                    <div className="text-sm text-gray-500">
                      Avg Rating: {review.avg_rating ? Number(review.avg_rating).toFixed(1) : 'N/A'} | 
                      Total Logs: {review.total_logs || 0}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-500 uppercase mb-1">Implementation Fidelity</p>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        review.implementation_fidelity === 'yes' ? 'bg-emerald-100 text-emerald-700' :
                        review.implementation_fidelity === 'partial' ? 'bg-amber-100 text-amber-700' :
                        review.implementation_fidelity === 'no' ? 'bg-rose-100 text-rose-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {review.implementation_fidelity === 'yes' ? 'Implemented as planned' :
                         review.implementation_fidelity === 'partial' ? 'Partial' :
                         review.implementation_fidelity === 'no' ? 'Not consistent' :
                         'Not rated'}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase mb-1">Progress Toward Goal</p>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        review.progress_toward_goal === 'met' ? 'bg-emerald-100 text-emerald-700' :
                        review.progress_toward_goal === 'progressing' ? 'bg-blue-100 text-blue-700' :
                        review.progress_toward_goal === 'minimal' ? 'bg-amber-100 text-amber-700' :
                        review.progress_toward_goal === 'no_progress' ? 'bg-rose-100 text-rose-700' :
                        review.progress_toward_goal === 'regression' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {review.progress_toward_goal === 'met' ? 'Goal Met' :
                         review.progress_toward_goal === 'progressing' ? 'Progressing' :
                         review.progress_toward_goal === 'minimal' ? 'Minimal Progress' :
                         review.progress_toward_goal === 'no_progress' ? 'No Progress' :
                         review.progress_toward_goal === 'regression' ? 'Regression' :
                         'Not rated'}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase mb-1">Recommendation</p>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        review.recommendation === 'continue' ? 'bg-blue-100 text-blue-700' :
                        review.recommendation === 'modify' ? 'bg-amber-100 text-amber-700' :
                        review.recommendation === 'discontinue_met' ? 'bg-emerald-100 text-emerald-700' :
                        review.recommendation === 'discontinue_ineffective' ? 'bg-rose-100 text-rose-700' :
                        review.recommendation === 'add_support' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {review.recommendation === 'continue' ? 'Continue as-is' :
                         review.recommendation === 'modify' ? 'Modify intervention' :
                         review.recommendation === 'discontinue_met' ? 'Discontinue - Goal met' :
                         review.recommendation === 'discontinue_ineffective' ? 'Discontinue - Ineffective' :
                         review.recommendation === 'add_support' ? 'Add additional support' :
                         'No recommendation'}
                      </span>
                    </div>
                  </div>
                  
                  {review.notes && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
                      <p className="text-sm text-gray-700">{review.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team Decision */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">Team Decision</h2>
          
          <div className="space-y-4">
            {/* Tier Decision */}
            <div className="p-4 bg-indigo-50 rounded-lg print:bg-white print:border print:border-indigo-200">
              <p className="text-xs text-indigo-600 uppercase font-medium mb-1">Tier Decision</p>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                selectedMeetingForReport.tier_decision === 'move_tier1' ? 'bg-emerald-100 text-emerald-700' :
                selectedMeetingForReport.tier_decision === 'move_tier3' ? 'bg-rose-100 text-rose-700' :
                selectedMeetingForReport.tier_decision?.includes('refer') ? 'bg-purple-100 text-purple-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {selectedMeetingForReport.tier_decision === 'stay_tier2_continue' ? 'Continue at Tier 2 - Continue interventions' :
                 selectedMeetingForReport.tier_decision === 'stay_tier2_modify' ? 'Continue at Tier 2 - Modify interventions' :
                 selectedMeetingForReport.tier_decision === 'move_tier1' ? 'Move to Tier 1 - Goals met' :
                 selectedMeetingForReport.tier_decision === 'move_tier3' ? 'Move to Tier 3 - Needs intensive support' :
                 selectedMeetingForReport.tier_decision === 'refer_sped' ? 'Refer for Special Education evaluation' :
                 selectedMeetingForReport.tier_decision === 'refer_504' ? 'Refer for 504 Plan' :
                 'No decision recorded'}
              </span>
            </div>

            {/* Progress Summary */}
            {selectedMeetingForReport.progress_summary && (
              <div className="p-4 border rounded-lg">
                <p className="text-xs text-gray-500 uppercase font-medium mb-1">Progress Summary</p>
                <p className="text-gray-700 whitespace-pre-wrap">{selectedMeetingForReport.progress_summary}</p>
              </div>
            )}

            {/* Next Steps */}
            {selectedMeetingForReport.next_steps && (
              <div className="p-4 border rounded-lg">
                <p className="text-xs text-gray-500 uppercase font-medium mb-1">Next Steps</p>
                <p className="text-gray-700 whitespace-pre-wrap">{selectedMeetingForReport.next_steps}</p>
              </div>
            )}

            {/* Next Meeting Date */}
            {selectedMeetingForReport.next_meeting_date && (
              <div className="p-4 bg-gray-50 rounded-lg print:bg-white print:border">
                <p className="text-xs text-gray-500 uppercase font-medium mb-1">Next Meeting Scheduled</p>
                <p className="font-semibold text-gray-900">
                  {new Date(selectedMeetingForReport.next_meeting_date + 'T00:00:00').toLocaleDateString('en-US', { 
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Signature Lines */}
        <div className="mt-12 pt-8 border-t-2 border-gray-300 print:break-inside-avoid">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Signatures</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="border-b border-gray-400 mb-2 h-10"></div>
              <p className="text-sm text-gray-600">Teacher</p>
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
              <p className="text-sm text-gray-600">Counselor/Administrator</p>
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
  <ArchiveStudentModal
    onClose={() => { setShowArchiveModal(false); }}
    user={user}
    selectedStudent={selectedStudent}
    API_URL={API_URL}
    fetchStudents={fetchStudents}
    fetchStudentDetails={fetchStudentDetails}
  />
)}
        {/* Unarchive Modal */}
{showUnarchiveModal && (
 <UnarchiveStudentModal
    onClose={() => setShowUnarchiveModal(false)}
    onUnarchive={() => handleUnarchiveStudent()}
    selectedStudent={selectedStudent}
  />
)}
{/* Archive Intervention Modal */}
        {showArchiveInterventionModal && selectedInterventionForAction && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-100 rounded-full">
                  <Archive size={20} className="text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Archive Intervention</h3>
              </div>
              
              <p className="text-gray-600 mb-2">
                Are you sure you want to archive <strong>{selectedInterventionForAction.intervention_name}</strong>?
              </p>
              <p className="text-sm text-gray-500 mb-4">
                All progress logs, meeting data, and plans will be preserved. You can restore it at any time.
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                <select
                  value={interventionArchiveReason}
                  onChange={(e) => setInterventionArchiveReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select a reason...</option>
                  <option value="Goal met">Goal met</option>
                  <option value="Replaced with new intervention">Replaced with new intervention</option>
                  <option value="Student moved tiers">Student moved tiers</option>
                  <option value="No longer appropriate">No longer appropriate</option>
                  <option value="End of school year">End of school year</option>
                  <option value="Student transferred">Student transferred</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowArchiveInterventionModal(false);
                    setSelectedInterventionForAction(null);
                    setInterventionArchiveReason('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleArchiveIntervention}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-2"
                >
                  <Archive size={16} />
                  Archive Intervention
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Intervention Modal */}
        {showDeleteInterventionModal && selectedInterventionForAction && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-rose-100 rounded-full">
                  <Trash2 size={20} className="text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Delete Intervention</h3>
              </div>
              
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-rose-800">This cannot be undone!</p>
                    <p className="text-sm text-rose-700 mt-1">
                      Permanently deleting <strong>{selectedInterventionForAction.intervention_name}</strong> will also remove all progress logs, staff/parent assignments, and MTSS meeting review data for this intervention.
                    </p>
                  </div>
                </div>
              </div>
              
              <p className="text-sm text-gray-500 mb-4">
                If the intervention is real but no longer needed, use <strong>Archive</strong> instead to preserve the data.
              </p>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowDeleteInterventionModal(false);
                    setSelectedInterventionForAction(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteIntervention}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 flex items-center gap-2"
                >
                  <Trash2 size={16} />
                  Permanently Delete
                </button>
              </div>
            </div>
          </div>
        )}
</div>
    );
  };

 // Create Parent Form Component
const CreateParentForm = ({ students, tenantId, onParentCreated }) => {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    student_ids: []
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/auth/create-parent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          student_ids: formData.student_ids
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Error creating parent account' });
        setSubmitting(false);
        return;
      }
      
      setMessage({ 
        type: 'success', 
        text: `Account created! A setup email has been sent to ${formData.email}` 
      });
      
      // Reset form
      setFormData({
        full_name: '',
        email: '',
        student_ids: []
      });
      
      // Notify parent component
      if (onParentCreated) onParentCreated();
      
    } catch (error) {
      console.error('Error creating parent:', error);
      setMessage({ type: 'error', text: 'Connection error. Please try again.' });
    }
    setSubmitting(false);
  };

  const toggleStudent = (studentId) => {
    setFormData(prev => ({
      ...prev,
      student_ids: prev.student_ids.includes(studentId)
        ? prev.student_ids.filter(id => id !== studentId)
        : [...prev.student_ids, studentId]
    }));
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <h3 className="font-semibold text-lg mb-4">Create Parent Account</h3>
      <p className="text-sm text-slate-500 mb-4">
        Enter the parent's information. They will receive an email with a link to set up their password.
      </p>
      
      {message.text && (
        <div className={`p-3 rounded-lg mb-4 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Full Name *</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Parent's full name"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email Address *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="parent@email.com"
              required
            />
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2">Link to Student(s) <span className="text-slate-400 font-normal">(optional)</span></label>
          <div className="border rounded-lg p-3 max-h-48 overflow-y-auto bg-slate-50">
            {students.length === 0 ? (
              <p className="text-slate-500 text-sm">No students available</p>
            ) : (
              <div className="space-y-2">
                {students.map(student => (
                  <label key={student.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded">
                    <input
                      type="checkbox"
                      checked={formData.student_ids.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm">{student.last_name}, {student.first_name}</span>
                    <span className="text-xs text-slate-400">Grade {student.grade}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {formData.student_ids.length > 0 && (
            <p className="text-xs text-indigo-600 mt-1">
              {formData.student_ids.length} student(s) selected
            </p>
          )}
        </div>
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Creating Account...' : 'Create Account & Send setup Email'}
        </button>
      </form>
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
          onClick={() => { setAdminTab('parents'); fetchParentAccounts(); fetchAllParentLinks(); }}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'parents' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users size={16} />
            Parents
          </div>
        </button>
        <button
  onClick={() => { setAdminTab('staff'); fetch(`${API_URL}/staff/${user.tenant_id}`, { headers: { 'Authorization': `Bearer ${token}` }}).then(r => r.json()).then(d => setStaffList(d)).catch(e => console.error(e)); }}
  className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
    adminTab === 'staff' 
      ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
      : 'text-slate-600 hover:bg-slate-100'
  }`}
>
  <div className="flex items-center gap-2">
    <Users size={16} />
    Staff
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
        {['school_admin', 'counselor', 'behavior_specialist'].includes(user.role) && (
        <button
          onClick={() => { setAdminTab('bank'); fetchBankInterventions(user.tenant_id); }}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            adminTab === 'bank' 
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={16} />
            Intervention Bank
          </div>
        </button>
        )}
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
              <Plus size={18} />
              Add Student
            </button>
          </div>

          {showAddStudent && !editingStudent && (
            <AddStudentForm
              gradeOptions={gradeOptions}
              onSave={async (formData) => {
                try {
                  const res = await fetch(`${API_URL}/students`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tenant_id: user.tenant_id,
                      first_name: formData.first_name,
                      last_name: formData.last_name,
                      grade: formData.grade,
                      tier: parseInt(formData.tier),
                      area: formData.area || null,
                      risk_level: formData.risk_level
                    })
                  });
                  if (res.ok) {
                    fetchStudents(user.tenant_id, showArchived);
                    setShowAddStudent(false);
                  }
                } catch (error) {
                  console.error('Error adding student:', error);
                }
              }}
              onCancel={() => setShowAddStudent(false)}
            />
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

      {/* Parents Tab */}
      {adminTab === 'parents' && (
  <div className="space-y-6">
    {/* Sub-tabs */}
    <div className="flex gap-2">
      <button
        onClick={() => setAdminParentTab('accounts')}
        className={`px-4 py-2 rounded-lg text-sm font-medium ${
          adminParentTab === 'accounts' 
            ? 'bg-emerald-100 text-emerald-700' 
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        Create Account
      </button>
      <button
        onClick={() => setAdminParentTab('links')}
        className={`px-4 py-2 rounded-lg text-sm font-medium ${
          adminParentTab === 'links' 
            ? 'bg-emerald-100 text-emerald-700' 
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        Manage Links
      </button>
    </div>

{/* Create Parent Account */}
    {adminParentTab === 'accounts' && (
      <CreateParentForm 
        students={students} 
        tenantId={user.tenant_id} 
        onParentCreated={() => { fetchParentAccounts(); fetchAllParentLinks(); }} 
      />
    )}

         {/* Manage Links */}
    {adminParentTab === 'links' && (
      <div className="space-y-6">
        {/* Link a Parent */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="font-semibold text-lg mb-4">Link Parent to Student</h3>
          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Parent</label>
              <select
                id="linkParentSelect"
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">-- Select Parent --</option>
                {parentAccounts.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Student</label>
              <select
                id="linkStudentSelect"
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">-- Select Student --</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                const parentId = document.getElementById('linkParentSelect').value;
                const studentId = document.getElementById('linkStudentSelect').value;
                if (parentId && studentId) {
                  handleLinkParent(parentId, studentId, 'parent');
                }
              }}
              className="py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              Link
            </button>
          </div>
        </div>

        {/* Current Links */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="font-semibold text-lg mb-4">Current Parent-Student Links</h3>
          {parentLinksLoading ? (
            <p className="text-slate-500">Loading...</p>
          ) : parentStudentLinks.length === 0 ? (
            <p className="text-slate-500">No parent-student links yet</p>
          ) : (
            <div className="space-y-2">
              {parentStudentLinks.map(link => (
                <div key={link.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <div>
                    <span className="font-medium">{link.parent_name}</span>
                    <span className="text-slate-400 mx-2">→</span>
                    <span>{link.student_name}</span>
                    <span className="text-xs text-slate-500 ml-2">({link.relationship})</span>
                  </div>
                  <button
                    onClick={() => handleUnlinkParent(link.id)}
                    className="text-rose-500 hover:text-rose-700 text-sm"
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}
  </div>
)}
      {/* ==================== STAFF TAB ==================== */}
      {adminTab === 'staff' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Users size={22} className="text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-800">Staff Management</h2>
            </div>
            <button
onClick={() => { setShowAddStaffModal(true); }}              
className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm"
            >
              <Plus size={16} />
              Add Staff
            </button>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Staff members log in with Google SSO using their school email. Create their account here first, then they can sign in.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-slate-500 border-b border-slate-200">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Email</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium">Access</th>
                  <th className="pb-3 font-medium">SSO</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((member) => (
                  <tr key={member.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                          member.role === 'school_admin' || member.role === 'district_admin' ? 'bg-indigo-500' :
                          member.role === 'counselor' ? 'bg-purple-500' :
                          member.role === 'teacher' ? 'bg-emerald-500' :
                          'bg-blue-500'
                        }`}>
                          {member.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-800">{member.full_name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-sm text-slate-600">{member.email}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        member.role === 'school_admin' || member.role === 'district_admin' 
                          ? 'bg-indigo-100 text-indigo-700' :
                        member.role === 'counselor' 
                          ? 'bg-purple-100 text-purple-700' :
                        member.role === 'teacher' 
                          ? 'bg-emerald-100 text-emerald-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {member.role === 'school_admin' ? 'Admin' :
                         member.role === 'district_admin' ? 'District Admin' :
                         member.role === 'counselor' ? 'Counselor' :
                         member.role === 'teacher' ? 'Teacher' :
                         member.role === 'behavior_specialist' ? 'Behavior Spec.' :
                         member.role === 'student_support_specialist' ? 'Support Spec.' :
                         member.role}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs ${member.school_wide_access ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {member.school_wide_access ? 'All Students' : 'Assigned Only'}
                      </span>
                    </td>
                    <td className="py-3">
                      {member.google_id ? (
                        <span className="text-xs text-emerald-600 flex items-center gap-1">
                          <CheckCircle size={14} /> Connected
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Not yet</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setSelectedStaffMember({...member}); setShowEditStaffModal(true); }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 transition"
                          title="Edit"
                        >
                          <Edit size={16} />
                        </button>
                        {member.id !== user.id && (
                          <button
                            onClick={async () => {
                              if (!confirm('Remove ' + member.full_name + '? They will no longer be able to log in.')) return;
                              try {
                                const res = await fetch(API_URL + '/staff/' + member.id, {
                                  method: 'DELETE',
                                  headers: { 'Authorization': 'Bearer ' + token }
                                });
                                if (res.ok) {
                                  const listRes = await fetch(API_URL + '/staff/' + user.tenant_id, { headers: { 'Authorization': 'Bearer ' + token }});
                                  const listData = await listRes.json();
                                  setStaffList(listData);
                                }
                              } catch (err) { alert('Connection error'); }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                            title="Remove"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-400 mt-4">Total: {staffList.length} staff members</p>
        </div>
      )}

      {adminTab === 'bank' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <BookOpen size={24} className="text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-800">Intervention Bank</h2>
            </div>
          </div>
          <p className="text-sm text-slate-500 mb-4">Browse and activate interventions for your school. Active interventions appear when assigning to students.</p>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              <button onClick={() => setBankView('activated')} className={'px-3 py-1.5 ' + (bankView === 'activated' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                My Active ({bankInterventions.filter(i => i.is_activated).length})
              </button>
              <button onClick={() => setBankView('available')} className={'px-3 py-1.5 border-l border-slate-200 ' + (bankView === 'available' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                Available ({bankInterventions.filter(i => !i.is_activated).length})
              </button>
              <button onClick={() => setBankView('all')} className={'px-3 py-1.5 border-l border-slate-200 ' + (bankView === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                All ({bankInterventions.length})
              </button>
            </div>

            <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm">
              <option value="all">All Areas</option>
              <option value="Academic">Academic</option>
              <option value="Behavior">Behavior</option>
              <option value="Social-Emotional">Social-Emotional</option>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500 font-medium mr-1">Tier:</span>
              {['All', '1', '2', '3'].map(t => (
                <button
                  key={t}
                  onClick={() => setBankTierFilter(t)}
                  className={'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ' + (
                    bankTierFilter === t
                      ? (t === '1' ? 'bg-green-600 text-white' : t === '2' ? 'bg-yellow-500 text-white' : t === '3' ? 'bg-red-600 text-white' : 'bg-slate-700 text-white')
                      : (t === '1' ? 'bg-green-50 text-green-700 hover:bg-green-100' : t === '2' ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : t === '3' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                  )}
                >
                  {t === 'All' ? 'All' : 'T' + t}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search interventions..."
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-48"
            />
          </div>

          {['Academic', 'Behavior', 'Social-Emotional']
            .filter(area => bankFilter === 'all' || bankFilter === area)
            .map(area => {
              const areaItems = bankInterventions
                .filter(i => i.area === area)
                .filter(i => bankView === 'all' || (bankView === 'activated' ? i.is_activated : !i.is_activated))
                .filter(i => !bankSearch || i.name.toLowerCase().includes(bankSearch.toLowerCase()))
                .filter(i => bankTierFilter === 'All' || String(i.tier) === bankTierFilter);

              if (areaItems.length === 0) return null;

              return (
                <div key={area} className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className={'w-2 h-2 rounded-full ' + (area === 'Academic' ? 'bg-blue-500' : area === 'Behavior' ? 'bg-amber-500' : 'bg-green-500')}></span>
                    {area} ({areaItems.length})
                  </h3>
                  <div className="space-y-1">
                    {areaItems.map(item => (
                      <div key={item.id} className={'flex items-center justify-between px-4 py-2.5 rounded-lg border ' + (item.is_activated ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200')}>
                        <div className="flex items-center gap-3">
                          <span className={'text-lg ' + (item.is_activated ? 'text-green-500' : 'text-slate-300')}>
                            {item.is_activated ? '✅' : '○'}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800 text-sm">{item.name}</span>
                              {item.tier && <span className={'px-1.5 py-0.5 rounded text-xs font-medium ' + (item.tier === 1 ? 'bg-green-100 text-green-700' : item.tier === 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')}>T{item.tier}</span>}
                              {item.has_plan_template && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">📋 Plan</span>}
                              {item.is_starter && !item.is_activated && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Recommended</span>}
                            </div>
                            {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                          </div>
                        </div>
                        <div>
                          {item.is_activated ? (
                            <button
                              onClick={async () => {
                                if (!confirm('Remove "' + item.name + '" from your active interventions?')) return;
                                try {
                                  const res = await fetch(API_URL + '/intervention-bank/deactivate', {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                                    body: JSON.stringify({ tenant_id: user.tenant_id, template_id: item.id })
                                  });
                                  if (res.ok) {
                                    fetchBankInterventions(user.tenant_id);
                                  } else {
                                    const data = await res.json();
                                    alert(data.error || 'Could not remove intervention');
                                  }
                                } catch (err) { alert('Connection error'); }
                              }}
                              className="text-xs px-3 py-1 text-red-600 hover:bg-red-50 rounded-lg border border-red-200"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(API_URL + '/intervention-bank/activate', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                                    body: JSON.stringify({ tenant_id: user.tenant_id, template_id: item.id, user_id: user.id })
                                  });
                                  if (res.ok) fetchBankInterventions(user.tenant_id);
                                } catch (err) { alert('Connection error'); }
                              }}
                              className="text-xs px-3 py-1 text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

          {bankInterventions.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
              <p>Loading intervention bank...</p>
            </div>
          )}
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
                       onClick={() => { setSelectedAdminTemplate(template); setShowTemplateEditor(true); }}
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

  // Assignment Manager Modal Component
const AssignmentManager = () => {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedParent, setSelectedParent] = useState('');

  useEffect(() => {
    if (selectedInterventionForAssignment) {
      loadAssignments();
    }
  }, [selectedInterventionForAssignment]);

  const loadAssignments = async () => {
    setLoading(true);
    const data = await fetchInterventionAssignments(selectedInterventionForAssignment.id);
    setAssignments(data);
    setLoading(false);
  };

  const handleAddStaff = async () => {
    if (!selectedStaff) return;
    await addInterventionAssignment(selectedInterventionForAssignment.id, selectedStaff, 'staff');
    setSelectedStaff('');
    loadAssignments();
  };

  const handleAddParent = async () => {
    if (!selectedParent) return;
    await addInterventionAssignment(selectedInterventionForAssignment.id, selectedParent, 'parent');
    setSelectedParent('');
    loadAssignments();
  };

  const handleRemove = async (assignmentId) => {
    await removeInterventionAssignment(assignmentId);
    loadAssignments();
  };

  if (!selectedInterventionForAssignment) return null;

  const staffAssignments = assignments.filter(a => a.assignment_type === 'staff');
  const parentAssignments = assignments.filter(a => a.assignment_type === 'parent');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-lg">Manage Assignments</h3>
            <p className="text-sm text-slate-500">{selectedInterventionForAssignment.intervention_name}</p>
          </div>
          <button onClick={() => setShowAssignmentManager(false)} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {loading ? (
            <p className="text-center text-slate-500">Loading...</p>
          ) : (
            <>
              {/* Staff Assignments */}
              <div>
                <h4 className="font-medium text-slate-700 mb-2">👨‍🏫 Assigned Staff</h4>
                {staffAssignments.length > 0 ? (
                  <div className="space-y-2 mb-3">
                    {staffAssignments.map(a => (
                      <div key={a.id} className="flex justify-between items-center bg-blue-50 px-3 py-2 rounded-lg">
                        <div>
                          <span className="font-medium">{a.user_name}</span>
                          <span className="text-xs text-slate-500 ml-2">({a.user_role})</span>
                        </div>
                        <button 
                          onClick={() => handleRemove(a.id)}
                          className="text-rose-500 hover:text-rose-700 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 mb-3">No staff assigned yet</p>
                )}
                <div className="flex gap-2">
                  <select
                    value={selectedStaff}
                    onChange={(e) => setSelectedStaff(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="">-- Select Staff --</option>
                    {staffList
                      .filter(s => !staffAssignments.some(a => a.user_id === s.id))
                      .map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                      ))
                    }
                  </select>
                  <button
                    onClick={handleAddStaff}
                    disabled={!selectedStaff}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Parent Assignments */}
              <div>
                <h4 className="font-medium text-slate-700 mb-2">👨‍👩‍👧 Assigned Parents</h4>
                {parentAssignments.length > 0 ? (
                  <div className="space-y-2 mb-3">
                    {parentAssignments.map(a => (
                      <div key={a.id} className="flex justify-between items-center bg-emerald-50 px-3 py-2 rounded-lg">
                        <div>
                          <span className="font-medium">{a.user_name}</span>
                          <span className="text-xs text-slate-500 ml-2">{a.user_email}</span>
                        </div>
                        <button 
                          onClick={() => handleRemove(a.id)}
                          className="text-rose-500 hover:text-rose-700 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 mb-3">No parents assigned yet</p>
                )}
                <div className="flex gap-2">
                  <select
                    value={selectedParent}
                    onChange={(e) => setSelectedParent(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="">-- Select Parent --</option>
                    {parentsList
                      .filter(p => !parentAssignments.some(a => a.user_id === p.id))
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
                      ))
                    }
                  </select>
                  <button
                    onClick={handleAddParent}
                    disabled={!selectedParent}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50">
          <button
            onClick={() => setShowAssignmentManager(false)}
            className="w-full py-2 px-4 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
  // ============================================
// PARENT PORTAL VIEW COMPONENT
// Add this BEFORE the main return statement in App.jsx
// (around line 4800-ish, where other view components are)
// ============================================

// Parent Portal View Component
const ParentPortalView = () => {
  const [parentStudents, setParentStudents] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [expandedIntervention, setExpandedIntervention] = useState(null);
  const [showParentProgressForm, setShowParentProgressForm] = useState(false);
  const [parentProgressData, setParentProgressData] = useState({
    week_of: getCurrentWeekStart(),
    status: '',
    rating: '',
    response: '',
    notes: ''
  });
  const [selectedInterventionForParentProgress, setSelectedInterventionForParentProgress] = useState(null);
  const [parentLoading, setParentLoading] = useState(true);
  const [childProgressLogs, setChildProgressLogs] = useState([]);
  // Document upload state for parents
const [childDocuments, setChildDocuments] = useState([]);
const [showParentDocumentUpload, setShowParentDocumentUpload] = useState(false);
const [parentDocumentLoading, setParentDocumentLoading] = useState(false);
const parentDocumentCategories = ['Medical Record', 'Parent Communication', 'Other'];

  // Fetch parent's linked students and their interventions
  useEffect(() => {
    const fetchParentStudents = async () => {
      if (!user?.id) return;
      
      try {
        // Get students linked to this parent
        const res = await fetch(`${API_URL}/parent-links/parent/${user.id}`);
        if (res.ok) {
          const students = await res.json();
          
          // Fetch interventions for each student
          const studentsWithInterventions = await Promise.all(
  students.map(async (student) => {
    const intRes = await fetch(`${API_URL}/interventions/student/${student.id}`);
    if (intRes.ok) {
      const interventions = await intRes.json();
      // Add student_id to each intervention so it's available when logging progress
      student.interventions = interventions.map(int => ({...int, student_id: student.id}));
    } else {
      student.interventions = [];
    }
    return student;
  })
);
          
         setParentStudents(studentsWithInterventions);
          
          // Auto-select first child if only one
          if (studentsWithInterventions.length === 1) {
            setSelectedChild(studentsWithInterventions[0]);
            // Fetch progress logs for auto-selected child
            const progressRes = await fetch(`${API_URL}/weekly-progress/student/${studentsWithInterventions[0].id}`);
            if (progressRes.ok) {
              const progressData = await progressRes.json();
              setChildProgressLogs(progressData);
            }
            // Fetch documents for auto-selected child
           fetchChildDocuments(studentsWithInterventions[0].id);
          }
        }
      } catch (error) {
        console.error('Error fetching parent students:', error);
      }
      setParentLoading(false);
    };
    
    fetchParentStudents();
  }, [user?.id]);

  // Handle progress log submission
  const handleParentProgressSubmit = async (e) => {
    e.preventDefault();
    if (!selectedInterventionForParentProgress) return;

    try {
      const res = await fetch(`${API_URL}/weekly-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
          student_intervention_id: selectedInterventionForParentProgress.id,
          student_id: selectedInterventionForParentProgress.student_id || selectedChild?.id,
          ...parentProgressData,
          logged_by: user.id
        })
      });

      if (res.ok) {
        setShowParentProgressForm(false);
        setParentProgressData({
          week_of: getCurrentWeekStart(),
          status: '',
          rating: '',
          response: '',
          notes: ''
        });
        // Refresh the child's interventions
        const intRes = await fetch(`${API_URL}/interventions/student/${selectedChild.id}`);
        if (intRes.ok) {
          const interventions = await intRes.json();
          setSelectedChild({ ...selectedChild, interventions });
        }
        // Refresh progress logs
        const progressRes = await fetch(`${API_URL}/weekly-progress/student/${selectedChild.id}`);
        if (progressRes.ok) {
          const progressData = await progressRes.json();
          setChildProgressLogs(progressData);
        }
        alert('Progress logged successfully!');
      }
    } catch (error) {
      console.error('Error logging progress:', error);
      alert('Error logging progress. Please try again.');
    }
  };

  // Fetch documents for selected child (filtered for parent view)
const fetchChildDocuments = async (studentId) => {
  try {
    const res = await fetch(`${API_URL}/student-documents/student/${studentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      // Parents can only see these categories
      const allowedCategories = ['504 Plan', 'IEP', 'Medical Record', 'Parent Communication'];
      const filteredDocs = data.filter(doc => allowedCategories.includes(doc.document_category));
      setChildDocuments(filteredDocs);
    }
  } catch (error) {
    console.error('Error fetching child documents:', error);
  }
};

// Handle parent document upload
const handleParentDocumentUpload = async (e) => {
  e.preventDefault();
  setParentDocumentLoading(true);
  
  const formData = new FormData(e.target);
  formData.append('student_id', selectedChild.id);
  formData.append('tenant_id', user.tenant_id);
  formData.append('uploaded_by', user.id);
  
  try {
    const res = await fetch(`${API_URL}/student-documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (res.ok) {
      alert('Document uploaded successfully!');
      setShowParentDocumentUpload(false);
      e.target.reset();
      fetchChildDocuments(selectedChild.id);
    } else {
      const error = await res.json();
      alert(`Upload failed: ${error.message || 'Please try again.'}`);
    }
  } catch (error) {
    console.error('Error uploading document:', error);
    alert('Upload failed. Please try again.');
  }
  setParentDocumentLoading(false);
};

// Handle document download
const handleDocumentDownload = async (docId, fileName) => {
  try {
    const res = await fetch(`${API_URL}/student-documents/download/${docId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      window.open(data.downloadUrl, '_blank');
    }
  } catch (error) {
    console.error('Error downloading document:', error);
    alert('Download failed. Please try again.');
  }
};

  if (parentLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      {/* Header */}
      <div className="bg-emerald-600 text-white px-4 py-6 shadow-lg">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold">Welcome, {user?.full_name?.split(' ')[0] || 'Parent'}!</h1>
              <p className="text-emerald-100 text-sm">TierTrak Parent Portal</p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('token');
                setToken(null);
                setUser(null);
              }}
              className="p-2 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* No children linked */}
        {parentStudents.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <User className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">No Students Linked</h2>
            <p className="text-slate-500">
              Your account hasn't been linked to any students yet. Please contact your school's MTSS coordinator.
            </p>
          </div>
        )}

        {/* Child selector (if multiple children) */}
        {parentStudents.length > 1 && !selectedChild && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-700">Select a Child</h2>
            {parentStudents.map(child => (
              <button
                key={child.id}
                onClick={async () => {
                  setSelectedChild(child);
                  const progressRes = await fetch(`${API_URL}/weekly-progress/student/${child.id}`);
                  if (progressRes.ok) {
                    const progressData = await progressRes.json();
                    setChildProgressLogs(progressData);
                  }
                  // Fetch documents for this child
                 fetchChildDocuments(child.id);
                }}
                className="w-full bg-white rounded-xl shadow-sm border p-4 text-left hover:border-emerald-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                    <User className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{child.first_name} {child.last_name}</h3>
                    <p className="text-sm text-slate-500">Grade {child.grade} • {child.interventions?.length || 0} interventions</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400 ml-auto" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected child view */}
        {selectedChild && (
          <div className="space-y-4">
            {/* Back button (if multiple children) */}
            {parentStudents.length > 1 && (
              <button
                onClick={() => setSelectedChild(null)}
                className="flex items-center gap-2 text-emerald-600 font-medium"
              >
                <ChevronLeft className="w-5 h-5" />
                Back to Children
              </button>
            )}

            {/* Child header card */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <User className="w-7 h-7 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{selectedChild.first_name} {selectedChild.last_name}</h2>
                  <p className="text-slate-500">Grade {selectedChild.grade}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${tierColors[selectedChild.tier]?.badge || 'bg-slate-100 text-slate-700'}`}>
                  Tier {selectedChild.tier}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${areaColors[selectedChild.area]?.badge || 'bg-slate-100 text-slate-700'}`}>
                  {selectedChild.area}
                </span>
              </div>
            </div>

            {/* Interventions */}
            <div className="space-y-3">
              <h3 className="font-semibold text-slate-700">Active Interventions</h3>
              
              {(!selectedChild.interventions || selectedChild.interventions.length === 0) && (
                <div className="bg-white rounded-xl shadow-sm border p-6 text-center">
                  <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500">No active interventions</p>
                </div>
              )}

              {selectedChild.interventions?.map(intervention => (
                <div key={intervention.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  {/* Intervention header - clickable to expand */}
                  <button
                    onClick={() => setExpandedIntervention(
                      expandedIntervention === intervention.id ? null : intervention.id
                    )}
                    className="w-full p-4 text-left flex items-center justify-between"
                  >
                    <div>
                      <h4 className="font-medium text-slate-800">{intervention.intervention_name}</h4>
                      <p className="text-sm text-slate-500">
                        Started {new Date(intervention.start_date).toLocaleDateString()}
                        {intervention.log_frequency && (
                          <span className="ml-2">• 📅 {intervention.log_frequency}</span>
                        )}
                      </p>
                    </div>
                    <div className={`transform transition-transform ${expandedIntervention === intervention.id ? 'rotate-180' : ''}`}>
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    </div>
                  </button>

                  {/* Expanded content */}
{expandedIntervention === intervention.id && (
  <div className="px-4 pb-4 border-t">
    {/* Intervention name */}
    <h4 className="font-semibold text-slate-800 mt-3 mb-2">{intervention.intervention_name}</h4>
    
    {/* Goal if exists */}
    {intervention.goal_description && (
                        <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                          <p className="text-xs font-medium text-amber-700 mb-1">🎯 Goal</p>
                          <p className="text-sm text-amber-800">{intervention.goal_description}</p>
                          {intervention.goal_target_date && (
                            <p className="text-xs text-amber-600 mt-1">
                              Target: {new Date(intervention.goal_target_date).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Notes */}
                      {intervention.notes && (
                        <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                          <p className="text-xs font-medium text-slate-500 mb-1">Notes</p>
                          <p className="text-sm text-slate-700">{intervention.notes}</p>
                        </div>
                      )}

                      {/* Log Progress Button */}
                      <button
                        onClick={() => {
                          setSelectedInterventionForParentProgress({...intervention, student_id: selectedChild?.id});
                          setShowParentProgressForm(true);
                        }}
                        className="mt-4 w-full py-3 px-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 active:bg-emerald-800 transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" />
                        Log Progress
                      </button>

                      {/* Progress History */}
                      {childProgressLogs.filter(log => log.student_intervention_id === intervention.id).length > 0 && (
                        <div className="mt-4 pt-4 border-t">
                          <h5 className="text-sm font-medium text-slate-700 mb-2">Progress History</h5>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {childProgressLogs
                              .filter(log => log.student_intervention_id === intervention.id)
                              .slice(0, 10)
                              .map(log => (
                                <div key={log.id} className="p-3 bg-slate-50 rounded-lg text-sm">
                                  <div className="flex justify-between items-start mb-1">
                                    <span className="text-slate-600">{log.week_of ? new Date(log.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}</span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      log.status === 'Implemented as Planned' ? 'bg-emerald-100 text-emerald-700' :
                                      log.status === 'Partially Implemented' ? 'bg-amber-100 text-amber-700' :
                                      log.status === 'Student Absent' ? 'bg-slate-100 text-slate-600' :
                                      'bg-rose-100 text-rose-700'
                                    }`}>
                                      {log.status}
                                    </span>
                                  </div>
                                  {log.rating && (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-slate-500">Rating:</span>
                                      <span className={`font-medium ${
                                        log.rating >= 4 ? 'text-emerald-600' :
                                        log.rating >= 3 ? 'text-amber-600' : 'text-rose-600'
                                      }`}>{log.rating}/5</span>
                                    </div>
                                  )}
                                  {log.notes && <p className="text-slate-600 text-xs mt-1">{log.notes}</p>}
                                  <p className="text-xs text-slate-400 mt-1">
                                    Logged by: {log.logged_by_name || 'Unknown'} 
                                    {log.logged_by_role === 'parent' && ' (Parent)'}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div className="space-y-3 mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">Documents</h3>
          <button
            onClick={() => setShowParentDocumentUpload(!showParentDocumentUpload)}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition-colors"
          >
            <Upload size={16} />
            Upload
          </button>
        </div>

        {/* Upload Form */}
        {showParentDocumentUpload && (
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
            <h4 className="font-medium text-slate-800 mb-3">Upload Document</h4>
            <form onSubmit={handleParentDocumentUpload}>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">File *</label>
                  <input
                    type="file"
                    name="file"
                    required
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">PDF, DOC, DOCX, PNG, JPG (max 25MB)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                  <select
                    name="document_category"
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    <option value="">Select category...</option>
                    {parentDocumentCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <input
                    type="text"
                    name="description"
                    placeholder="Optional description..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowParentDocumentUpload(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={parentDocumentLoading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {parentDocumentLoading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Documents List */}
        {childDocuments.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-6 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {childDocuments.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl shadow-sm border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-8 h-8 text-emerald-600" />
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{doc.file_name}</p>
                      <p className="text-xs text-slate-500">
                        {doc.document_category} • {new Date(doc.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDocumentDownload(doc.id, doc.file_name)}
                    className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

     
      {/* Progress Logging Modal */}
      {showParentProgressForm && selectedInterventionForParentProgress && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Log Progress</h3>
              <button
                onClick={() => setShowParentProgressForm(false)}
                className="p-2 hover:bg-slate-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleParentProgressSubmit} className="p-4 space-y-4">
              {/* Intervention name */}
              <div className="p-3 bg-emerald-50 rounded-lg">
                <p className="text-sm font-medium text-emerald-800">
                  {selectedInterventionForParentProgress.name}
                </p>
              </div>

              {/* Week of */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Week Of</label>
                <input
                  type="date"
                  value={parentProgressData.week_of}
                  onChange={(e) => setParentProgressData({...parentProgressData, week_of: e.target.value})}
                  className="w-full px-4 py-3 border rounded-xl text-base"
                  required
                />
              </div>

              {/* Implementation Status */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Did you implement this intervention?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {['Implemented as Planned', 'Partially Implemented', 'Not Implemented', 'Student Absent'].map(status => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setParentProgressData({...parentProgressData, status})}
                      className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                        parentProgressData.status === status
                          ? 'bg-emerald-100 border-emerald-500 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress Rating */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How did your child do?
                </label>
                <div className="flex gap-2 justify-between">
                  {[1, 2, 3, 4, 5].map(rating => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => setParentProgressData({...parentProgressData, rating})}
                      className={`flex-1 py-4 rounded-xl border text-lg font-bold transition-all ${
                        parentProgressData.rating === rating
                          ? rating >= 4 ? 'bg-emerald-100 border-emerald-500 text-emerald-700'
                          : rating >= 3 ? 'bg-amber-100 border-amber-500 text-amber-700'
                          : 'bg-rose-100 border-rose-500 text-rose-700'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between mt-1 px-1">
                  <span className="text-xs text-slate-400">No Progress</span>
                  <span className="text-xs text-slate-400">Great Progress</span>
                </div>
              </div>

              {/* Student Response */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How did your child respond?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {['Engaged', 'Cooperative', 'Resistant', 'Frustrated', 'Distracted'].map(response => (
                    <button
                      key={response}
                      type="button"
                      onClick={() => setParentProgressData({...parentProgressData, response})}
                      className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                        parentProgressData.response === response
                          ? 'bg-blue-100 border-blue-500 text-blue-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {response}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={parentProgressData.notes}
                  onChange={(e) => setParentProgressData({...parentProgressData, notes: e.target.value})}
                  className="w-full px-4 py-3 border rounded-xl text-base"
                  rows={3}
                  placeholder="Any observations or comments..."
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!parentProgressData.status || !parentProgressData.rating}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-semibold text-lg hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save Progress
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// END OF PARENT PORTAL VIEW COMPONENT
// ============================================
  
  // Show parent portal for parent users
if (isParent) {
  return <ParentPortalView />;
}
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
                    <settings size={16} />
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
     {/* Add Custom Intervention Modal */}
      {showAddTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold text-lg text-slate-800">New Custom Intervention</h3>
              <button
                onClick={() => { setShowAddTemplate(false); setNewTemplate({ name: '', description: '', area: '', tier: '' }); }}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Intervention Name *</label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Shortened Assignments"
                  autoFocus
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
            <div className="p-4 border-t bg-slate-50 flex justify-end gap-2 rounded-b-xl">
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
        </div>
      )}

      {showAddStaffModal && (
  <AddStaffModal onClose={() => { setShowAddStaffModal(false); }} user={user} token={token} API_URL={API_URL} loadStaffList={loadStaffList} />
)}

      {/* Edit Staff Modal */}
{showEditStaffModal && selectedStaffMember && (
  <EditStaffModal
    staffMember={selectedStaffMember}
    onClose={() => { setShowEditStaffModal(false); setSelectedStaffMember(null); }}
    user={user} token={token} API_URL={API_URL} loadStaffList={loadStaffList}
  />
)}

      {/* App Footer */}
      <footer className="mt-auto py-4 px-6 border-t border-slate-200 bg-white/80">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>© 2026</span>
              <a 
                href="https://www.scholarpathsystems.org" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-700 font-medium"
              >
                ScholarPath Systems
              </a>
            </div>
            <span className="hidden sm:inline text-slate-300">|</span>
            <a 
              href="https://gradtrak.scholarpathsystems.org" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hidden sm:inline text-sm text-slate-500 hover:text-indigo-600"
            >
             TierTrak             
             </a>
          </div>
          <FERPABadge compact />
        </div>
      </footer>
      {showProgressForm && selectedInterventionForProgress && (
  <ProgressFormModal
    intervention={selectedInterventionForProgress}
    editingLog={editingProgressLog}
    onClose={() => { setShowProgressForm(false); setEditingProgressLog(null); }}
    user={user}
    fetchWeeklyProgress={fetchWeeklyProgress}
  />
)}

       {/* Goal Setting Modal */}
{showGoalForm && selectedInterventionForGoal && (
  <GoalFormModal
    intervention={selectedInterventionForGoal}
    onClose={() => setShowGoalForm(false)}
    token={token}
    selectedStudent={selectedStudent}
    API_URL={API_URL}
    fetchStudentDetails={fetchStudentDetails}
  />
)}
       {/* Progress Chart Modal */}
{showProgressChart && selectedInterventionForChart && (
  <ProgressChartModal
    intervention={selectedInterventionForChart}
    onClose={() => setShowProgressChart(false)}
  />
)}
{showAssignmentManager && <AssignmentManager />}
      
      {showTemplateEditor && selectedAdminTemplate && (
<TemplateEditorModal
    template={selectedAdminTemplate}
    adminTemplates={adminTemplates}
    onClose={() => setShowTemplateEditor(false)}
    onRefresh={fetchAdminTemplates}
  />
)}

{/* Pre-Referral Form Modal */}
        {showPreReferralForm && selectedStudent && (
          <PreReferralFormModal
            onClose={() => setShowPreReferralForm(false)}
            user={user}
            selectedStudent={selectedStudent}
            API_URL={API_URL}
          />
        )}

    </div>
  );
}

// Force redeploy Sun Jan 25 16:54:04 PST 2026
// Redeploy Sun Jan 25 18:51:20 PST 2026
