const groqService = require('./groqService');
const logParser = require('./logParser');
const FileMonitor = require('./fileMonitor');
const codeService = require('./codeService');
const IntentRouter = require('./intentRouter');
const anomalyDetector = require('./anomalyDetector');
const alertManager = require('./alertManager');
const endpointMonitor = require('./endpointMonitor');
const autoAnalyzer = require('./autoAnalyzer');
const webService = require('./webService');
const logger = require('../utils/logger');

let fileMonitor = null;
// Only monitor endpoints that actually exist — the backend's own health endpoint
const MONITORED_ENDPOINTS = [
  { method: 'GET', path: '/health', name: 'Backend Health', url: 'http://localhost:3001/health' },
];

function setupSocketHandlers(io) {
  fileMonitor = new FileMonitor(io);

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Send initial state
    socket.emit('connected', {
      id: socket.id,
      timestamp: new Date().toISOString(),
      watchedPaths: fileMonitor.getWatchedPaths(),
    });

    // Send current alert state
    socket.emit('alerts:state', alertManager.getActiveAlerts());
    socket.emit('alerts:history', alertManager.getAlertHistory({ limit: 50 }));

    // ==================== CHAT — NATURAL LANGUAGE FILE ACCESS ====================
    // ALL messages go through this handler. No commands, no special syntax.
    // The IntentRouter analyzes each message and handles file ops automatically.
    socket.on('chat:message', async (data) => {
      try {
        socket.emit('chat:typing', true);

        const query = data.query || (data.messages?.length > 0 ? data.messages[data.messages.length - 1].content : '') || '';
        const projectPath = codeService.getProjectPath();

        // 1. Route through IntentRouter to detect intent & perform file ops
        const intent = await IntentRouter.processMessage(query, projectPath);

        let result;

        switch (intent.type) {
          // ===== READ FILE + AI ANALYSIS =====
          case 'read':
            // Inject file content directly into messages so AI actually sees it
            const readMessages = [
              { role: 'system', content: `The user is looking at this file. File content of ${intent.filePath}:\n\`\`\`\n${intent.fileContent}\n\`\`\`\n\n${intent.query ? `The user asks: ${intent.query}` : 'Analyze this file.'}` },
              ...(data.messages || []),
            ];
            result = await groqService.sendMessage(readMessages, { query: intent.query || query });
            result.filePath = intent.filePath;
            result.fileContent = intent.fileContent;
            result.actionType = 'read';
            break;

          // ===== FIX FILE — read + AI analyzes + APPLIES the fix automatically =====
          case 'fix':
            // Inject file content into messages and instruct AI to output the fixed code
            const fixMessages = [
              { role: 'system', content: `The user wants to fix this file. File content of ${intent.filePath}:\n\`\`\`\n${intent.fileContent}\n\`\`\`\n\nIdentify bugs, errors, or issues and output the COMPLETE fixed file inside a code block.\n\n${intent.query ? `User's specific request: ${intent.query}` : 'Fix all bugs and issues in this file.'}` },
              ...(data.messages || []),
            ];
            const fixResponse = await groqService.sendMessage(fixMessages, { query: intent.query || `Fix bugs in ${intent.filePath}` });

            // Extract code block from AI response and apply the fix
            let fixApplyResult = { success: false, error: 'AI did not generate a fix' };
            let fixApplied = false;
            if (fixResponse.content) {
              const codeBlockMatch = fixResponse.content.match(/\`\`\`(?:\w+)?\n([\s\S]*?)\`\`\`/);
              if (codeBlockMatch && codeBlockMatch[1].trim().length > 10) {
                fixApplyResult = codeService.writeFile(intent.filePath, codeBlockMatch[1].trim());
                fixApplied = fixApplyResult.success;
              } else {
                // No code block found — inform user but still return the analysis
                fixApplyResult = { success: false, error: 'AI response did not include a code block with the fix' };
              }
            }

            result = {
              ...fixResponse,
              actionType: 'fix',
              filePath: fixApplyResult.success ? fixApplyResult.relativePath : intent.filePath,
              fixApplied,
              fixResult: fixApplyResult,
              fileContent: intent.fileContent,
            };

            // Notify frontend about the fix
            if (fixApplied) {
              io.emit('auto-fix:result', {
                fixes: [{ filePath: intent.filePath, success: true, message: fixApplyResult.message }],
                fixCount: 1,
                successCount: 1,
                failureCount: 0,
                anomalyType: 'chat_fix',
                timestamp: new Date().toISOString(),
              });
            }
            break;

          // ===== CREATE FILE — AI generates content, backend writes it =====
          case 'create':
            // Have AI generate the file content
            const createResponse = await groqService.sendMessage([
              { role: 'user', content: `Create the file "${intent.filePath}". ${intent.query || ''}\n\nGenerate the COMPLETE file content. Put the entire file content inside a single code block with the appropriate language tag. Make it a full, working implementation.` },
            ], { createMode: true });

            // Extract code block from AI response and write the file
            let writeResult = { success: false, error: 'AI did not generate file content' };
            if (createResponse.content) {
              const codeBlockMatch = createResponse.content.match(/\`\`\`(?:\w+)?\n([\s\S]*?)\`\`\`/);
              if (codeBlockMatch) {
                writeResult = codeService.writeFile(intent.filePath, codeBlockMatch[1].trim(), { createDir: true });
              } else {
                // No code block — try writing the whole response as content
                writeResult = codeService.writeFile(intent.filePath, createResponse.content.trim(), { createDir: true });
              }
            }

            result = {
              ...createResponse,
              actionType: 'create',
              filePath: writeResult.success ? writeResult.relativePath : intent.filePath,
              fileCreated: writeResult.success,
              fileCreateError: writeResult.success ? null : writeResult.error,
            };
            break;

          // ===== WRITE / UPDATE FILE =====
          case 'write':
            const writeResponse = await groqService.sendMessage([
              { role: 'user', content: `Update the file "${intent.filePath}".\n\nCurrent content:\n\`\`\`\n${(intent.fileContent || '(empty file)').slice(0, 4000)}\n\`\`\`\n\nRequest: ${intent.query || query}\n\nGenerate the COMPLETE updated file content inside a single code block.` },
            ], { editMode: true });

            let updateResult = { success: false, error: 'AI did not generate updated content' };
            if (writeResponse.content) {
              const codeBlockMatch = writeResponse.content.match(/\`\`\`(?:\w+)?\n([\s\S]*?)\`\`\`/);
              if (codeBlockMatch) {
                updateResult = codeService.writeFile(intent.filePath, codeBlockMatch[1].trim());
              }
            }

            result = {
              ...writeResponse,
              actionType: 'write',
              filePath: updateResult.success ? updateResult.relativePath : intent.filePath,
              fileWritten: updateResult.success,
              fileWriteError: updateResult.success ? null : updateResult.error,
            };
            break;

          // ===== RUN COMMAND =====
          case 'run':
            result = {
              type: 'analysis',
              content: `**Command:** \`${intent.command}\`\n` +
                (intent.operationResult.success
                  ? `✅ **Exit code:** ${intent.operationResult.exitCode}\n\n\`\`\`\n${(intent.operationResult.stdout || '').slice(0, 2000)}\n\`\`\`` +
                    (intent.operationResult.stderr ? `\n**stderr:**\n\`\`\`\n${intent.operationResult.stderr.slice(0, 1000)}\n\`\`\`` : '')
                  : `❌ **Failed:**\n\`\`\`\n${(intent.operationResult.stderr || intent.operationResult.error || 'Unknown error').slice(0, 2000)}\n\`\`\``
                ),
              severity: intent.operationResult.success ? 'info' : 'error',
              actionType: 'exec',
              command: intent.command,
            };
            break;

          // ===== WEB SEARCH / URL FETCH / OPEN IN BROWSER =====
          case 'web': {
            let webContent;
            let browserOpened = false;

            // Check if user explicitly asked to OPEN in browser (vs just search/fetch)
            const wantsOpenInBrowser = /\b(open|go\s+to|launch|start)\s+(in\s+)?(browser|chrome|edge|firefox|safari)?/i.test(intent.query || query);

            if (intent.webResult?.success) {
              const result = intent.webResult;

              // If it's a URL and user wants to open in browser, do that
              if (result.url && (wantsOpenInBrowser || /\b(open|go\s+to|launch)\b/i.test(intent.query || query))) {
                const browserResult = await webService.openInBrowser(result.url);
                browserOpened = browserResult.success;
              }

              // Build content for AI analysis
              if (result.text) {
                webContent = `Title: ${result.title || 'N/A'}\nURL: ${result.url || 'N/A'}\n\nContent:\n${result.text.substring(0, 6000)}`;
              } else if (result.snippets?.length > 0) {
                webContent = `Search results for "${result.query || ''}":\n\n${result.snippets.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}\n   ${s.snippet}`).join('\n\n')}`;
              } else {
                webContent = `Fetched content from ${result.url || 'web'}:\n\n${(result.rawText || 'No content available').substring(0, 4000)}`;
              }

              // Append browser status
              if (browserOpened) {
                webContent += `\n\n[✓ URL opened in your default browser]`;
              }
            } else {
              webContent = `Web fetch failed: ${intent.webResult?.error || 'Unknown error'}`;
            }

            result = await groqService.sendMessage([
              { role: 'system', content: `The user asked to search or access the web. Here is the result:\n\n${webContent}\n\nPlease answer the user's question based on this information.` },
              { role: 'user', content: intent.query || query },
            ]);
            result.actionType = 'web';
            result.webResult = intent.webResult;
            result.browserOpened = browserOpened;
            break;
          }

          // ===== OPEN IN VSCODE =====
          case 'vscode':
            result = {
              type: 'analysis',
              content: intent.operationResult?.success
                ? `✅ ${intent.operationResult.message}`
                : `❌ ${intent.operationResult?.error || 'Could not open in VSCode'}`,
              severity: intent.operationResult?.success ? 'info' : 'error',
              actionType: 'vscode',
              targetPath: intent.query || query,
            };
            break;

          // ===== PLAIN CHAT (no file operation detected) =====
          case 'chat':
          default:
            // If file content was fetched (e.g., generic "check this file" without fix/create intent),
            // inject it into messages so AI can see it
            let chatMessages = data.messages || [];
            if (intent.fileContent) {
              chatMessages = [
                { role: 'system', content: `Relevant file (${intent.filePath}):\n\`\`\`\n${intent.fileContent}\n\`\`\`` },
                ...chatMessages,
              ];
            }
            if (intent.fileContext) {
              chatMessages = [
                { role: 'system', content: intent.fileContext },
                ...chatMessages,
              ];
            }

            result = await groqService.sendMessage(chatMessages, { query: intent.query || query });

            if (intent.filePath) result.filePath = intent.filePath;
            if (intent.fileContent) result.fileContent = intent.fileContent;
            break;
        }

        socket.emit('chat:response', {
          id: Date.now().toString(),
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Chat error:', error.message);
        socket.emit('chat:error', {
          message: error.message,
          timestamp: new Date().toISOString(),
        });
      } finally {
        socket.emit('chat:typing', false);
      }
    });

    // Analyze logs
    socket.on('logs:analyze', async (data) => {
      try {
        socket.emit('chat:typing', true);

        const result = await groqService.analyzeLogs(
          data.logContent || '',
          data.query || ''
        );

        socket.emit('logs:analysis', {
          id: Date.now().toString(),
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Log analysis error:', error.message);
        socket.emit('logs:analysis-error', { message: error.message });
      } finally {
        socket.emit('chat:typing', false);
      }
    });

    // ==================== PROJECT EVENTS ====================

    // Project folder selection
    socket.on('project:select', async (data) => {
      try {
        codeService.setProjectPath(data.path);
        const result = fileMonitor.startWatching(data.path);

        // Auto-create the starter file (example/first.py)
        let createResult = { success: false };
        try {
          createResult = codeService.createStarterFile();
        } catch (starterError) {
          logger.error('Failed to create starter file:', starterError.message);
        }

        // ===== AUTO-DISCOVER PROJECT ENDPOINTS (Fix #3) =====
        // Try to detect server files and add their endpoints to monitoring
        const discoveredEndpoints = [];
        try {
          const files = codeService.listFiles('', 2);
          if (files.success && files.files) {
            // Look for server/main files
            const serverFiles = files.files.filter(f =>
              f.type === 'file' &&
              /server|main|app|index|api|route/i.test(f.name) &&
              /\.(js|ts|py|go|rb|java)$/i.test(f.name)
            );

            // Add common backend paths as endpoints to monitor
            // Only add ones that are likely to actually exist — port 3001 (our backend)
            // and 5173 (Vite dev server if running)
            const autoEndpoints = [
              { url: `http://localhost:3001/health`, method: 'GET', name: 'Backend Health', path: '/health' },
              { url: `http://localhost:5173/`, method: 'GET', name: 'Vite Dev Server', path: '/' },
            ];

            for (const ep of autoEndpoints) {
              endpointMonitor.addEndpoint(ep.url, ep);
              discoveredEndpoints.push(ep.name);
            }
          }
        } catch (scanErr) {
          logger.error('Auto-discover endpoints error:', scanErr.message);
        }

        // ===== AUTO-SCAN FOR ANOMALIES IN PROJECT LOGS (Fix #3) =====
        let anomalyScanResult = null;
        try {
          const logScan = logParser.scanDirectory(data.path);
          if (logScan.files && logScan.files.length > 0) {
            // Parse the first log file and detect anomalies
            for (const logFile of logScan.files.slice(0, 3)) {
              const parsed = logParser.parseLogFile(logFile.path);
              if (parsed.entries && parsed.entries.length > 0) {
                const detectedAnomalies = anomalyDetector.analyzeLogFile(parsed);
                if (detectedAnomalies.totalAnomalies > 0) {
                  anomalyScanResult = anomalyScanResult || { totalAnomalies: 0, groups: {} };
                  anomalyScanResult.totalAnomalies += detectedAnomalies.totalAnomalies;
                  Object.assign(anomalyScanResult.groups, detectedAnomalies.groups);

                  // Create alerts for detected anomalies
                  for (const anomaly of detectedAnomalies.anomalies) {
                    const alert = alertManager.processAnomaly({
                      ...anomaly,
                      source: 'project_scan',
                    });
                  }
                }
              }
            }
          }
        } catch (scanErr) {
          logger.error('Auto-scan anomaly error:', scanErr.message);
        }

        // ===== BUILD PROJECT FILE STRUCTURE for chat context =====
        let fileStructure = { files: [], error: null };
        try {
          fileStructure = codeService.listFiles('', 3);
        } catch (structErr) {
          logger.error('Build file structure error:', structErr.message);
          fileStructure.error = structErr.message;
        }

        // ===== BROADCAST UPDATED STATE TO ALL CLIENTS =====
        if (anomalyScanResult && anomalyScanResult.totalAnomalies > 0) {
          io.emit('anomaly:new', {
            count: anomalyScanResult.totalAnomalies,
            summary: `Scanned ${data.path} and found ${anomalyScanResult.totalAnomalies} anomaly(ies)`,
            criticalCount: 0,
            timestamp: new Date().toISOString(),
          });
        }

        // Broadcast updated alert and health state
        io.emit('alerts:state', alertManager.getActiveAlerts());
        io.emit('health:status', endpointMonitor.getStatus());

        socket.emit('project:selected', {
          path: data.path,
          ...result,
          starterFileCreated: createResult.success,
          starterFilePath: createResult.success ? createResult.relativePath : null,
          starterFileMessage: createResult.success ? 'Created example/first.py with To-Do List app' : null,
          endpointsDiscovered: discoveredEndpoints.length,
          anomaliesFound: anomalyScanResult?.totalAnomalies || 0,
          fileStructure: fileStructure.success ? {
            count: fileStructure.count,
            files: fileStructure.files.map(f => f.relativePath),
            tree: fileStructure.files
              .filter(f => f.type === 'file' && !f.name.startsWith('.'))
              .slice(0, 80)
              .map(f => f.relativePath),
          } : null,
          // Also store a formatted tree string directly
          fileTreeSummary: fileStructure.success
            ? fileStructure.files
                .filter(f => f.type === 'file' && !f.name.startsWith('.'))
                .slice(0, 60)
                .map(f => `  - ${f.relativePath}`)
                .join('\n')
            : 'Could not scan project structure',
        });
      } catch (error) {
        logger.error('Project selection error:', error.message);
        socket.emit('project:selected', {
          path: data.path,
          success: false,
          error: error.message,
          starterFileCreated: false,
        });
      }
    });

    socket.on('project:deselect', () => {
      codeService.setProjectPath(null);
      if (fileMonitor) {
        fileMonitor.stopAll();
      }
      socket.emit('project:deselected', {
        message: 'Project path cleared',
      });
    });

    // Get project info
    socket.on('project:info', () => {
      const projectPath = codeService.getProjectPath();
      socket.emit('project:info-result', {
        path: projectPath,
        selected: !!projectPath,
      });
    });

    // Get log files in directory
    socket.on('project:scan-logs', (data) => {
      const result = logParser.scanDirectory(data.path);
      socket.emit('project:log-files', result);
    });

    // ==================== CODE EVENTS ====================

    // Read a file from the project
    socket.on('code:read', (data) => {
      const result = codeService.readFile(data.filePath);
      socket.emit('code:read-result', result);
    });

    // Write/edit a file in the project
    socket.on('code:write', (data) => {
      const result = codeService.writeFile(data.filePath, data.content, data.options || {});
      if (result.success) {
        // Re-emit project file list update
        socket.emit('project:file-saved', {
          path: result.path,
          relativePath: result.relativePath,
          message: result.message,
        });
      }
      socket.emit('code:write-result', result);
    });

    // Fix code in a file (replace specific content)
    socket.on('code:fix', (data) => {
      const result = codeService.fixFile(data.filePath, data.oldContent, data.newContent);
      socket.emit('code:fix-result', result);
    });

    // Create a new file
    socket.on('code:create', (data) => {
      const result = codeService.writeFile(data.filePath, data.content, { createDir: true });
      socket.emit('code:create-result', result);
    });

    // Create the default starter file
    socket.on('code:create-starter', () => {
      const result = codeService.createStarterFile();
      socket.emit('code:create-starter-result', result);
    });

    // Open file/folder in VSCode
    socket.on('code:open-vscode', async (data) => {
      const result = await codeService.openInVSCode(data.targetPath || null);
      socket.emit('code:open-vscode-result', result);
    });

    // List files in project directory
    socket.on('code:list-files', (data) => {
      const result = codeService.listFiles(data.dirPath || '', data.depth || 2);
      socket.emit('code:list-files-result', result);
    });

    // Execute terminal command
    socket.on('code:execute', async (data) => {
      const result = await codeService.executeCommand(data.command, data.cwd);
      socket.emit('code:execute-result', result);
    });

    // ==================== LOG EVENTS ====================

    // Read a specific log file
    socket.on('logs:read-file', (data) => {
      const result = logParser.parseLogFile(data.filePath);
      socket.emit('logs:file-content', result);
    });

    // ==================== ANOMALY & ALERT EVENTS ====================

    // Get active alerts
    socket.on('alerts:get-active', (data) => {
      const result = alertManager.getActiveAlerts(data || {});
      socket.emit('alerts:state', result);
    });

    // Get alert history
    socket.on('alerts:get-history', (data) => {
      const result = alertManager.getAlertHistory(data || {});
      socket.emit('alerts:history', result);
    });

    // Resolve an alert
    socket.on('alerts:resolve', (data) => {
      const result = alertManager.resolveAlert(data.alertId);
      socket.emit('alerts:resolved', result);
      // Broadcast updated state
      io.emit('alerts:state', alertManager.getActiveAlerts());
      io.emit('alerts:history', alertManager.getAlertHistory({ limit: 50 }));
    });

    // Resolve all alerts for an endpoint
    socket.on('alerts:resolve-endpoint', (data) => {
      const result = alertManager.resolveAlertsForEndpoint(data.endpoint);
      socket.emit('alerts:resolved', result);
      io.emit('alerts:state', alertManager.getActiveAlerts());
      io.emit('alerts:history', alertManager.getAlertHistory({ limit: 50 }));
    });

    // Get anomaly detector recurring errors
    socket.on('alerts:get-recurring', () => {
      const errors = anomalyDetector.getRecurringErrors();
      socket.emit('alerts:recurring-errors', errors);
    });

    // Manually trigger anomaly analysis on a log file
    socket.on('logs:analyze-anomalies', async (data) => {
      try {
        socket.emit('chat:typing', true);

        const parsed = data.parsedLog || logParser.parseLogFile(data.filePath);
        const analysisResult = anomalyDetector.analyzeLogFile(parsed);

        if (analysisResult.totalAnomalies > 0) {
          // Process each anomaly into alerts
          const alerts = [];
          for (const anomaly of analysisResult.anomalies) {
            const alert = alertManager.processAnomaly(anomaly);
            if (alert) alerts.push(alert);
          }

          // Auto-analyze with AI (goes through the rate-limit queue, so safe)
          const aiAnalysis = await autoAnalyzer.analyzeBatch(analysisResult.anomalies);

          // Broadcast alert updates
          io.emit('alerts:state', alertManager.getActiveAlerts());

          socket.emit('logs:anomaly-analysis', {
            ...analysisResult,
            aiAnalysis,
            alertsProcessed: alerts.length,
          });

          // Send anomaly toast to all clients
          io.emit('anomaly:new', {
            count: analysisResult.totalAnomalies,
            summary: analysisResult.summary,
            criticalCount: Object.values(analysisResult.groups).reduce(
              (s, arr) => s + arr.filter(a => a.severity === 'critical').length, 0
            ),
            timestamp: new Date().toISOString(),
          });
        } else {
          socket.emit('logs:anomaly-analysis', {
            totalAnomalies: 0,
            anomalies: [],
            groups: {},
            summary: 'No anomalies detected',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.error('Anomaly analysis error:', error.message);
        socket.emit('logs:anomaly-analysis-error', { message: error.message });
      } finally {
        socket.emit('chat:typing', false);
      }
    });

    // ==================== HEALTH EVENTS ====================

    // Get endpoint health status (real data)
    socket.on('health:check', () => {
      const status = endpointMonitor.getStatus();
      socket.emit('health:status', {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        monitoredEndpoints: status.endpoints,
        ...status,
      });
    });

    // Add an endpoint to monitor
    socket.on('health:add-endpoint', (data) => {
      const result = endpointMonitor.addEndpoint(data.url, {
        method: data.method || 'GET',
        name: data.name || data.url,
        path: data.path || '/',
      });
      socket.emit('health:endpoint-added', { success: true, url: data.url });
    });

    // Remove an endpoint from monitoring
    socket.on('health:remove-endpoint', (data) => {
      const result = endpointMonitor.removeEndpoint(data.url);
      socket.emit('health:endpoint-removed', { success: result, url: data.url });
    });

    // Reset anomaly detector and alert manager
    socket.on('anomaly:reset', () => {
      anomalyDetector.reset();
      alertManager.reset();
      io.emit('alerts:state', alertManager.getActiveAlerts());
      io.emit('alerts:history', alertManager.getAlertHistory({ limit: 50 }));
      socket.emit('anomaly:reset-complete', { message: 'All anomaly data reset' });
    });

    // ==================== SETTINGS EVENTS ====================

    // Update settings
    socket.on('settings:update', (data) => {
      if (data.GROQ_API_KEY) {
        process.env.GROQ_API_KEY = data.GROQ_API_KEY;
      }
      if (data.MODEL) {
        process.env.MODEL = data.MODEL;
      }
      logger.info('Settings updated via socket');
      socket.emit('settings:updated', {
        success: true,
        message: 'Settings applied',
      });
    });

    // Get current settings/status
    socket.on('settings:get-status', () => {
      socket.emit('settings:status', {
        hasApiKey: !!process.env.GROQ_API_KEY,
        model: process.env.MODEL || 'llama-3.3-70b-versatile',
        projectPath: codeService.getProjectPath(),
      });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers, MONITORED_ENDPOINTS };
