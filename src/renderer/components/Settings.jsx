import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Key,
  Pin,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  Bell,
  Terminal,
  Info,
} from 'lucide-react';

function Settings({ socket, projectPath, onSelectProject, isAlwaysOnTop, onToggleAlwaysOnTop, addToast }) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [autoFix, setAutoFix] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load saved settings
  useEffect(() => {
    const savedKey = localStorage.getItem('groq_api_key');
    const savedModel = localStorage.getItem('groq_model');
    const savedAutoFix = localStorage.getItem('auto_fix');
    const savedNotifications = localStorage.getItem('notifications');

    if (savedKey) setApiKey(savedKey);
    if (savedModel) setModel(savedModel);
    if (savedAutoFix) setAutoFix(savedAutoFix === 'true');
    if (savedNotifications) setNotifications(savedNotifications === 'true');
  }, []);

  const handleSaveApiKey = async () => {
    setSaving(true);

    try {
      localStorage.setItem('groq_api_key', apiKey);
      localStorage.setItem('groq_model', model);
      localStorage.setItem('auto_fix', autoFix.toString());
      localStorage.setItem('notifications', notifications.toString());

      // Send settings to backend via socket
      if (socket) {
        socket.emit('settings:update', {
          GROQ_API_KEY: apiKey,
          MODEL: model,
          autoFix,
          notifications,
        });
      }

      addToast('Settings saved successfully', 'success');
    } catch {
      addToast('Failed to save settings', 'error');
    } finally {
      setTimeout(() => setSaving(false), 1000);
    }
  };

  const handleClearApiKey = () => {
    setApiKey('');
    localStorage.removeItem('groq_api_key');
    addToast('API key cleared', 'info');
  };

  return (
    <div className="space-y-4 pb-4">
      {/* API Configuration */}
      <div className="glass-panel p-3.5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-accent-500/10 border border-accent-500/20 flex items-center justify-center">
            <Key size={14} className="text-accent-400" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-200">API Configuration</h3>
            <p className="text-[10px] text-gray-500">Groq AI settings</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* API Key */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Groq API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="gsk_..."
                className="input-field pr-16 text-xs font-mono"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
                >
                  {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                {apiKey && (
                  <button
                    onClick={handleClearApiKey}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-error hover:bg-error/10 transition-all"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-gray-600 mt-1">
              Get your API key from{' '}
              <span className="text-accent-400">console.groq.com</span>
            </p>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">AI Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input-field text-xs appearance-none cursor-pointer"
            >
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Fast)</option>
              <option value="llama-3.1-70b-versatile">Llama 3.1 70B (Balanced)</option>
              <option value="mixtral-8x7b-32768">Mixtral 8x7B (Large Context)</option>
              <option value="gemma2-9b-it">Gemma 2 9B (Lightweight)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Behavior */}
      <div className="glass-panel p-3.5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center">
            <Terminal size={14} className="text-warning" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-200">Behavior</h3>
            <p className="text-[10px] text-gray-500">App preferences</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Always on Top */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <Pin size={13} className="text-gray-400" />
              <span className="text-xs text-gray-300">Always on Top</span>
            </div>
            <button
              onClick={onToggleAlwaysOnTop}
              className={`relative w-9 h-5 rounded-full transition-all duration-200 ${
                isAlwaysOnTop ? 'bg-accent-500' : 'bg-dark-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 shadow-sm ${
                  isAlwaysOnTop ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>

          {/* Auto Fix */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <RefreshCw size={13} className="text-gray-400" />
              <span className="text-xs text-gray-300">Auto-fix Simple Issues</span>
            </div>
            <button
              onClick={() => setAutoFix(!autoFix)}
              className={`relative w-9 h-5 rounded-full transition-all duration-200 ${
                autoFix ? 'bg-accent-500' : 'bg-dark-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 shadow-sm ${
                  autoFix ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>

          {/* Notifications */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-gray-400" />
              <span className="text-xs text-gray-300">Error Notifications</span>
            </div>
            <button
              onClick={() => setNotifications(!notifications)}
              className={`relative w-9 h-5 rounded-full transition-all duration-200 ${
                notifications ? 'bg-accent-500' : 'bg-dark-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 shadow-sm ${
                  notifications ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      {/* About */}
      <div className="glass-panel p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-info/10 border border-info/20 flex items-center justify-center">
            <Info size={14} className="text-info" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-200">About</h3>
          </div>
        </div>
        <div className="space-y-1 text-[10px] text-gray-500">
          <p>API Debugging Copilot v1.0.0</p>
          <p>Powered by Groq AI ({model})</p>
          <p>Electron + React + Tailwind CSS</p>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSaveApiKey}
        disabled={saving}
        className={`w-full btn-primary text-xs flex items-center justify-center gap-2 ${
          saving ? 'opacity-75' : ''
        }`}
      >
        {saving ? (
          <>
            <RefreshCw size={14} className="animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save size={14} />
            Save Settings
          </>
        )}
      </button>
    </div>
  );
}

export default Settings;
