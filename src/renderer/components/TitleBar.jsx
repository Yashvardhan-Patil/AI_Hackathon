import React from 'react';
import { Bot, Pin, Minus, Square, X } from 'lucide-react';

function TitleBar({ connected, isAlwaysOnTop, onToggleAlwaysOnTop }) {
  const handleMinimize = () => {
    if (window.electronAPI) window.electronAPI.minimize();
  };

  const handleMaximize = () => {
    if (window.electronAPI) window.electronAPI.maximize();
  };

  const handleClose = () => {
    if (window.electronAPI) window.electronAPI.close();
  };

  return (
    <div className="drag-region h-11 flex items-center justify-between px-3 bg-dark-900/80 backdrop-blur-md border-b border-white/5">
      {/* App Icon + Title */}
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center">
          <Bot size={14} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-gray-200 tracking-wide">
          API Copilot
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-error'}`} />
      </div>

      {/* Window Controls */}
      <div className="no-drag flex items-center gap-1">
        <button
          onClick={onToggleAlwaysOnTop}
          className={`p-1.5 rounded-lg transition-all duration-150 ${
            isAlwaysOnTop
              ? 'bg-accent-500/20 text-accent-400'
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
          title={isAlwaysOnTop ? 'Disable always on top' : 'Enable always on top'}
        >
          <Pin size={13} className={isAlwaysOnTop ? 'fill-accent-400' : ''} />
        </button>
        <button
          onClick={handleMinimize}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all duration-150"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all duration-150"
        >
          <Square size={11} />
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg text-gray-500 hover:text-error hover:bg-error/10 transition-all duration-150"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
