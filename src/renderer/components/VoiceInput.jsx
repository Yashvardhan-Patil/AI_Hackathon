import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';

function VoiceInput({ isActive, onToggle, onResult, disabled }) {
  const recognitionRef = useRef(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if Web Speech API is available
    setIsSupported(
      'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
    );
  }, []);

  useEffect(() => {
    if (!isActive || !isSupported) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
      onToggle();
    };

    recognition.onerror = () => {
      onToggle();
    };

    recognition.onend = () => {
      if (isActive) onToggle();
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      onToggle();
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, [isActive, isSupported, onResult, onToggle]);

  if (!isSupported) return null;

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-all duration-150 ${
        isActive
          ? 'text-error bg-error/10 animate-pulse'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      title={isActive ? 'Stop recording' : 'Voice input'}
    >
      {isActive ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  );
}

export default VoiceInput;
