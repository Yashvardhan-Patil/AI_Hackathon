import React, { useState, useEffect } from 'react';
import {
  History,
  CheckCircle,
  Clock,
  Filter,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  AlertOctagon,
  AlertTriangle,
  Activity,
  Shield,
  RefreshCw,
} from 'lucide-react';

const SEVERITY_CONFIG = {
  critical: { icon: AlertOctagon, color: 'text-error', bg: 'bg-error/5', label: 'Critical' },
  high: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/5', label: 'High' },
  medium: { icon: Activity, color: 'text-accent-400', bg: 'bg-accent-500/5', label: 'Medium' },
  low: { icon: Shield, color: 'text-gray-400', bg: 'bg-gray-500/5', label: 'Low' },
};

function AlertHistory({ socket, connected }) {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const fetchHistory = () => {
    if (!socket) return;
    setIsLoading(true);
    socket.emit('alerts:get-history', { limit: 100 });
  };

  useEffect(() => {
    if (!socket) return;

    fetchHistory();

    const handleHistory = (data) => {
      setHistory(data.alerts || []);
    };

    socket.on('alerts:history', (data) => {
      setHistory(data.alerts || []);
      setIsLoading(false);
    });

    // Refresh when alerts are resolved
    socket.on('alerts:resolved', () => {
      fetchHistory();
    });

    return () => {
      socket.off('alerts:history');
      socket.off('alerts:resolved');
    };
  }, [socket]);

  const filteredHistory = history.filter((alert) => {
    if (filter !== 'all' && alert.severity !== filter) return false;
    if (searchQuery) {
      const msg = (alert.message || '').toLowerCase();
      const endpoint = (alert.endpoint || '').toLowerCase();
      const q = searchQuery.toLowerCase();
      return msg.includes(q) || endpoint.includes(q);
    }
    return true;
  });

  const formatDuration = (seconds) => {
    if (!seconds) return 'N/A';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const toggleExpand = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const stats = {
    total: history.length,
    critical: history.filter(a => a.severity === 'critical').length,
    high: history.filter(a => a.severity === 'high').length,
    medium: history.filter(a => a.severity === 'medium').length,
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Stats Bar */}
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-gray-500">Total: <span className="text-white font-medium">{stats.total}</span></span>
        {stats.critical > 0 && <span className="text-error">Critical: {stats.critical}</span>}
        {stats.high > 0 && <span className="text-warning">High: {stats.high}</span>}
        {stats.medium > 0 && <span className="text-accent-400">Medium: {stats.medium}</span>}
        <button
          onClick={fetchHistory}
          disabled={isLoading}
          className={`ml-auto p-1.5 rounded-lg transition-all ${
            isLoading ? 'text-accent-400 animate-spin' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
          title="Refresh history"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-dark-800 rounded-lg p-0.5 border border-white/5">
          {['all', 'critical', 'high', 'medium'].map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                filter === level
                  ? level === 'critical' ? 'bg-error/20 text-error' :
                    level === 'high' ? 'bg-warning/20 text-warning' :
                    level === 'medium' ? 'bg-accent-500/20 text-accent-400' :
                    'bg-dark-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <div className="flex-1 relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full pl-7 pr-7 py-1.5 bg-dark-800 border border-white/5 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500/50 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <History size={28} className="text-gray-600 mb-2" />
            <p className="text-sm text-gray-500">No alert history</p>
            <p className="text-xs text-gray-600 mt-1">Resolved alerts will appear here</p>
          </div>
        ) : (
          filteredHistory.map((alert) => {
            const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.low;
            const Icon = config.icon;
            const isExpanded = expanded[alert.id];

            return (
              <div
                key={alert.id}
                className={`rounded-xl border ${config.bg} border-white/5 hover:bg-white/[0.02] transition-all overflow-hidden`}
              >
                <div
                  className="flex items-center gap-2.5 p-2.5 cursor-pointer"
                  onClick={() => toggleExpand(alert.id)}
                >
                  <CheckCircle size={13} className="text-success flex-shrink-0" />
                  <Icon size={13} className={`${config.color} flex-shrink-0`} />

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">
                      {alert.endpoint && <span className="text-gray-500 font-mono">{alert.endpoint} — </span>}
                      {(alert.message || '').substring(0, 100)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    {alert.count > 1 && <span className="font-mono">×{alert.count}</span>}
                    <span className="flex items-center gap-1">
                      <Clock size={9} />
                      {formatDuration(alert.duration)}
                    </span>
                    {alert.resolvedAt && (
                      <span>{new Date(alert.resolvedAt).toLocaleTimeString()}</span>
                    )}
                  </div>

                  {isExpanded ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
                </div>

                {isExpanded && (
                  <div className="px-3 pb-2.5 pt-0 space-y-1.5 border-t border-white/5">
                    <p className="text-xs text-gray-400 mt-1.5">{alert.message}</p>
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="text-gray-500">Status: <span className="text-success">Resolved ✓</span></span>
                      {alert.endpoint && <span className="text-gray-500">Endpoint: <span className="text-gray-300 font-mono">{alert.endpoint}</span></span>}
                      {alert.count && <span className="text-gray-500">Count: <span className="text-gray-300">{alert.count}</span></span>}
                      {alert.duration && <span className="text-gray-500">Duration: <span className="text-gray-300">{formatDuration(alert.duration)}</span></span>}
                      {alert.firstSeen && <span className="text-gray-500">Started: <span className="text-gray-300">{new Date(alert.firstSeen).toLocaleString()}</span></span>}
                      {alert.resolvedAt && <span className="text-gray-500">Resolved: <span className="text-gray-300">{new Date(alert.resolvedAt).toLocaleString()}</span></span>}
                      {alert.tags && alert.tags.map((tag, i) => (
                        <span key={i} className="text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
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

export default AlertHistory;
