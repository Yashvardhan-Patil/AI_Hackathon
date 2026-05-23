import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react';

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle,
    bg: 'bg-success/10',
    border: 'border-success/20',
    color: 'text-success',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-error/10',
    border: 'border-error/20',
    color: 'text-error',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-warning/10',
    border: 'border-warning/20',
    color: 'text-warning',
  },
  info: {
    icon: Info,
    bg: 'bg-info/10',
    border: 'border-info/20',
    color: 'text-info',
  },
};

function Toast({ message, type = 'info', onDismiss }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border ${config.border} ${config.bg} backdrop-blur-md shadow-lg transition-all duration-300 max-w-[280px] ${
        isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
      }`}
    >
      <Icon size={14} className={`${config.color} flex-shrink-0`} />
      <p className="text-xs text-gray-300 flex-1">{message}</p>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all flex-shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default Toast;
