import React from 'react';
import { AlertTriangle, Lightbulb, Activity, TrendingUp, Bug, Wrench } from 'lucide-react';

const SEVERITY_CONFIG = {
  critical: {
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: AlertTriangle,
    label: 'Critical',
  },
  high: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    icon: Bug,
    label: 'High',
  },
  medium: {
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    icon: Activity,
    label: 'Medium',
  },
  low: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: TrendingUp,
    label: 'Low',
  },
  info: {
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/20',
    icon: Lightbulb,
    label: 'Info',
  },
};

function AnalysisCard({ severity = 'info', hasFix, hasRootCause, suggestions }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;

  return (
    <div className={`mt-3 rounded-xl border ${config.border} ${config.bg} p-3 space-y-2.5`}>
      {/* Severity Header */}
      <div className="flex items-center gap-2">
        <Icon size={14} className={config.color} />
        <span className={`text-xs font-semibold ${config.color}`}>
          {config.label} Severity
        </span>
        {hasRootCause && (
          <span className="chip-info text-[10px]">Root Cause Found</span>
        )}
        {hasFix && (
          <span className="chip-success text-[10px]">Fix Available</span>
        )}
      </div>

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Wrench size={12} />
            <span>Suggested Actions:</span>
          </div>
          <ul className="space-y-1">
            {suggestions.map((suggestion, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs text-gray-300"
              >
                <span className="text-gray-500 mt-0.5">→</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default AnalysisCard;
