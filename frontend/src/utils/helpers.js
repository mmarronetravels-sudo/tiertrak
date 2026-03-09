export const getCurrentWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
};

export const formatWeekOf = (dateStr) => {
  if (!dateStr) return 'No date';
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const getRatingLabel = (rating) => {
  const labels = {
    1: 'No Progress',
    2: 'Minimal Progress',
    3: 'Some Progress',
    4: 'Good Progress',
    5: 'Significant Progress'
  };
  return labels[rating] || '';
};

export const getRatingColor = (rating) => {
  if (rating >= 4) return 'text-emerald-600';
  if (rating >= 3) return 'text-amber-600';
  return 'text-rose-600';
};

export const getStatusColor = (status) => {
  switch (status) {
    case 'Implemented as Planned': return 'bg-emerald-100 text-emerald-800';
    case 'Partially Implemented': return 'bg-amber-100 text-amber-800';
    case 'Not Implemented': return 'bg-rose-100 text-rose-800';
    case 'Student Absent': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};