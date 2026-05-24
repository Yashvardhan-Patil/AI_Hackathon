import React, { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LogsPanel from './components/LogsPanel';
import ApiHealth from './components/ApiHealth';
import AnomalyFeed from './components/AnomalyFeed';
import AlertHistory from './components/AlertHistory';
import Settings from './components/Settings';
import Toast from './components/Toast';
import TitleBar from './components/TitleBar';

const SOCKET_URL = 'http://localhost:3001';

const TABS = [
  { id: 'assistant', label: 'Assistant', icon: 'Bot' },
  { id: 'anomalies', label: 'Anomalies', icon: 'AlertTriangle' },
  { id: 'logs', label: 'Logs', icon: 'Terminal' },
  { id: 'health', label: 'API Health', icon: 'Activity' },
  { id: 'history', label: 'Alert History', icon: 'History' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  content: `# 👋 Welcome to API Debugging Copilot!

I'm your AI coding assistant with **direct file access**. Just talk to me naturally — no special commands needed.

## 💬 Things you can say

**Read files & analyze:**
> "Read the file app.js and check for errors"
> "Show me what's in src/index.js"
> "Look at my main.py file"

**Fix bugs:**
> "Fix the bug in server.js"
> "There's an error in my code, help me fix it"
> "Check app.js for issues"

**Create new files:**
> "Create a Python calculator called calc.py"
> "Make a new file called config.json with my settings"

**Run commands:**
> "Run npm test"
> "Execute python main.py"
> "Run the project"

**Open in VSCode:**
> "Open server.js in VSCode"
> "Open the project in VS Code"

**Just ask questions:**
> "Why is my API returning 500 errors?"
> "What's causing this crash?"
> "How do I optimize this query?"

## ✨ No commands needed
Every message goes through an **intent router** that automatically detects what you want to do — read, fix, create, run, or just chat. Speak naturally and things happen.`,
  timestamp: new Date().toISOString(),
  severity: 'info',
  hasFix: false,
  hasRootCause: false,
};

function App() {
  const [activeTab, setActiveTab] = useState('assistant');
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [projectPath, setProjectPath] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  // Chat messages lifted here so they persist across tab switches
  const [chatMessages, setChatMessages] = useState([WELCOME_MESSAGE]);

  // Connect to backend
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    newSocket.on('connect', () => {
      setConnected(true);
      addToast('Connected to backend', 'success');
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      addToast('Disconnected from backend', 'error');
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      setConnected(false);
    });

    newSocket.on('project:selected', (data) => {
      if (data.success) {
        setProjectPath(data.path);
        const folderName = data.path.split(/[/\\]/).pop();

        // Build a chat message that shows the project structure
        const fileTree = data.fileTreeSummary
          ? `\n\n**Project structure:**\n\`\`\`\n${data.fileTreeSummary}\n\`\`\``
          : '';

        const folderMessage = {
          id: `folder-selected-${Date.now()}`,
          role: 'assistant',
          content: `📁 **Project Selected: \`${folderName}\`**\n\nI'm now working inside this folder. You can ask me to read, fix, or create files — I know the full project structure.${fileTree}\n\n**Try saying:**\n> \"List all files\"\n> \"Fix first.py\"\n> \"Read server.js\"\n> \"Create a new API route\"`,
          timestamp: new Date().toISOString(),
          severity: 'info',
          hasFix: false,
          hasRootCause: false,
        };

        // Add the folder selection message to chat
        setChatMessages((prev) => [...prev, folderMessage]);

        if (data.starterFileCreated) {
          addToast(`✅ Created ${data.starterFilePath} with To-Do List app`, 'success');
          // Auto-switch to assistant tab to show the result
          setActiveTab('assistant');
        } else {
          addToast(`Watching: ${folderName}`, 'success');
        }
      }
    });

    newSocket.on('project:deselected', () => {
      setProjectPath(null);
      addToast('Project folder cleared', 'info');
    });

    newSocket.on('project:file-saved', (data) => {
      addToast(`File saved: ${data.relativePath}`, 'success');
    });

    newSocket.on('logs:errors-detected', (data) => {
      addToast(`${data.count} error(s) detected in ${data.fileName}`, 'error');
    });

    newSocket.on('monitor:error', (data) => {
      addToast(`Monitor error: ${data.error}`, 'error');
    });

    newSocket.on('code:fix-result', (data) => {
      if (data.success) {
        addToast(`✅ ${data.message || 'Code fixed!'}`, 'success');
      } else {
        addToast(`❌ Fix failed: ${data.error}`, 'error');
      }
    });

    newSocket.on('code:execute-result', (data) => {
      if (data.success) {
        addToast(`Command executed (exit: ${data.exitCode})`, 'info');
      } else {
        addToast(`Command failed: ${data.error || data.stderr?.slice(0, 80)}`, 'error');
      }
    });

    newSocket.on('code:open-vscode-result', (data) => {
      if (data.success) {
        addToast(data.message, 'success');
      } else {
        addToast(`❌ ${data.error}`, 'error');
      }
    });

    // Auto-fix notifications — show a toast when code is auto-fixed
    newSocket.on('auto-fix:result', (data) => {
      if (data && data.fixes && data.fixes.length > 0) {
        const successFixes = data.fixes.filter(f => f.success);
        if (successFixes.length > 0) {
          const files = successFixes.map(f => f.filePath.split('/').pop()).join(', ');
          addToast(`🔧 Auto-fixed ${files}`, 'success');
        }
        const failedFixes = data.fixes.filter(f => !f.success);
        if (failedFixes.length > 0) {
          const failedFiles = failedFixes.map(f => f.filePath.split('/').pop()).join(', ');
          addToast(`⚠️ Auto-fix failed for ${failedFiles}`, 'error');
        }
      }
    });

    // Anomaly analysis with auto-fix results
    newSocket.on('logs:anomaly-analysis', (data) => {
      if (data && data.autoFixResults && data.autoFixResults.length > 0) {
        const totalFixes = data.autoFixResults.reduce((sum, r) => sum + (r.successCount || 0), 0);
        if (totalFixes > 0) {
          addToast(`🔧 Auto-fixed ${totalFixes} file(s) based on anomaly analysis`, 'success');
        }
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSelectProject = useCallback(async () => {
    if (!socket) return;

    if (window.electronAPI) {
      // Use Electron's native dialog
      const result = await window.electronAPI.selectProjectDialog();
      if (!result.canceled && result.path) {
        socket.emit('project:select', { path: result.path });
      }
    } else {
      // Fallback for browser dev mode
      const path = prompt('Enter the full path to your project folder:');
      if (path && path.trim()) {
        socket.emit('project:select', { path: path.trim() });
      }
    }
  }, [socket]);

  const handleOpenInVSCode = useCallback(async () => {
    if (!projectPath) {
      addToast('No project folder selected', 'warning');
      return;
    }

    if (!connected) {
      addToast('Not connected to backend', 'warning');
      return;
    }

    // Try Electron IPC first, fallback to socket
    if (window.electronAPI) {
      const result = await window.electronAPI.openInVSCode(projectPath);
      if (result.success) {
        addToast(result.message, 'success');
      } else {
        addToast(`❌ ${result.error}`, 'error');
      }
    } else if (socket) {
      socket.emit('code:open-vscode', { targetPath: projectPath });
      addToast('Opening project in VSCode...', 'info');
    } else {
      addToast('Not connected to backend', 'error');
    }
  }, [projectPath, socket, connected]);

  const handleOpenStarterFile = useCallback(() => {
    if (!projectPath) {
      addToast('No project folder selected', 'warning');
      return;
    }
    if (!socket || !connected) {
      addToast('Not connected to backend', 'warning');
      return;
    }
    // Open the starter file in VSCode
    const starterPath = `${projectPath}/example/first.py`;
    if (window.electronAPI) {
      window.electronAPI.openInVSCode(starterPath);
      addToast('Opened example/first.py in VSCode', 'success');
    } else {
      socket.emit('code:open-vscode', { targetPath: starterPath });
      addToast('Opening example/first.py in VSCode...', 'info');
    }
  }, [socket, projectPath, connected]);

  const handleToggleAlwaysOnTop = useCallback(() => {
    const newValue = !isAlwaysOnTop;
    setIsAlwaysOnTop(newValue);
    if (window.electronAPI) {
      window.electronAPI.setAlwaysOnTop(newValue);
    }
  }, [isAlwaysOnTop]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'assistant':
        return (
          <ChatInterface
            socket={socket}
            connected={connected}
            projectPath={projectPath}
            addToast={addToast}
            messages={chatMessages}
            setMessages={setChatMessages}
          />
        );
      case 'anomalies':
        return (
          <AnomalyFeed
            socket={socket}
            connected={connected}
            addToast={addToast}
            isActive={activeTab === 'anomalies'}
          />
        );
      case 'logs':
        return (
          <LogsPanel
            socket={socket}
            connected={connected}
            projectPath={projectPath}
            addToast={addToast}
          />
        );
      case 'health':
        return (
          <ApiHealth
            socket={socket}
            connected={connected}
            addToast={addToast}
            isActive={activeTab === 'health'}
          />
        );
      case 'history':
        return <AlertHistory socket={socket} connected={connected} />;
      case 'settings':
        return (
          <Settings
            socket={socket}
            isAlwaysOnTop={isAlwaysOnTop}
            onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
            addToast={addToast}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-dark-950 overflow-hidden">
      {/* Title Bar */}
      <TitleBar
        connected={connected}
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
      />

      {/* Tab Navigation + Project Selector */}
      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connected={connected}
        projectPath={projectPath}
        onSelectProject={handleSelectProject}
        onOpenInVSCode={handleOpenInVSCode}
        onOpenStarterFile={handleOpenStarterFile}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <div className="h-full overflow-y-auto px-3 py-3">
          <div className="animate-fade-in h-full">
            {renderTabContent()}
          </div>
        </div>
      </main>

      {/* Connection Status Bar */}
      <div className={`px-3 py-1.5 text-[10px] flex items-center gap-2 border-t border-white/5 ${connected ? 'bg-success/5' : 'bg-error/5'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success shadow-sm shadow-success/50' : 'bg-error shadow-sm shadow-error/50'}`} />
        <span className={connected ? 'text-success' : 'text-error'}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        {projectPath && (
          <>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500 truncate max-w-[160px]">
              📁 {projectPath.split(/[/\\]/).pop()}
            </span>
          </>
        )}
      </div>

      {/* Toast Notifications */}
      <div className="absolute top-14 right-3 z-50 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
