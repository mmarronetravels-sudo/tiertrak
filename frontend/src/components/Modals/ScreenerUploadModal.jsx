import { useState, useRef } from 'react';
import Papa from 'papaparse';

const BENCHMARK_COLORS = {
  'At/Above Benchmark':  { bg: '#DCFCE7', text: '#166534', border: '#86EFAC' },
  'Near Benchmark':      { bg: '#FEF9C3', text: '#854D0E', border: '#FDE047' },
  'Below Benchmark':     { bg: '#FFEDD5', text: '#9A3412', border: '#FED7AA' },
  'Urgent Intervention': { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA' },
};

function parseDateToISO(dateStr) {
  if (!dateStr) return null;
  
  // Handle MM/DD/YYYY format
  var slashParts = dateStr.split('/');
  if (slashParts.length === 3) {
    return slashParts[2] + '-' + slashParts[0].padStart(2,'0') + '-' + slashParts[1].padStart(2,'0');
  }
  
  // Handle YY-MM-DD format (e.g. "26-01-22" → "2026-01-22")
  var dashParts = dateStr.split('-');
  if (dashParts.length === 3 && dashParts[0].length === 2) {
    return '20' + dashParts[0] + '-' + dashParts[1].padStart(2,'0') + '-' + dashParts[2].padStart(2,'0');
  }
  
  // Already in YYYY-MM-DD or unknown format, return as-is
  return dateStr;
}

export default function ScreenerUploadModal({ onClose, user, token, API_URL, tenantId, onUploadComplete }) {

  const [step, setStep] = useState('configure');
  const [screeningPeriod, setScreeningPeriod] = useState('Fall');
  const [schoolYear, setSchoolYear] = useState('2025-2026');
  const [subject, setSubject] = useState('Reading');
  const [parsedRows, setParsedRows] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    setError('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        if (!results.data || results.data.length === 0) {
          setError('No data found in CSV file.');
          return;
        }
        var firstRow = results.data[0];
        var required = ['Student', 'Benchmark Category Level'];
        var missing = required.filter(function(c) { return !(c in firstRow); });
        if (missing.length > 0) {
          setError('Missing columns: ' + missing.join(', ') + '. Is this a STAR export?');
          return;
        }
        var rows = results.data.map(function(row) {
  var studentRaw = row['Student'] || '';
  var parts = studentRaw.split(',');
  var lastName  = parts[0] ? parts[0].trim() : '';
  var firstName = parts[1] ? parts[1].trim() : '';
  return {
    firstName:         firstName,
    lastName:          lastName,
    grade:             row['Grade']                    || '',
    screenerName:      'STAR ' + subject,
    subject:           subject,
    testDate:          parseDateToISO(row['Test Date']),
    scaledScore:       row['SS (Star Unified)']        || null,
    percentileRank:    row['PR']                       || null,
    benchmarkCategory: row['Benchmark Category Level'] || '',
  };
});
        rows = rows.filter(function(r) { return r.benchmarkCategory && r.lastName; });
        setParsedRows(rows);
        setStep('preview');
      },
      error: function(err) {
        setError('Failed to parse CSV: ' + err.message);
      }
    });
  }

  async function handleConfirm() {
    setStep('uploading');
    try {
      var res = await fetch(API_URL + '/screener-results/upload', {
  method: 'POST',
  headers: {
  'Content-Type': 'application/json',
},
credentials: 'include',
        body: JSON.stringify({
          tenantId: tenantId,
          screeningPeriod: screeningPeriod,
          schoolYear: schoolYear,
          rows: parsedRows
        })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUploadResult(data);
      setStep('done');
     if (onUploadComplete) onUploadComplete(screeningPeriod, schoolYear, subject);
    } catch (err) {
      setError(err.message);
      setStep('preview');
    }
  }

  function getBenchmarkCounts(rows) {
    var counts = {};
    rows.forEach(function(r) {
      counts[r.benchmarkCategory] = (counts[r.benchmarkCategory] || 0) + 1;
    });
    return counts;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-screen overflow-y-auto">

        <div className="flex justify-between items-center p-6 border-b" style={{background:'#0D4F4F'}}>
          <div>
            <h2 className="text-xl font-bold text-white">Upload Screener Data</h2>
            <p className="text-sm mt-1" style={{color:'#AADDDD'}}>STAR Assessment CSV Import</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl">&times;</button>
        </div>

        <div className="p-6">

          {step === 'configure' && (
            <div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">School Year</label>
                  <select value={schoolYear} onChange={e => setSchoolYear(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option>2025-2026</option>
                    <option>2026-2027</option>
                    <option>2024-2025</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Screening Period</label>
                  <select value={screeningPeriod} onChange={e => setScreeningPeriod(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option>Fall</option>
                    <option>Winter</option>
                    <option>Spring</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <select value={subject} onChange={e => setSubject(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm">
                    <option>Reading</option>
                    <option>Math</option>
                    <option>Early Literacy</option>
                  </select>
                </div>
              </div>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-2">Export from Renaissance STAR, then upload here</p>
                <p className="text-xs text-gray-400 mb-4">Accepts standard STAR CSV export format</p>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
                <button onClick={() => fileRef.current.click()}
                  className="px-4 py-2 rounded text-white text-sm font-medium"
                  style={{background:'#0E7C7B'}}>
                  Choose CSV File
                </button>
              </div>
              {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
            </div>
          )}

          {step === 'preview' && (
            <div>
              <div className="rounded p-4 mb-4" style={{background:'#E8F4F4'}}>
                <p className="font-semibold text-sm" style={{color:'#0D4F4F'}}>
                  {parsedRows.length} students parsed — {screeningPeriod} {schoolYear} {subject}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {Object.entries(getBenchmarkCounts(parsedRows)).map(function([cat, count]) {
                  var colors = BENCHMARK_COLORS[cat] || {bg:'#F3F4F6',text:'#374151',border:'#D1D5DB'};
                  return (
                    <div key={cat} className="rounded p-3 flex justify-between items-center"
                      style={{background:colors.bg, border:'1px solid ' + colors.border}}>
                      <span className="text-xs font-medium" style={{color:colors.text}}>{cat}</span>
                      <span className="text-lg font-bold" style={{color:colors.text}}>{count}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mb-2">Preview (first 5 rows):</p>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{background:'#0D4F4F'}}>
                      {['Name','Grade','Score','Percentile','Benchmark'].map(function(h) {
                        return <th key={h} className="px-2 py-1 text-left text-white font-medium">{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0,5).map(function(row, i) {
                      var colors = BENCHMARK_COLORS[row.benchmarkCategory] || {};
                      return (
                        <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                          <td className="px-2 py-1">{row.firstName} {row.lastName}</td>
                          <td className="px-2 py-1">{row.grade}</td>
                          <td className="px-2 py-1">{row.scaledScore}</td>
                          <td className="px-2 py-1">{row.percentileRank}</td>
                          <td className="px-2 py-1">
                            <span className="rounded px-1 py-0.5 text-xs"
                              style={{background:colors.bg||'#F3F4F6', color:colors.text||'#374151'}}>
                              {row.benchmarkCategory}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {error && <p className="mb-3 text-red-600 text-sm">{error}</p>}
              <div className="flex justify-end gap-3">
                <button onClick={() => setStep('configure')}
                  className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50">
                  Back
                </button>
                <button onClick={handleConfirm}
                  className="px-4 py-2 rounded text-white text-sm font-medium"
                  style={{background:'#0D4F4F'}}>
                  Confirm Import ({parsedRows.length} students)
                </button>
              </div>
            </div>
          )}

          {step === 'uploading' && (
            <div className="text-center py-8">
              <p className="text-gray-600">Saving screener data...</p>
            </div>
          )}

          {step === 'done' && uploadResult && (
            <div>
              <div className="rounded p-4 mb-4" style={{background:'#DCFCE7', border:'1px solid #86EFAC'}}>
                <p className="font-semibold" style={{color:'#166534'}}>
                  ✓ Import complete — {uploadResult.savedCount} records saved
                </p>
                <p className="text-sm mt-1" style={{color:'#166534'}}>
                  {uploadResult.matched} students matched to TierTrak profiles
                </p>
              </div>
              {uploadResult.unmatched && uploadResult.unmatched.length > 0 && (
                <div className="rounded p-4 mb-4" style={{background:'#FEF9C3', border:'1px solid #FDE047'}}>
                  <p className="font-semibold text-sm text-yellow-800">
                    {uploadResult.unmatched.length} students not matched to TierTrak profiles:
                  </p>
                  <p className="text-sm text-yellow-700 mt-1">
                    {uploadResult.unmatched.slice(0,10).join(', ')}
                    {uploadResult.unmatched.length > 10 ? ' ...' : ''}
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    Data was saved. Add these students to TierTrak to link their screener records.
                  </p>
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-white text-sm"
                  style={{background:'#0D4F4F'}}>
                  Done
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}