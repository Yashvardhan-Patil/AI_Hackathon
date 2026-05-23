import React from 'react';

function MessageBubble({ content }) {
  // Simple markdown-like rendering
  const renderContent = (text) => {
    const lines = text.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeContent = '';
    let codeLanguage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block handling
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <div key={`code-${i}`} className="my-2 rounded-xl overflow-hidden border border-white/5 bg-dark-900/50">
              {codeLanguage && (
                <div className="px-3 py-1 text-[10px] text-gray-500 border-b border-white/5 bg-dark-800/50">
                  {codeLanguage}
                </div>
              )}
              <pre className="p-3 overflow-x-auto">
                <code className="text-xs font-mono text-gray-300 leading-relaxed">{codeContent}</code>
              </pre>
            </div>
          );
          codeContent = '';
          codeLanguage = '';
          inCodeBlock = false;
          continue;
        } else {
          inCodeBlock = true;
          codeLanguage = line.trim().slice(3).trim();
          continue;
        }
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line;
        continue;
      }

      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={i} className="text-sm font-semibold text-gray-100 mt-3 mb-1">
            {line.slice(4)}
          </h3>
        );
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-base font-semibold text-gray-100 mt-3 mb-1">
            {line.slice(3)}
          </h2>
        );
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={i} className="text-lg font-bold text-gray-100 mt-3 mb-2">
            {line.slice(2)}
          </h1>
        );
        continue;
      }

      // Bullet points
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        elements.push(
          <li key={i} className="text-sm text-gray-300 ml-4 list-disc">
            {renderInline(line.trim().slice(2))}
          </li>
        );
        continue;
      }

      // Numbered lists
      if (/^\d+\.\s/.test(line.trim())) {
        const match = line.trim().match(/^\d+\.\s(.*)/);
        if (match) {
          elements.push(
            <li key={i} className="text-sm text-gray-300 ml-4 list-decimal">
              {renderInline(match[1])}
            </li>
          );
          continue;
        }
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={i} className="h-1.5" />);
        continue;
      }

      // Regular paragraph
      elements.push(
        <p key={i} className="text-sm text-gray-300 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }

    // Close any unclosed code block
    if (inCodeBlock && codeContent) {
      elements.push(
        <div key="code-end" className="my-2 rounded-xl overflow-hidden border border-white/5 bg-dark-900/50">
          <pre className="p-3 overflow-x-auto">
            <code className="text-xs font-mono text-gray-300">{codeContent}</code>
          </pre>
        </div>
      );
    }

    return elements;
  };

  const renderInline = (text) => {
    const parts = [];
    let remaining = text;
    let key = 0;

    // Bold: **text**
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++}>{remaining.slice(lastIndex, match.index)}</span>
        );
      }
      parts.push(
        <strong key={key++} className="font-semibold text-gray-100">
          {match[1]}
        </strong>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < remaining.length) {
      parts.push(
        <span key={key++}>{remaining.slice(lastIndex)}</span>
      );
    }

    if (parts.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
    }

    return parts;
  };

  return (
    <div className="prose prose-invert max-w-none">
      {renderContent(content)}
    </div>
  );
}

export default MessageBubble;
