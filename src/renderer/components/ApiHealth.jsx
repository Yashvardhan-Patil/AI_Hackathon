import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  Plus,
  Trash2,
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

const DEFAULT_ENDPOINTS = [
  { url: 'http://localhost:3001/health', method: 'GET', name: 'Health Check', path: '/health' },
  { url: 'http://localhost:3001/api/status', method: 'GET', name: 'API Status', path: '/api/status' },
];

function ApiHealth({ socket, connected, addToast, isActive }) {
  const [endpoints, setEndpoints] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [uptime, setUptime] = useState(100);

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
      setUptime(data.uptime || 100);
      setIsRefreshing(false);
    };

    socket.on('health:status', handleHealthStatus);

    // Fetch on mount and when tab becomes active
    if (isActive) {
      fetchHealth();
    }

    return () => {
      socket.off('health:status', handleHealthStatus);
    };
  }, [socket, fetchHealth]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const handleAddEndpoint = () => {
    if (!socket || !addUrl.trim()) return;
    socket.emit('health:add-endpoint', { url: addUrl.trim(), method: 'GET', name: addUrl.trim() });
    setAddUrl('');
    setShowAddForm(false);
    addToast('Endpoint added — will show on next check', 'info');
  };

  const handleRemoveEndpoint = (url) => {
    if (!socket) return;
    socket.emit('health:remove-endpoint', { url });
    addToast('Endpoint removed', 'info');
  };

  const getLatencyColor = (latency) => {
    if (!latency || latency === 'N/A') return 'text-gray-500';
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

      {/* Controls */}
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
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-accent-400 hover:bg-accent-500/10 transition-all"
            title="Add endpoint"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Add Endpoint Form */}
      {showAddForm && (
        <div className="flex items-center gap-2 p-2 glass-panel">
          <input
            type="text"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="http://localhost:3000/health"
            className="flex-1 px-2.5 py-1.5 bg-dark-800 border border-white/5 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500/50"
            onKeyDown={(e) => e.key === 'Enter' && handleAddEndpoint()}
          />
          <button
            onClick={handleAddEndpoint}
            disabled={!addUrl.trim()}
            className="px-2.5 py-1.5 text-xs font-medium text-white bg-accent-500 rounded-lg hover:bg-accent-600 transition-all disabled:opacity-30"
          >
            Add
          </button>
        </div>
      )}

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
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold flex-shrink-0 ${
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
                  {ep.path || ep.name}
                </span>

                {/* Latency */}
                <div className="flex items-center gap-1">
                  <Clock size={10} className="text-gray-600" />
                  <span className={`text-[10px] font-mono ${getLatencyColor(ep.latency)}`}>
                    {ep.latency || 'N/A'}
                  </span>
                </div>

                {/* Uptime */}
                {ep.uptime !== undefined && (
                  <span className={`text-[10px] font-mono ${ep.uptime >= 95 ? 'text-success' : ep.uptime >= 80 ? 'text-warning' : 'text-error'}`}>
                    {ep.uptime}%
                  </span>
                )}

                {/* Status */}
                <div className="flex items-center gap-1">
                  <Icon size={12} className={config.color} />
                  <span className={`text-[10px] ${config.color}`}>
                    {config.label}
                  </span>
                </div>

                {/* Remove Button */}
                <button
                  onClick={() => handleRemoveEndpoint(ep.url || ep.path)}
                  className="p-1 rounded text-gray-600 hover:text-error hover:bg-error/10 transition-all opacity-0 group-hover:opacity-100"
                  title="Remove endpoint"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ApiHealth;
