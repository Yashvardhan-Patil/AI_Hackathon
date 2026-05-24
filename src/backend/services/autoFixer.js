const groqService = require('./groqService');
const codeService = require('./codeService');
const logger = require('../utils/logger');
const path = require('path');

/**
 * AutoFixer — Automatically fixes code errors detected by the anomaly/alert pipeline.
 *
 * When an anomaly is detected, this service:
 * 1. Scans the project for relevant source files
 * 2. Reads their contents
 * 3. Sends error context + file contents to Groq AI
 * 4. Extracts code fixes from the AI response
 * 5. Applies fixes using CodeService
 * 6. Reports results (which files changed, what was fixed)
 */
class AutoFixer {
  constructor() {
    this.fixHistory = [];
    this.config = {
      maxHistorySize: 100,
      minIntervalBetweenFixesMs: 60 * 1000,  // Don't re-fix the same issue within 1 min
      maxSourceFilesToInclude: 5,              // Max source files to send to AI per fix
      maxFixRetries: 2,                        // Max retries if fix extraction fails
    };
    this.fixCache = new Map();  // anomalyFingerprint -> { timestamp, result }
  }

  /**
   * Attempt to auto-fix an anomaly by analyzing project source code
   * and applying AI-generated fixes.
   */
  async autoFix(anomaly, projectPath, logContext = '') {
    if (!anomaly || !anomaly.type) {
      return { success: false, error: 'Invalid anomaly' };
    }

    if (!projectPath) {
      return { success: false, error: 'No project path selected' };
    }

    // Check cache to avoid redundant fix attempts
    const fingerprint = this._createFingerprint(anomaly);
    const cached = this.fixCache.get(fingerprint);
    if (cached && (Date.now() - cached.timestamp) < this.config.minIntervalBetweenFixesMs) {
      return { success: true, result: cached.result, cached: true };
    }

    // Skip anomalies that aren't code-fixable
    if (!this._isFixable(anomaly)) {
      return { success: false, error: 'Anomaly type is not auto-fixable', skipped: true };
    }

    try {
      logger.info(`AutoFixer: Attempting auto-fix for ${anomaly.type} on ${anomaly.endpoint || 'unknown'}`);

      // 1. Find relevant source files in the project
      const sourceFiles = this._findRelevantSourceFiles(projectPath, anomaly);
      if (sourceFiles.length === 0) {
        return { success: false, error: 'No source files found to fix' };
      }

      // 2. Read the source files
      const fileContents = [];
      for (const filePath of sourceFiles.slice(0, this.config.maxSourceFilesToInclude)) {
        const readResult = codeService.readFile(filePath);
        if (readResult.success) {
          fileContents.push({
            path: readResult.relativePath,
            content: readResult.content,
          });
        }
      }

      if (fileContents.length === 0) {
        return { success: false, error: 'Could not read any source files' };
      }

      // 3. Build prompt (including any raw log context) and send to AI
      const prompt = this._buildFixPrompt(anomaly, fileContents, logContext);
      const aiResult = await groqService.sendMessage(
        [{ role: 'user', content: prompt }],
        { autoFix: true, temperature: 0.2 }
      );

      // 4. Extract fixes from AI response
      const fixes = this._extractFixes(aiResult, fileContents);

      if (fixes.length === 0) {
        // Maybe the AI gave a different format — try a more targeted retry
        logger.info('AutoFixer: No fixes extracted from AI response, retrying...');
        const retryPrompt = this._buildRetryPrompt(anomaly, fileContents, aiResult);
        const retryResult = await groqService.sendMessage(
          [{ role: 'user', content: retryPrompt }],
          { autoFix: true, temperature: 0.1 }
        );
        const retryFixes = this._extractFixes(retryResult, fileContents);

        if (retryFixes.length === 0) {
          return {
            success: false,
            error: 'AI did not generate a fixable response',
            aiResponse: aiResult.content ? aiResult.content.substring(0, 500) : 'No response',
          };
        }

        // Apply retry fixes
        return await this._applyFixes(retryFixes, anomaly);
      }

      // 5. Apply fixes
      return await this._applyFixes(fixes, anomaly);

    } catch (error) {
      logger.error('AutoFixer: Fix attempt failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Determine if an anomaly type is fixable by code changes.
   */
  _isFixable(anomaly) {
    const fixableTypes = [
      'server_error_cluster',
      'client_error_cluster',
      'error_rate_surge',
      'recurring_error',
      'request_failure',
    ];

    // Server errors / recurring errors are always potential bugs in code
    if (fixableTypes.includes(anomaly.type)) return true;

    // Latency spikes could be fixable but require optimization analysis
    if (anomaly.type === 'latency_spike' && anomaly.severity === 'critical') return true;

    return false;
  }

  /**
   * Find relevant source files in the project that could be causing the error.
   */
  _findRelevantSourceFiles(projectPath, anomaly) {
    const sourceExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.java', '.rs', '.c', '.cpp', '.cs', '.php'];
    const endpoint = anomaly.endpoint || '';
    const message = (anomaly.message || anomaly.alertMessage || '').toLowerCase();

    // List files in the project
    const listResult = codeService.listFiles('', 3);
    if (!listResult.success || !listResult.files) return [];

    const allFiles = listResult.files.filter(f => f.type === 'file');

    // Score each file by relevance to the anomaly
    const scored = allFiles.map(file => {
      const ext = path.extname(file.name).toLowerCase();
      const relativePath = file.relativePath || file.path;
      const lowerPath = relativePath.toLowerCase();
      let score = 0;

      // Only consider source files
      if (!sourceExtensions.includes(ext)) return { file, score: -1 };

      // Main/server files are often the most relevant
      if (/server|main|app|index/i.test(file.name)) score += 3;

      // Route/controller files matching the endpoint
      if (endpoint) {
        const endpointParts = endpoint.split('/').filter(Boolean);
        for (const part of endpointParts) {
          if (lowerPath.includes(part.toLowerCase())) score += 4;
        }
      }

      // Files matching error message keywords
      if (message) {
        const keywords = message.split(/[\s:;,]+/).filter(w => w.length > 3);
        for (const kw of keywords) {
          if (lowerPath.includes(kw.toLowerCase())) score += 2;
        }
      }

      // Route files are very likely culprits
      if (/route|api|controller|handler|service|middleware/i.test(lowerPath)) score += 2;

      // Configuration files less likely to be the bug
      if (/config|\.env|\.json/i.test(lowerPath)) score -= 1;

      // Test files not relevant for auto-fixing
      if (/test|spec|mock/i.test(lowerPath)) score = -1;

      return { file, score };
    });

    // Sort by score (highest first), filter out negative scores, return top files
    return scored
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxSourceFilesToInclude)
      .map(s => s.file.relativePath || s.file.path);
  }

  /**
   * Build a prompt for the AI to fix the error.
   */
  _buildFixPrompt(anomaly, fileContents, logContext = '') {
    const lines = [
      'An error was detected in the application. Please analyze the source code and fix the bug.',
      '',
      '=== ERROR DETAILS ===',
      `Type: ${anomaly.type}`,
      `Endpoint: ${anomaly.endpoint || 'N/A'}`,
      `Severity: ${anomaly.severity || 'N/A'}`,
      `Message: ${anomaly.message || anomaly.alertMessage || 'N/A'}`,
    ];

    if (anomaly.currentLatency) {
      lines.push(`Latency: ${anomaly.currentLatency}ms (baseline: ${anomaly.baselineLatency || 'N/A'}ms)`);
    }
    if (anomaly.statusCode) {
      lines.push(`Status Code: ${anomaly.statusCode}`);
    }
    if (anomaly.consecutiveFailures) {
      lines.push(`Consecutive Failures: ${anomaly.consecutiveFailures}`);
    }
    if (anomaly.error) {
      lines.push(`Error Details: ${anomaly.error}`);
    }

    lines.push('', '=== SOURCE CODE ===');

    for (const file of fileContents) {
      const filePath = file.path;
      const content = file.content;
      // Truncate very large files
      const truncatedContent = content.length > 8000
        ? content.substring(0, 8000) + '\n// ... [truncated, file too large]'
        : content;
      lines.push(`\nFILE: ${filePath}\n\`\`\`\n${truncatedContent}\n\`\`\``);
    }

    // Include raw log context if available (gives the AI actual error output to work with)
    if (logContext) {
      lines.push('', '=== RAW ERROR LOGS ===', logContext.substring(0, 2000));
    }

    lines.push('',
      '=== INSTRUCTIONS ===',
      '1. Analyze the error and the source code above.',
      '2. Identify the bug or code issue causing this error.',
      '3. Output the COMPLETE fixed version of any file that needs changes.',
      '',
      'IMPORTANT — Use this EXACT format for each file you want to fix:',
      '',
      'FILE: path/to/file.js',
      '```',
      '// COMPLETE fixed file content here',
      '```',
      '',
      'Only output files that actually need changes. Do NOT output files that are already correct.',
      'Focus on the actual bug — not stylistic improvements. Do NOT add new features.',
      '',
    );

    return lines.join('\n');
  }

  /**
   * Build a retry prompt if the first attempt didn't produce parseable fixes.
   */
  _buildRetryPrompt(anomaly, fileContents, previousResult) {
    const lines = [
      'I need you to output the fix in a very specific format.',
      '',
      '=== ERROR ===',
      `Type: ${anomaly.type}`,
      `Message: ${anomaly.message || anomaly.alertMessage || 'N/A'}`,
      '',
      '=== SOURCE FILES ===',
    ];

    for (const file of fileContents) {
      const truncatedContent = file.content.length > 6000
        ? file.content.substring(0, 6000) + '\n// ... [truncated]'
        : file.content;
      lines.push(`\nFILE: ${file.path}\n\`\`\`\n${truncatedContent}\n\`\`\``);
    }

    lines.push('',
      '=== INSTRUCTION ===',
      'Output ONLY files that need to be changed. Use EXACTLY this format:',
      '',
      'FILE: path/to/file.js',
      '```',
      'COMPLETE file content with the fix applied',
      '```',
      '',
      'If no files need changes, say: NO_FIX_NEEDED',
      'If you need to create a new file, say: CREATE: path/to/new/file.js',
      '```',
      'COMPLETE new file content',
      '```',
    );

    return lines.join('\n');
  }

  /**
   * Extract file fix entries from the AI response.
   * Returns array of { filePath, content } objects.
   */
  _extractFixes(aiResult, fileContents) {
    if (!aiResult || !aiResult.content) return [];

    const content = aiResult.content;
    const fixes = [];

    // Pattern: FILE: path/to/file.js ``` ... ```
    const fileRegex = /FILE:\s*([^\n]+)\s*```(?:\w+)?\s*\n([\s\S]*?)```/gi;
    let match;
    while ((match = fileRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();
      if (filePath && fileContent && fileContent.length > 10) {
        fixes.push({ filePath, content: fileContent });
      }
    }

    // Pattern: CREATE: path/to/file.js ``` ... ```
    const createRegex = /CREATE:\s*([^\n]+)\s*```(?:\w+)?\s*\n([\s\S]*?)```/gi;
    while ((match = createRegex.exec(content)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();
      if (filePath && fileContent && fileContent.length > 10) {
        fixes.push({ filePath, content: fileContent, create: true });
      }
    }

    return fixes;
  }

  /**
   * Apply extracted fixes to files.
   */
  async _applyFixes(fixes, anomaly) {
    const results = [];

    for (const fix of fixes) {
      try {
        let writeResult;
        if (fix.create) {
          writeResult = codeService.writeFile(fix.filePath, fix.content, { createDir: true });
        } else {
          writeResult = codeService.writeFile(fix.filePath, fix.content);
        }
        results.push({
          filePath: fix.filePath,
          success: writeResult.success,
          message: writeResult.success
            ? `✅ ${writeResult.message || 'File updated'}`
            : `❌ ${writeResult.error}`,
          error: writeResult.success ? null : writeResult.error,
        });
      } catch (err) {
        results.push({
          filePath: fix.filePath,
          success: false,
          message: `❌ Failed: ${err.message}`,
          error: err.message,
        });
      }
    }

    const allSucceeded = results.every(r => r.success);
    const fingerprint = this._createFingerprint(anomaly);

    const result = {
      success: allSucceeded,
      fixes: results,
      fixCount: results.length,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      anomalyType: anomaly.type,
      anomalyEndpoint: anomaly.endpoint || 'N/A',
      timestamp: new Date().toISOString(),
    };

    // Cache the result
    this.fixCache.set(fingerprint, { result, timestamp: Date.now() });

    // Add to history
    this.fixHistory.push(result);
    if (this.fixHistory.length > this.config.maxHistorySize) {
      this.fixHistory.shift();
    }

    logger.info(`AutoFixer: Applied ${results.filter(r => r.success).length}/${results.length} fixes for ${anomaly.type}`);

    return { success: allSucceeded, result };
  }

  /**
   * Create a fingerprint for an anomaly to avoid redundant fixes.
   */
  _createFingerprint(anomaly) {
    const endpoint = anomaly.endpoint || 'unknown';
    const message = (anomaly.message || anomaly.alertMessage || '').trim();
    const normalizedMsg = message.toLowerCase()
      .replace(/\d+ms/g, '<DURATION>')
      .replace(/\d+\.?\d*%/g, '<PCT>')
      .replace(/\d+/g, '<N>')
      .substring(0, 100);
    return `${anomaly.type}:${endpoint}:${normalizedMsg}`;
  }

  /**
   * Get fix history
   */
  getFixHistory(options = {}) {
    let history = [...this.fixHistory];
    if (options.limit) {
      history = history.slice(-options.limit);
    }
    return {
      total: history.length,
      fixes: history.reverse(),
    };
  }

  /**
   * Check if an anomaly has already been fixed recently.
   */
  wasRecentlyFixed(anomaly) {
    const fingerprint = this._createFingerprint(anomaly);
    const cached = this.fixCache.get(fingerprint);
    if (cached && cached.result && cached.result.success) {
      const elapsed = Date.now() - cached.timestamp;
      return elapsed < this.config.minIntervalBetweenFixesMs;
    }
    return false;
  }
}

module.exports = new AutoFixer();
