import { CheckCircle } from 'lucide-react';

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

export default FERPABadge;