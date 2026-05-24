import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  FileText,
  Search,
  Filter,
  AlertTriangle,
  X,
  RefreshCw,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Download,
} from 'lucide-react';

function LogsPanel({ socket, connected, projectPath, addToast, isActive }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logFiles, setLogFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState({});
  const logsEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Socket listeners for real-time logs — registered on mount, cleaned up on unmount
  useEffect(() => {
    if (!socket) return;

    const handleLogsUpdated = (data) => {
      setLogs((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          timestamp: data.timestamp,
          file: data.fileName,
          type: 'info',
          message: `Log file updated: ${data.fileName}`,
          stats: data.stats,
        },
      ]);
    };

    const handleErrorsDetected = (data) => {
      const newErrors = data.errors.map((err) => ({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: data.timestamp,
        file: data.fileName,
        type: 'error',
        message: err.content,
        statusCode: err.statusCode,
        lineNumber: err.lineNumber,
      }));

      setLogs((prev) => [...newErrors, ...prev]);

      addToast(`${data.count} error(s) in ${data.fileName}`, 'error');
    };

    socket.on('logs:updated', handleLogsUpdated);
    socket.on('logs:errors-detected', handleErrorsDetected);

    return () => {
      socket.off('logs:updated', handleLogsUpdated);
      socket.off('logs:errors-detected', handleErrorsDetected);
    };
  }, [socket, addToast]);

  // Scan for log files when project is selected — single shot, no listener leak
  useEffect(() => {
    if (!socket || !projectPath) return;

    socket.emit('project:scan-logs', { path: projectPath });

    const handleLogFiles = (data) => {
      if (data.files) {
        setLogFiles(data.files);
      }
    };

    socket.on('project:log-files', handleLogFiles);

    return () => {
      socket.off('project:log-files', handleLogFiles);
    };
  }, [socket, projectPath]);

  // Re-scan logs when tab becomes active
  useEffect(() => {
    if (!socket || !projectPath || !isActive) return;
    socket.emit('project:scan-logs', { path: projectPath });
  }, [socket, projectPath, isActive]);

  const handleFileSelect = (filePath) => {
    if (!socket) return;
    socket.emit('logs:read-file', { filePath });
    socket.once('logs:file-content', (data) => {
      if (data.entries) {
        setSelectedFile(filePath);
        const formattedLogs = data.entries.map((entry) => ({
          id: `${filePath}-${entry.lineNumber}`,
          timestamp: entry.timestamp,
          file: data.fileName,
          type: entry.type,
          message: entry.content,
          level: entry.level,
          statusCode: entry.statusCode,
          lineNumber: entry.lineNumber,
          hasStackTrace: entry.hasStackTrace,
        }));
        setLogs(formattedLogs);
        addToast(`Loaded ${formattedLogs.length} log entries`, 'info');
      }
    });
  };

  const filteredLogs = logs.filter((log) => {
    // Filter by type
    if (filter === 'errors') return log.type === 'error';
    if (filter === 'warnings') return log.type === 'warning';
    if (filter === 'info') return log.type === 'info';

    // Search query
    if (searchQuery) {
      return log.message.toLowerCase().includes(searchQuery.toLowerCase());
    }

    return true;
  });

  const toggleErrorExpand = (id) => {
    setExpandedErrors((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getLevelBadge = (level) => {
    const colors = {
      ERROR: 'chip-error',
      WARN: 'chip-warning',
      INFO: 'chip-info',
      DEBUG: 'chip text-gray-500 bg-gray-500/10',
      FATAL: 'chip-error',
    };
    return colors[level] || 'chip-info';
  };

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isNearBottom) setAutoScroll(false);
    else setAutoScroll(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-dark-800 rounded-lg p-0.5 border border-white/5">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              filter === 'all' ? 'bg-dark-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('errors')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              filter === 'errors' ? 'bg-error/20 text-error' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Errors
          </button>
          <button
            onClick={() => setFilter('warnings')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              filter === 'warnings' ? 'bg-warning/20 text-warning' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Warnings
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="w-full pl-7 pr-7 py-1.5 bg-dark-800 border border-white/5 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500/50 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`p-1.5 rounded-lg transition-all ${
            autoScroll ? 'bg-accent-500/20 text-accent-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
          title="Auto-scroll"
        >
          <ChevronDown size={14} />
        </button>

        <button
          onClick={() => setLogs([])}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
          title="Clear logs"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Log Files */}
      {logFiles.length > 0 && (
        <div className="mb-2 p-2 glass-panel">
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
            <FileText size={10} />
            Log Files
          </div>
          <div className="flex flex-wrap gap-1">
            {logFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => handleFileSelect(file.path)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  selectedFile === file.path
                    ? 'bg-accent-500/20 text-accent-400 border border-accent-500/20'
                    : 'bg-dark-700 text-gray-400 hover:text-gray-200 border border-white/5'
                }`}
              >
                {file.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Logs List */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-0.5 font-mono"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Terminal size={24} className="text-gray-600 mb-2" />
            <p className="text-sm text-gray-500">No logs yet</p>
            <p className="text-xs text-gray-600 mt-1">
              {projectPath
                ? 'Select a log file above to view its contents'
                : 'Select a project folder to start monitoring logs'}
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`group flex items-start gap-2 px-2 py-1 rounded-md hover:bg-white/[0.02] transition-colors ${
                log.type === 'error'
                  ? 'border-l-2 border-error/50'
                  : log.type === 'warning'
                  ? 'border-l-2 border-warning/50'
                  : 'border-l-2 border-transparent'
              }`}
            >
              {/* Level Badge */}
              {log.level && (
                <span className={`${getLevelBadge(log.level)} text-[9px] px-1 py-0 flex-shrink-0 mt-0.5`}>
                  {log.level}
                </span>
              )}

              {/* Timestamp */}
              {log.timestamp && (
                <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              )}

              {/* Message */}
              <div className="flex-1 min-w-0">
                <div
                  className={`text-xs cursor-pointer ${
                    log.type === 'error'
                      ? 'text-error'
                      : log.type === 'warning'
                      ? 'text-warning'
                      : 'text-gray-400'
                  }`}
                  onClick={() => log.hasStackTrace && toggleErrorExpand(log.id)}
                >
                  <span className="truncate block">
                    {log.message}
                  </span>
                </div>

                {/* Expanded Stack Trace */}
                {expandedErrors[log.id] && log.hasStackTrace && (
                  <pre className="mt-1 text-[10px] text-gray-500 bg-dark-900/50 p-2 rounded-lg overflow-x-auto">
                    {log.message}
                  </pre>
                )}
              </div>

              {/* Status Code */}
              {log.statusCode && (
                <span className={`text-[10px] font-mono flex-shrink-0 mt-0.5 ${
                  log.statusCode >= 500 ? 'text-error' : 'text-warning'
                }`}>
                  {log.statusCode}
                </span>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredLogs.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-dark-700 border border-white/5 rounded-full text-xs text-gray-400 hover:text-white hover:bg-dark-600 transition-all shadow-lg"
        >
          New logs below ↓
        </button>
      )}
    </div>
  );
}

export default LogsPanel;
