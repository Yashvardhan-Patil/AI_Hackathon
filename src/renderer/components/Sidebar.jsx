import React from 'react';
import { Bot, Terminal, Activity, Settings, AlertTriangle, History, FolderOpen, FileCode, ExternalLink, Code } from 'lucide-react';

const ICON_MAP = {
  Bot: Bot,
  Terminal: Terminal,
  Activity: Activity,
  Settings: Settings,
  AlertTriangle: AlertTriangle,
  History: History,
};

function Sidebar({ tabs, activeTab, onTabChange, connected, projectPath, onSelectProject, onOpenInVSCode, onOpenStarterFile }) {
  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null;

  return (
    <div className="border-b border-white/5">
      {/* Tab Navigation */}
      <nav className="flex items-center gap-1 px-3 py-2 bg-dark-900/50">
        {tabs.map((tab) => {
          const Icon = ICON_MAP[tab.icon];
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-dark-700 text-white shadow-sm border border-white/5'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Project Folder Selector - Always visible below tabs */}
      <div className="px-3 py-2 bg-dark-950/50 border-t border-white/[0.03]">
        <div className="flex items-center gap-2">
          <button
            onClick={onSelectProject}
            disabled={!connected}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
              projectPath
                ? 'bg-success/10 text-success border border-success/20 hover:bg-success/15'
                : 'bg-accent-500/10 text-accent-400 border border-accent-500/20 hover:bg-accent-500/20'
            } ${!connected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={projectPath ? 'Change project folder' : 'Select a project folder'}
          >
            <FolderOpen size={14} />
            <span className="truncate">
              {projectName || 'Select Folder'}
            </span>
          </button>

          {/* Quick actions when project is selected */}
          {projectPath && (
            <div className="flex items-center gap-1">
              <button
                onClick={onOpenInVSCode}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
                title="Open project in VSCode"
              >
                <Code size={14} />
              </button>
              {onOpenStarterFile && (
                <button
                  onClick={onOpenStarterFile}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
                  title="Open starter file (example/first.py)"
                >
                  <FileCode size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Show project path when selected */}
        {projectPath && (
          <div className="mt-1.5 flex items-center gap-1.5 px-1">
            <div className="w-1 h-1 rounded-full bg-success" />
            <span className="text-[10px] text-gray-500 truncate max-w-[260px]">
              {projectPath}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
