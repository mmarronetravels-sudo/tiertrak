import { X, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useApp } from '../../context/AppContext';

// Rating helpers (import from utils/constants.js if already extracted)
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

const getRatingColor = (rating) => {
  if (rating >= 4) return 'text-emerald-600';
  if (rating >= 3) return 'text-amber-600';
  return 'text-rose-600';
};

const ProgressChartModal = ({ intervention, onClose }) => {
  const { weeklyProgressLogs } = useApp();

  // Filter logs for this intervention
  const interventionLogs = weeklyProgressLogs
    .filter(log => log.student_intervention_id === intervention.id && log.rating)
    .sort((a, b) => new Date(a.week_of) - new Date(b.week_of));

  // Separate logs by who logged them (staff vs parent)
  const staffLogs = interventionLogs.filter(log => log.logged_by_role !== 'parent');
  const parentLogs = interventionLogs.filter(log => log.logged_by_role === 'parent');

  // Create chart data showing ALL individual log entries
  // Each entry gets staffRating OR parentRating based on who logged it
  const chartData = interventionLogs.map((log, index) => ({
    index: index,
    week: new Date(log.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    weekOf: log.week_of,
    staffRating: log.logged_by_role !== 'parent' ? log.rating : null,
    parentRating: log.logged_by_role === 'parent' ? log.rating : null,
    isParent: log.logged_by_role === 'parent',
    rating: log.rating,
    status: log.status,
    response: log.response,
    notes: log.notes,
    loggerName: log.logged_by_name,
    loggerRole: log.logged_by_role
  }));

  const goalRating = intervention.goal_target_rating;
  const hasStaffData = staffLogs.length > 0;
  const hasParentData = parentLogs.length > 0;

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-lg">Progress Over Time</h3>
            <p className="text-sm text-slate-500">{intervention.intervention_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {chartData.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <TrendingUp size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-lg">No progress data yet</p>
              <p className="text-sm mt-2">Log weekly progress to see the chart</p>
            </div>
          ) : (
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
                          const borderColor = data.isParent ? 'border-emerald-500' : 'border-blue-500';
                          const label = data.isParent ? 'Parent' : 'Staff';
                          return (
                            <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200">
                              <p className="font-medium text-slate-800">{data.week}</p>
                              <div className={`mt-1 border-l-2 ${borderColor} pl-2`}>
                                <p className={`text-sm ${getRatingColor(data.rating)}`}>
                                  {label}: {data.rating}/5 - {getRatingLabel(data.rating)}
                                </p>
                                {data.loggerName && <p className="text-xs text-slate-500">Logged by: {data.loggerName}</p>}
                                {data.notes && <p className="text-xs text-slate-600 mt-1 max-w-xs">{data.notes}</p>}
                              </div>
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
                    {/* Staff Rating Line (Blue) */}
                    {hasStaffData && (
                      <Line 
                        type="monotone" 
                        dataKey="staffRating" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, fill: '#1d4ed8' }}
                        connectNulls={true}
                        name="Staff"
                      />
                    )}
                    {/* Parent Rating Line (Green) */}
                    {hasParentData && (
                      <Line 
                        type="monotone" 
                        dataKey="parentRating" 
                        stroke="#10b981" 
                        strokeWidth={3}
                        dot={{ fill: '#10b981', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, fill: '#059669' }}
                        connectNulls={true}
                        name="Parent"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-6 mt-4 text-sm flex-wrap">
                {hasStaffData && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-blue-500 rounded"></div>
                    <span className="text-slate-600">Staff Rating ({staffLogs.length})</span>
                  </div>
                )}
                {hasParentData && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-emerald-500 rounded"></div>
                    <span className="text-slate-600">Parent Rating ({parentLogs.length})</span>
                  </div>
                )}
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
              {interventionLogs.length >= 1 && (
                <div className="mt-4">
                  {/* Staff Stats */}
                  {hasStaffData && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-blue-700 mb-2 flex items-center gap-1">
                        <div className="w-3 h-1 bg-blue-500 rounded"></div> Staff Progress
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-blue-700">
                            {(staffLogs.reduce((sum, d) => sum + d.rating, 0) / staffLogs.length).toFixed(1)}
                          </p>
                          <p className="text-xs text-blue-600">Avg Rating</p>
                        </div>
                        <div className="p-2 bg-blue-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-blue-700">
                            {Math.max(...staffLogs.map(d => d.rating))}
                          </p>
                          <p className="text-xs text-blue-600">Highest</p>
                        </div>
                        <div className="p-2 bg-blue-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-blue-700">{staffLogs.length}</p>
                          <p className="text-xs text-blue-600">Entries</p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Parent Stats */}
                  {hasParentData && (
                    <div>
                      <p className="text-xs font-medium text-emerald-700 mb-2 flex items-center gap-1">
                        <div className="w-3 h-1 bg-emerald-500 rounded"></div> Parent Progress
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-emerald-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-emerald-700">
                            {(parentLogs.reduce((sum, d) => sum + d.rating, 0) / parentLogs.length).toFixed(1)}
                          </p>
                          <p className="text-xs text-emerald-600">Avg Rating</p>
                        </div>
                        <div className="p-2 bg-emerald-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-emerald-700">
                            {Math.max(...parentLogs.map(d => d.rating))}
                          </p>
                          <p className="text-xs text-emerald-600">Highest</p>
                        </div>
                        <div className="p-2 bg-emerald-50 rounded-lg text-center">
                          <p className="text-xl font-bold text-emerald-700">{parentLogs.length}</p>
                          <p className="text-xs text-emerald-600">Entries</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t bg-slate-50">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProgressChartModal;