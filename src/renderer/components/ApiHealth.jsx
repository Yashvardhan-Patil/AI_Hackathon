import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react';

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle,
    color: 'text-success',
    bg: 'bg-success/5',
    border: 'border-success/20',
    label: 'Healthy',
  },
  degraded: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    label: 'Degraded',
  },
  down: {
    icon: XCircle,
    color: 'text-error',
    bg: 'bg-error/5',
    border: 'border-error/20',
    label: 'Down',
  },
};

function ApiHealth({ socket, connected }) {
  const [endpoints, setEndpoints] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchHealth = useCallback(() => {
    if (!socket) return;
    setIsRefreshing(true);
    socket.emit('health:check');
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleHealthStatus = (data) => {
      setEndpoints(data.monitoredEndpoints || []);
      setLastUpdated(data.timestamp);
      setIsRefreshing(false);
    };

    socket.on('health:status', handleHealthStatus);

    // Initial fetch
    fetchHealth();

    return () => {
      socket.off('health:status', handleHealthStatus);
    };
  }, [socket, fetchHealth]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const getLatencyColor = (latency) => {
    const ms = parseInt(latency);
    if (ms < 100) return 'text-success';
    if (ms < 300) return 'text-warning';
    return 'text-error';
  };

  const stats = {
    total: endpoints.length,
    healthy: endpoints.filter((e) => e.status === 'healthy').length,
    degraded: endpoints.filter((e) => e.status === 'degraded').length,
    down: endpoints.filter((e) => e.status === 'down').length,
  };

  const uptime = stats.total > 0
    ? Math.round(((stats.healthy + stats.degraded * 0.5) / stats.total) * 100)
    : 100;

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-panel p-3">
          <div className="flex items-center gap-2 mb-1">
            <Server size={14} className="text-gray-400" />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Uptime</span>
          </div>
          <div className="text-2xl font-bold text-gradient">
            {uptime}%
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-gray-500">{stats.healthy} healthy</span>
            {stats.degraded > 0 && (
              <span className="text-[10px] text-warning">{stats.degraded} degraded</span>
            )}
            {stats.down > 0 && (
              <span className="text-[10px] text-error">{stats.down} down</span>
            )}
          </div>
        </div>

        <div className="glass-panel p-3">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} className="text-gray-400" />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Endpoints</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.total}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="chip-success text-[10px]">{stats.healthy} OK</span>
            {stats.degraded > 0 && (
              <span className="chip-warning text-[10px]">{stats.degraded} Slow</span>
            )}
            {stats.down > 0 && (
              <span className="chip-error text-[10px]">{stats.down} Down</span>
            )}
          </div>
        </div>
      </div>

      {/* Endpoint List */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-gray-300">Monitored Endpoints</h3>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-gray-600">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchHealth}
            disabled={isRefreshing}
            className={`p-1.5 rounded-lg transition-all ${
              isRefreshing
                ? 'text-accent-400 animate-spin'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Endpoints */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Activity size={24} className="text-gray-600 mb-2" />
            <p className="text-sm text-gray-500">No endpoints monitored</p>
            <p className="text-xs text-gray-600 mt-1">
              {connected ? 'Waiting for data...' : 'Connect to backend'}
            </p>
          </div>
        ) : (
          endpoints.map((ep, idx) => {
            const config = STATUS_CONFIG[ep.status] || STATUS_CONFIG.healthy;
            const Icon = config.icon;

            return (
              <div
                key={idx}
                className={`group flex items-center gap-3 p-2.5 rounded-xl border ${config.border} ${config.bg} hover:bg-white/[0.02] transition-all`}
              >
                {/* Method Badge */}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                  ep.method === 'GET' ? 'text-success bg-success/10' :
                  ep.method === 'POST' ? 'text-info bg-info/10' :
                  ep.method === 'PUT' ? 'text-warning bg-warning/10' :
                  ep.method === 'DELETE' ? 'text-error bg-error/10' :
                  'text-gray-400 bg-gray-500/10'
                }`}>
                  {ep.method}
                </span>

                {/* Path */}
                <span className="flex-1 text-xs text-gray-300 font-mono truncate">
                  {ep.path}
                </span>

                {/* Latency */}
                <div className="flex items-center gap-1">
                  <Clock size={10} className="text-gray-600" />
                  <span className={`text-[10px] font-mono ${getLatencyColor(ep.latency)}`}>
                    {ep.latency}
                  </span>
                </div>

                {/* Status */}
                <div className="flex items-center gap-1">
                  <Icon size={12} className={config.color} />
                  <span className={`text-[10px] ${config.color}`}>
                    {config.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ApiHealth;
