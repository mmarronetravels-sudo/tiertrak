import { createContext, useContext, useState, useEffect, useRef } from 'react';

const AppContext = createContext();

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function AppProvider({ children }) {
  // === AUTH ===
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  // === NAVIGATION ===
  const [view, setView] = useState('dashboard');

  // === CORE DATA ===
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [interventionTemplates, setInterventionTemplates] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [parentsList, setParentsList] = useState([]);
  const [logOptions, setLogOptions] = useState({ timeOfDay: [], location: [] });

  // === DASHBOARD ALERTS ===
  const [missingLogs, setMissingLogs] = useState({ missing_count: 0, interventions: [] });
  const [expiringDocuments, setExpiringDocuments] = useState([]);
  const [referralCandidates, setReferralCandidates] = useState({ count: 0, candidates: [] });
  const [monitoredStudents, setMonitoredStudents] = useState({ count: 0, monitored: [] });

  // === STUDENT PROFILE DATA ===
  const [interventionLogs, setInterventionLogs] = useState([]);
  const [weeklyProgressLogs, setWeeklyProgressLogs] = useState([]);
  const [studentDocuments, setStudentDocuments] = useState([]);
  const [mtssMeetings, setMTSSMeetings] = useState([]);

  // === DERIVED VALUES ===
  const isAdmin = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);
  const canArchive = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);
  const canAddStudents = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist', 'mtss_support'].includes(user.role);
  const canManageInterventions = user && user.role !== 'mtss_support' && user.role !== 'parent';
  const canDeleteDocs = user && ['district_admin', 'school_admin', 'counselor', 'behavior_specialist'].includes(user.role);
  const isParent = user && user.role === 'parent';

  // === REFS (shared across components) ===
  const googleButtonRef = useRef(null);

  // ============================================
  // SHARED FETCH FUNCTIONS
  // ============================================

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

  const fetchStudentDetails = async (studentId) => {
    try {
      const res = await fetch(`${API_URL}/students/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedStudent(data);
        fetchInterventionLogs(studentId);
        fetchWeeklyProgress(studentId);
        fetchStudentDocuments(studentId);
        if (data.tier > 1) {
          fetchMTSSMeetings(studentId);
        }
      }
    } catch (error) {
      console.error('Error fetching student details:', error);
    }
  };

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

  const fetchWeeklyProgress = async (studentId) => {
    try {
      const response = await fetch(`${API_URL}/weekly-progress/student/${studentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setWeeklyProgressLogs(data);
      }
    } catch (err) {
      console.error('Error fetching weekly progress:', err);
    }
  };

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

  const fetchStaffList = async () => {
    if (!user?.tenant_id) return;
    try {
      const response = await fetch(`${API_URL}/staff/${user.tenant_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setStaffList(data);
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
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

  // ============================================
  // SHARED ACTION FUNCTIONS
  // ============================================

  const openStudentProfile = (student) => {
    fetchStudentDetails(student.id);
    setView('student');
  };

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

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setStudents([]);
    setSelectedStudent(null);
    setInterventionLogs([]);
  };

  // ============================================
  // EFFECTS
  // ============================================

  // Check if logged in on load
  useEffect(() => {
    if (token) {
      fetchUserInfo();
      fetchLogOptions();
    } else {
      setLoading(false);
    }
  }, [token]);

  // Fetch dashboard data when dashboard loads
  useEffect(() => {
    if (view === 'dashboard' && user?.tenant_id) {
      fetchMissingLogs();
      fetchReferralCandidates();
      fetchMonitoredStudents();
      fetchExpiringDocuments();
    }
  }, [view, user?.tenant_id]);

  // ============================================
  // CONTEXT VALUE
  // ============================================

  const value = {
    // Auth
    user, setUser, token, setToken, loading, setLoading,
    
    // Navigation
    view, setView,
    
    // Core Data
    students, setStudents,
    selectedStudent, setSelectedStudent,
    interventionTemplates, setInterventionTemplates,
    staffList, setStaffList,
    parentsList, setParentsList,
    logOptions, setLogOptions,
    
    // Dashboard Alerts
    missingLogs, setMissingLogs,
    expiringDocuments, setExpiringDocuments,
    referralCandidates, setReferralCandidates,
    monitoredStudents, setMonitoredStudents,
    
    // Student Profile Data
    interventionLogs, setInterventionLogs,
    weeklyProgressLogs, setWeeklyProgressLogs,
    studentDocuments, setStudentDocuments,
    mtssMeetings, setMTSSMeetings,
    
    // Derived Values
    isAdmin, canArchive, canAddStudents, canManageInterventions, canDeleteDocs, isParent,
    
    // Constants
    API_URL,
    
    // Refs
    googleButtonRef,
    
    // Fetch Functions
    fetchUserInfo,
    fetchStudents,
    fetchInterventionTemplates,
    fetchStudentDetails,
    fetchInterventionLogs,
    fetchWeeklyProgress,
    fetchStudentDocuments,
    fetchMTSSMeetings,
    fetchLogOptions,
    fetchExpiringDocuments,
    fetchMissingLogs,
    fetchReferralCandidates,
    fetchMonitoredStudents,
    fetchStaffList,
    fetchParentsList,
    
    // Action Functions
    openStudentProfile,
    handleTierChange,
    handleReferralMonitoring,
    handleLogout,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export default AppContext;