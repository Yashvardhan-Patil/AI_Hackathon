const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const ERROR_PATTERNS = [
  /error/i,
  /exception/i,
  /fail(ed|ure)?/i,
  /timeout/i,
  /5\d{2}/,
  /4\d{2}/,
  /uncaught/i,
  /unhandled/i,
  /reject/i,
  /crash/i,
  /stack trace/i,
  /at\s+\S+/,
];

const WARNING_PATTERNS = [
  /warn(ing)?/i,
  /deprecated/i,
  /slow/i,
  /retry/i,
  /rate limit/i,
  /throttl/i,
];

function parseLogLine(line, lineNumber) {
  const timestampMatch = line.match(
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/
  );

  const levelMatch = line.match(
    /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i
  );

  const isError = ERROR_PATTERNS.some((pattern) => pattern.test(line));
  const isWarning = WARNING_PATTERNS.some((pattern) => pattern.test(line));

  let type = 'info';
  if (isError || (levelMatch && /ERROR|FATAL|CRITICAL/i.test(levelMatch[1]))) {
    type = 'error';
  } else if (isWarning || (levelMatch && /WARN/i.test(levelMatch[1]))) {
    type = 'warning';
  }

  return {
    lineNumber,
    timestamp: timestampMatch ? timestampMatch[1] : null,
    level: levelMatch ? levelMatch[1].toUpperCase() : (type === 'error' ? 'ERROR' : type === 'warning' ? 'WARN' : 'INFO'),
    type,
    content: line.trim(),
    hasStackTrace: /at\s+\S+/.test(line),
    statusCode: extractStatusCode(line),
  };
}

function extractStatusCode(line) {
  const match = line.match(/\b(5\d{2}|4\d{2})\b/);
  return match ? parseInt(match[1]) : null;
}

function parseLogFile(filePath, maxLines = 5000) {
  try {
    if (!fs.existsSync(filePath)) {
      return { entries: [], error: 'File not found' };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(-maxLines);

    const entries = lines
      .map((line, index) => parseLogLine(line, index + 1))
      .filter((entry) => entry.content.length > 0);

    return {
      entries,
      totalLines: lines.length,
      filePath,
      fileName: path.basename(filePath),
      stats: summarizeEntries(entries),
    };
  } catch (error) {
    logger.error('Failed to parse log file:', error.message);
    return { entries: [], error: error.message };
  }
}

function summarizeEntries(entries) {
  return {
    total: entries.length,
    errors: entries.filter((e) => e.type === 'error').length,
    warnings: entries.filter((e) => e.type === 'warning').length,
    info: entries.filter((e) => e.type === 'info').length,
    recentErrors: entries
      .filter((e) => e.type === 'error')
      .slice(-10)
      .map((e) => ({
        line: e.lineNumber,
        content: e.content.substring(0, 200),
        timestamp: e.timestamp,
        statusCode: e.statusCode,
      })),
  };
}

function scanDirectory(dirPath, patterns = ['*.log', '*.txt', '*.out', 'error*']) {
  try {
    if (!fs.existsSync(dirPath)) {
      return { files: [], error: 'Directory not found' };
    }

    const files = [];
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      if (item.isFile()) {
        const matches = patterns.some((pattern) => {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
          return regex.test(item.name);
        });

        if (matches) {
          const filePath = path.join(dirPath, item.name);
          const stats = fs.statSync(filePath);
          files.push({
            name: item.name,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtime,
          });
        }
      }
    }

    return { files };
  } catch (error) {
    logger.error('Failed to scan directory:', error.message);
    return { files: [], error: error.message };
  }
}

function extractErrors(logContent, maxErrors = 20) {
  const lines = logContent.split('\n');
  const errors = [];
  let i = 0;

  while (i < lines.length && errors.length < maxErrors) {
    const entry = parseLogLine(lines[i], i + 1);
    if (entry.type === 'error') {
      const context = [];
      // Get surrounding lines for context
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j++) {
        context.push({
          line: j + 1,
          content: lines[j],
        });
      }
      errors.push({
        ...entry,
        context,
      });
    }
    i++;
  }

  return errors;
}

module.exports = {
  parseLogLine,
  parseLogFile,
  scanDirectory,
  extractErrors,
  summarizeEntries,
};
