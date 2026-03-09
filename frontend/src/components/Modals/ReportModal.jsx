import { useState, useEffect } from 'react';
import { X, Printer } from 'lucide-react';

const ReportModal = ({ onClose, selectedStudent, API_URL, token }) => {
  const [reportDateRange, setReportDateRange] = useState({
    startDate: '',
    endDate: new Date().toISOString().split('T')[0]
  });
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(function() {
    generateReport();
  }, []);

  const generateReport = async function() {
    setLoading(true);

    // Get the earliest intervention start date as default start
    var interventions = selectedStudent.interventions || [];
    var earliestStart = interventions.length > 0
      ? interventions.reduce(function(earliest, int) {
          var startDate = int.start_date ? int.start_date.split('T')[0] : null;
          if (!startDate) return earliest;
          return !earliest || startDate < earliest ? startDate : earliest;
        }, null)
      : new Date().toISOString().split('T')[0];

    var defaultStartDate = earliestStart || new Date().toISOString().split('T')[0];
    setReportDateRange(function(prev) {
      return {
        ...prev,
        startDate: prev.startDate || defaultStartDate
      };
    });

    // Fetch weekly progress for all interventions
    var progressPromises = interventions.map(async function(intervention) {
      try {
        var res = await fetch(API_URL + '/weekly-progress/intervention/' + intervention.id, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
          var data = await res.json();
          return { interventionId: intervention.id, progress: data };
        }
      } catch (err) {
        console.error('Error fetching progress:', err);
      }
      return { interventionId: intervention.id, progress: [] };
    });

    var progressResults = await Promise.all(progressPromises);
    var progressMap = {};
    progressResults.forEach(function(item) {
      progressMap[item.interventionId] = item.progress;
    });

    setReportData({
      student: selectedStudent,
      progressMap: progressMap,
      generatedAt: new Date().toISOString()
    });

    setLoading(false);
  };

  const printReport = function() {
    window.print();
  };

  const filterByDateRange = function(items, dateField) {
    if (!items) return [];
    return items.filter(function(item) {
      var itemDate = item[dateField] ? item[dateField].split('T')[0] : null;
      if (!itemDate) return false;
      return itemDate >= reportDateRange.startDate && itemDate <= reportDateRange.endDate;
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <p className="text-gray-600">Generating report...</p>
        </div>
      </div>
    );
  }

  return (
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
                onChange={function(e) { setReportDateRange(function(prev) { return { ...prev, startDate: e.target.value }; }); }}
                className="px-2 py-1 border rounded text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">To:</label>
              <input
                type="date"
                value={reportDateRange.endDate}
                onChange={function(e) { setReportDateRange(function(prev) { return { ...prev, endDate: e.target.value }; }); }}
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
              onClick={onClose}
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
                <p className={'font-semibold ' + (
                  selectedStudent.tier === 1 ? 'text-emerald-600' :
                  selectedStudent.tier === 2 ? 'text-amber-600' : 'text-rose-600'
                )}>Tier {selectedStudent.tier}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Focus Area</p>
                <p className="font-semibold text-gray-900">{selectedStudent.area || 'N/A'}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Report Period</p>
              <p className="font-semibold text-gray-900">
                {reportDateRange.startDate ? new Date(reportDateRange.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not set'} &mdash; {reportDateRange.endDate ? new Date(reportDateRange.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not set'}
              </p>
            </div>
          </div>

          {/* Interventions & Progress */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b">Interventions &amp; Progress</h2>

            {(selectedStudent.interventions || []).length === 0 ? (
              <p className="text-gray-500 italic">No interventions assigned.</p>
            ) : (
              (selectedStudent.interventions || []).map(function(intervention) {
                var progressLogs = reportData && reportData.progressMap ? (reportData.progressMap[intervention.id] || []) : [];
                var filteredLogs = filterByDateRange(progressLogs, 'week_of');

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
                      <span className={'px-2 py-1 rounded text-xs font-medium ' + (
                        intervention.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        intervention.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                      )}>
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
                            {intervention.goal_target_rating && (' \u2022 Target Rating: ' + intervention.goal_target_rating + '/5')}
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
                            {filteredLogs.sort(function(a, b) { return new Date(b.week_of) - new Date(a.week_of); }).map(function(log) {
                              return (
                                <tr key={log.id} className="border-b">
                                  <td className="py-2 px-3">{new Date(log.week_of + 'T00:00:00').toLocaleDateString()}</td>
                                  <td className="py-2 px-3">
                                    <span className={'px-2 py-0.5 rounded text-xs ' + (
                                      log.status === 'Implemented as Planned' ? 'bg-emerald-100 text-emerald-700' :
                                      log.status === 'Partially Implemented' ? 'bg-amber-100 text-amber-700' :
                                      log.status === 'Student Absent' ? 'bg-gray-100 text-gray-600' :
                                      'bg-rose-100 text-rose-700'
                                    )}>
                                      {log.status}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    {log.rating ? (
                                      <span className={'font-medium ' + (
                                        log.rating >= 4 ? 'text-emerald-600' :
                                        log.rating === 3 ? 'text-amber-600' : 'text-rose-600'
                                      )}>
                                        {log.rating}/5
                                      </span>
                                    ) : '\u2014'}
                                  </td>
                                  <td className="py-2 px-3">{log.response || '\u2014'}</td>
                                  <td className="py-2 px-3 text-gray-600">{log.notes || '\u2014'}</td>
                                </tr>
                              );
                            })}
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

            {(function() {
              var filteredNotes = filterByDateRange(selectedStudent.progress_notes || [], 'meeting_date');
              return filteredNotes.length === 0 ? (
                <p className="text-gray-500 italic">No meeting notes during this period.</p>
              ) : (
                <div className="space-y-4">
                  {filteredNotes.sort(function(a, b) { return new Date(b.meeting_date) - new Date(a.meeting_date); }).map(function(note) {
                    return (
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
                    );
                  })}
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
  );
};

export default ReportModal;