import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  AlertOctagon,
  ChevronDown,
  ChevronRight,
  Server,
  Shield,
} from 'lucide-react';

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertOctagon,
    color: 'text-error',
    bg: 'bg-error/5',
    border: 'border-error/20',
    badge: 'chip-error',
    label: 'Critical',
  },
  high: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    badge: 'chip-warning',
    label: 'High',
  },
  medium: {
    icon: Activity,
    color: 'text-accent-400',
    bg: 'bg-accent-500/5',
    border: 'border-accent-500/20',
    badge: 'chip-info',
    label: 'Medium',
  },
  low: {
    icon: Shield,
    color: 'text-gray-400',
    bg: 'bg-gray-500/5',
    border: 'border-gray-500/20',
    badge: 'chip text-gray-400 bg-gray-500/10',
    label: 'Low',
  },
};

const TYPE_LABELS = {
  latency_spike: 'Latency Spike',
  error_rate_surge: 'Error Rate Surge',
  recurring_error: 'Recurring Error',
  silent_failure: 'Silent Failure',
  server_error_cluster: '5xx Cluster',
  client_error_cluster: '4xx Cluster',
  endpoint_down: 'Endpoint Down',
  endpoint_degraded: 'Endpoint Degraded',
  request_failure: 'Request Failure',
};

const TYPE_ICONS = {
  latency_spike: Clock,
  error_rate_surge: Zap,
  recurring_error: AlertOctagon,
  silent_failure: XCircle,
  server_error_cluster: Server,
  client_error_cluster: AlertTriangle,
  endpoint_down: XCircle,
  endpoint_degraded: Activity,
};

function AnomalyFeed({ socket, connected, addToast, isActive }) {
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
  const [expandedAlerts, setExpandedAlerts] = useState({});
  const [filter, setFilter] = useState('all');
  const [aiAnalyses, setAiAnalyses] = useState({});

  // Socket listeners — registered on mount, cleaned up on unmount
  // This prevents duplicate listeners from accumulating when switching tabs
  useEffect(() => {
    if (!socket) return;

    const handleState = (data) => {
      setAlerts(data.alerts || []);
      setSummary({
        total: data.total || 0,
        critical: data.critical || 0,
        high: data.high || 0,
        medium: data.medium || 0,
        low: data.low || 0,
      });
    };

    const handleNew = (data) => {
      addToast(
        data.alert ? data.alert.message || data.summary || 'Anomaly detected' :
        `${data.count} anomaly(ies) detected${data.criticalCount > 0 ? ` (${data.criticalCount} critical)` : ''}`,
        data.alert?.severity || (data.criticalCount > 0 ? 'error' : 'warning')
      );
      // Fetch current state when a new anomaly arrives
      if (data.alert) {
        socket.emit('alerts:get-active');
      }
    };

    const handleAiAnalysis = (data) => {
      if (data.alertId && data.analysis) {
        setAiAnalyses(prev => ({
          ...prev,
          [data.alertId]: data.analysis,
        }));
      }
    };

    socket.on('alerts:state', handleState);
    socket.on('anomaly:new', handleNew);
    socket.on('anomaly:ai-analysis', handleAiAnalysis);

    // Initial fetch
    socket.emit('alerts:get-active');

    return () => {
      socket.off('alerts:state', handleState);
      socket.off('anomaly:new', handleNew);
      socket.off('anomaly:ai-analysis', handleAiAnalysis);
    };
  }, [socket, addToast]);

  // Re-fetch data whenever this tab becomes active (catches up on missed updates)
  useEffect(() => {
    if (!socket || !isActive) return;
    socket.emit('alerts:get-active');
  }, [socket, isActive]);

  const handleResolve = useCallback((alertId) => {
    if (!socket) return;
    socket.emit('alerts:resolve', { alertId });
    addToast('Alert resolved', 'success');
  }, [socket, addToast]);

  const handleResolveAll = useCallback(() => {
    if (!socket) return;
    // Resolve each alert
    alerts.forEach(alert => {
      socket.emit('alerts:resolve', { alertId: alert.id });
    });
    addToast('All alerts resolved', 'success');
  }, [socket, alerts, addToast]);

  const toggleExpand = (id) => {
    setExpandedAlerts(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getFilteredAlerts = () => {
    if (filter === 'all') return alerts;
    return alerts.filter(a => a.severity === filter);
  };

  const SeverityIcon = ({ severity }) => {
    const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;
    const Icon = config.icon;
    return <Icon size={14} className={config.color} />;
  };

  const filteredAlerts = getFilteredAlerts();

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Header Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="glass-panel p-2.5 text-center">
          <div className="text-lg font-bold text-white">{summary.total}</div>
          <div className="text-[10px] text-gray-500">Total</div>
        </div>
        <div className="glass-panel p-2.5 text-center">
          <div className="text-lg font-bold text-error">{summary.critical}</div>
          <div className="text-[10px] text-gray-500">Critical</div>
        </div>
        <div className="glass-panel p-2.5 text-center">
          <div className="text-lg font-bold text-warning">{summary.high}</div>
          <div className="text-[10px] text-gray-500">High</div>
        </div>
        <div className="glass-panel p-2.5 text-center">
          <div className="text-lg font-bold text-accent-400">{summary.medium}</div>
          <div className="text-[10px] text-gray-500">Medium</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-dark-800 rounded-lg p-0.5 border border-white/5">
          {['all', 'critical', 'high', 'medium', 'low'].map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                filter === level
                  ? level === 'critical' ? 'bg-error/20 text-error' :
                    level === 'high' ? 'bg-warning/20 text-warning' :
                    level === 'medium' ? 'bg-accent-500/20 text-accent-400' :
                    level === 'low' ? 'bg-gray-500/20 text-gray-300' :
                    'bg-dark-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {level} {level !== 'all' && summary[level] > 0 && `(${summary[level]})`}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={handleResolveAll}
          disabled={alerts.length === 0}
          className="px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-dark-800 border border-white/5 rounded-lg hover:bg-dark-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Resolve All
        </button>
      </div>

      {/* Alert List */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Shield size={32} className="text-success mb-3" />
            <p className="text-sm text-gray-400 font-medium">No active alerts</p>
            <p className="text-xs text-gray-600 mt-1">
              {connected ? 'Everything looks healthy!' : 'Connect to backend to start monitoring'}
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const severityConfig = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.low;
            const TypeIcon = TYPE_ICONS[alert.type] || AlertTriangle;
            const isExpanded = expandedAlerts[alert.id];
            const aiAnalysis = aiAnalyses[alert.id];
            const duration = alert.duration || Math.round((Date.now() - (alert.firstSeen || Date.now())) / 1000);
            const durationStr = duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`;

            return (
              <div
                key={alert.id}
                className={`group rounded-xl border ${severityConfig.border} ${severityConfig.bg} hover:bg-white/[0.02] transition-all overflow-hidden`}
              >
                {/* Alert Header */}
                <div
                  className="flex items-center gap-2.5 p-3 cursor-pointer"
                  onClick={() => toggleExpand(alert.id)}
                >
                  <TypeIcon size={16} className={severityConfig.color} />
                  <SeverityIcon severity={alert.severity} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${severityConfig.color}`}>
                        {severityConfig.label}
                      </span>
                      <span className="text-[10px] text-gray-500 bg-dark-800 px-1.5 py-0.5 rounded font-mono">
                        {TYPE_LABELS[alert.type] || alert.type}
                      </span>
                      {alert.count > 1 && (
                        <span className="text-[10px] text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded font-mono">
                          ×{alert.count}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-300 mt-0.5 truncate">
                      {alert.endpoint && <span className="text-gray-500 font-mono">{alert.endpoint} — </span>}
                      {(alert.message || '').substring(0, 120)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-600 flex items-center gap-1">
                      <Clock size={9} />
                      {durationStr}
                    </span>

                    {/* AI Analysis Indicator */}
                    {aiAnalysis && (
                      <span className="text-[10px] text-info bg-info/10 px-1.5 py-0.5 rounded" title="AI analysis available">
                        AI
                      </span>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); handleResolve(alert.id); }}
                      className="p-1 rounded text-gray-500 hover:text-success hover:bg-success/10 transition-all opacity-0 group-hover:opacity-100"
                      title="Resolve alert"
                    >
                      <CheckCircle size={12} />
                    </button>
                    {isExpanded ? <ChevronDown size={14} className="text-gray-600" /> : <ChevronRight size={14} className="text-gray-600" />}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 space-y-2 border-t border-white/5">
                    {/* Full Message */}
                    <div className="mt-2 p-2 bg-dark-900/50 rounded-lg">
                      <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-all">
                        {alert.message}
                      </pre>
                    </div>

                    {/* Metadata */}
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {alert.endpoint && (
                        <span className="text-gray-500 bg-dark-800 px-1.5 py-0.5 rounded">
                          Endpoint: <span className="text-gray-300 font-mono">{alert.endpoint}</span>
                        </span>
                      )}
                      {alert.count && (
                        <span className="text-gray-500 bg-dark-800 px-1.5 py-0.5 rounded">
                          Occurrences: <span className="text-gray-300">{alert.count}</span>
                        </span>
                      )}
                      {alert.lastSeen && (
                        <span className="text-gray-500 bg-dark-800 px-1.5 py-0.5 rounded">
                          Last: <span className="text-gray-300">{new Date(alert.lastSeen).toLocaleTimeString()}</span>
                        </span>
                      )}
                      {alert.tags && alert.tags.map((tag, i) => (
                        <span key={i} className="text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* AI Analysis */}
                    {aiAnalysis && (
                      <div className="p-2.5 bg-dark-900/50 border border-info/10 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Activity size={11} className="text-info" />
                          <span className="text-[10px] text-info uppercase tracking-wider">AI Root Cause Analysis</span>
                        </div>

                        {aiAnalysis.rootCause && (
                          <div className="mb-1.5">
                            <span className="text-[10px] text-gray-500">Root Cause:</span>
                            <p className="text-xs text-gray-300 mt-0.5">{aiAnalysis.rootCause}</p>
                          </div>
                        )}

                        {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                          <div>
                            <span className="text-[10px] text-gray-500">Recommendations:</span>
                            <ul className="mt-0.5 space-y-0.5">
                              {aiAnalysis.recommendations.slice(0, 4).map((rec, i) => (
                                <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                                  <span className="text-success mt-0.5">→</span>
                                  {rec}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {aiAnalysis.aiAnalysis && aiAnalysis.aiAnalysis.content && (
                          <div className="mt-1.5 pt-1.5 border-t border-white/5">
                            <span className="text-[10px] text-gray-500">AI Response:</span>
                            <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                              {aiAnalysis.aiAnalysis.content.substring(0, 400)}
                              {aiAnalysis.aiAnalysis.content.length > 400 ? '...' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleResolve(alert.id)}
                        className="px-2.5 py-1 text-[10px] font-medium text-success bg-success/10 rounded-lg hover:bg-success/20 transition-all"
                      >
                        <CheckCircle size={10} className="inline mr-1" />
                        Resolve
                      </button>
                      {alert.endpoint && (
                        <button
                          onClick={() => socket?.emit('alerts:resolve-endpoint', { endpoint: alert.endpoint })}
                          className="px-2.5 py-1 text-[10px] font-medium text-gray-400 bg-dark-800 rounded-lg hover:bg-dark-700 transition-all"
                        >
                          Resolve all for {alert.endpoint}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AnomalyFeed;
