import React, { useState, useRef, useEffect } from 'react';
import { Send, Copy, Check, FileCode, Terminal, ExternalLink, RefreshCw } from 'lucide-react';
import MessageBubble from './MessageBubble';
import AnalysisCard from './AnalysisCard';
import VoiceInput from './VoiceInput';

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

function ChatInterface({ socket, connected, projectPath, addToast }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Socket event listeners — ONLY chat events, no command-specific listeners
  useEffect(() => {
    if (!socket) return;

    const handleResponse = (data) => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: data.id || Date.now().toString(),
          role: 'assistant',
          content: data.content || 'No response',
          timestamp: data.timestamp,
          severity: data.severity,
          hasFix: data.hasFix,
          hasRootCause: data.hasRootCause,
          suggestions: data.suggestions,
          actionType: data.actionType,
          filePath: data.filePath,
          fileCreated: data.fileCreated,
          fileWritten: data.fileWritten,
          command: data.command,
        },
      ]);
    };

    const handleTyping = (typing) => setIsTyping(typing);

    const handleError = (data) => {
      setIsTyping(false);
      addToast(data.message || 'Chat error', 'error');
    };

    socket.on('chat:response', handleResponse);
    socket.on('chat:typing', handleTyping);
    socket.on('chat:error', handleError);

    return () => {
      socket.off('chat:response', handleResponse);
      socket.off('chat:typing', handleTyping);
      socket.off('chat:error', handleError);
    };
  }, [socket, addToast]);

  const handleSend = () => {
    if (!input.trim() || !connected || !socket) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input.trim();
    setInput('');
    setIsTyping(true);

    // EVERY message goes to the backend intent router — no commands, no parsing
    socket.emit('chat:message', {
      query: currentInput,
      messages: [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      })),
      context: {
        projectPath,
      },
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (content, id) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      addToast('Copied to clipboard', 'success');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      addToast('Failed to copy', 'error');
    }
  };

  const handleVoiceResult = (transcript) => {
    setInput((prev) => prev + transcript);
    inputRef.current?.focus();
  };

  const handleClearChat = () => {
    setMessages([WELCOME_MESSAGE]);
    addToast('Chat cleared', 'info');
  };

  const handleActionButton = (action, data) => {
    if (!socket) return;

    switch (action) {
      case 'open-file':
        // Send as natural language — intent router handles it
        handleSendViaText(`Open ${data} in VSCode`);
        break;
      case 'run-command':
        handleSendViaText(`Run ${data}`);
        break;
      case 'read-file':
        handleSendViaText(`Read the file ${data}`);
        break;
    }
  };

  const handleSendViaText = (text) => {
    if (!socket || !connected) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    socket.emit('chat:message', {
      query: text,
      messages: [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      })),
      context: { projectPath },
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-2">
        {messages.map((msg) => (
          <div key={msg.id} className="animate-slide-up">
            {msg.role === 'user' ? (
              <div className="message-bubble-user">
                <p className="text-sm text-gray-100 whitespace-pre-wrap">{msg.content}</p>
                <div className="flex items-center justify-end mt-1.5">
                  <button
                    onClick={() => handleCopy(msg.content, msg.id)}
                    className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
                    title="Copy message"
                  >
                    {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="message-bubble-ai">
                <MessageBubble content={msg.content} />

                {/* Action buttons for file-related messages */}
                {(msg.filePath || (msg.actionType === 'create' && msg.filePath)) && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      onClick={() => handleActionButton('open-file', msg.filePath)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 border border-white/5 text-xs text-gray-300 hover:text-white transition-all"
                    >
                      <ExternalLink size={12} />
                      Open in VSCode
                    </button>
                    <button
                      onClick={() => handleActionButton('read-file', msg.filePath)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 border border-white/5 text-xs text-gray-300 hover:text-white transition-all"
                    >
                      <FileCode size={12} />
                      Read file
                    </button>
                  </div>
                )}

                {/* Run command button for exec results */}
                {msg.actionType === 'exec' && msg.command && (
                  <div className="mt-2">
                    <button
                      onClick={() => handleActionButton('run-command', msg.command)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-500/10 hover:bg-accent-500/20 border border-accent-500/20 text-xs text-accent-400 hover:text-accent-300 transition-all"
                    >
                      <Terminal size={12} />
                      Re-run command
                    </button>
                  </div>
                )}

                {/* Open created file in VSCode */}
                {(msg.actionType === 'create' && msg.filePath) && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      onClick={() => handleActionButton('open-file', msg.filePath)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-500/10 hover:bg-accent-500/20 border border-accent-500/20 text-xs text-accent-400 transition-all"
                    >
                      <ExternalLink size={12} />
                      Open in VSCode
                    </button>
                  </div>
                )}

                {msg.severity && msg.severity !== 'info' && (
                  <AnalysisCard
                    severity={msg.severity}
                    hasFix={msg.hasFix}
                    hasRootCause={msg.hasRootCause}
                    suggestions={msg.suggestions}
                  />
                )}
                <div className="flex items-center justify-end mt-2 gap-1">
                  <button
                    onClick={() => handleCopy(msg.content, msg.id)}
                    className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
                    title="Copy response"
                  >
                    {copiedId === msg.id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Typing Indicator */}
        {isTyping && (
          <div className="message-bubble-ai animate-fade-in">
            <div className="flex items-center gap-2.5 py-1">
              <div className="flex items-center gap-1.5">
                <div className="typing-dot" style={{ animationDelay: '0s' }} />
                <div className="typing-dot" style={{ animationDelay: '0.2s' }} />
                <div className="typing-dot" style={{ animationDelay: '0.4s' }} />
              </div>
              <span className="text-xs text-gray-500">Processing...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 pt-3 border-t border-white/5">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected
                ? 'Ask about errors, read files, run commands...'
                : 'Connecting to backend...'}
              disabled={!connected}
              rows={1}
              className="input-field resize-none pr-10 min-h-[40px] max-h-[120px] py-2.5 text-xs"
              style={{ scrollbarWidth: 'thin' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
            <VoiceInput
              isActive={isVoiceActive}
              onToggle={() => setIsVoiceActive(!isVoiceActive)}
              onResult={handleVoiceResult}
              disabled={!connected}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              input.trim() && connected
                ? 'bg-accent-600 text-white hover:bg-accent-500 shadow-lg shadow-accent-500/20'
                : 'bg-dark-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Send size={16} />
          </button>
          <button
            onClick={handleClearChat}
            className="p-2.5 rounded-xl text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
            title="Clear chat"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[10px] text-gray-600">
            {connected ? 'Just talk naturally · Enter to send' : 'Connect to backend to start'}
          </p>
          {projectPath && (
            <p className="text-[10px] text-gray-600 flex items-center gap-1">
              <FileCode size={10} />
              Natural language file access
            </p>
          )}
        </div>
      </div>

      {/* Empty state when disconnected */}
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-950/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-dark-800 border border-white/5 flex items-center justify-center">
              <RefreshCw size={20} className="text-gray-500 animate-spin" />
            </div>
            <p className="text-sm text-gray-400">Connecting to backend server...</p>
            <p className="text-xs text-gray-600 mt-1">Make sure the backend is running on port 3001</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatInterface;
