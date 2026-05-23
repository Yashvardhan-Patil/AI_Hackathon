const groqService = require('./groqService');
const logParser = require('./logParser');
const FileMonitor = require('./fileMonitor');
const codeService = require('./codeService');
const IntentRouter = require('./intentRouter');
const logger = require('../utils/logger');

let fileMonitor = null;

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

          // ===== FIX FILE — read + AI analyzes + suggests fix =====
          case 'fix':
            // Inject file content directly into messages so AI can analyze it
            const fixMessages = [
              { role: 'system', content: `The user wants to fix this file. File content of ${intent.filePath}:\n\`\`\`\n${intent.fileContent}\n\`\`\`\n\nIdentify bugs, errors, or issues. Suggest specific fixes.\n\n${intent.query ? `User's specific request: ${intent.query}` : ''}` },
              ...(data.messages || []),
            ];
            result = await groqService.sendMessage(fixMessages, { query: intent.query || `Fix bugs in ${intent.filePath}` });
            result.filePath = intent.filePath;
            result.fileContent = intent.fileContent;
            result.actionType = 'fix';
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
    socket.on('project:select', (data) => {
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

        socket.emit('project:selected', {
          path: data.path,
          ...result,
          starterFileCreated: createResult.success,
          starterFilePath: createResult.success ? createResult.relativePath : null,
          starterFileMessage: createResult.success ? 'Created example/first.py with To-Do List app' : null,
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

    // ==================== HEALTH EVENTS ====================

    // API health check simulation
    socket.on('health:check', () => {
      const healthData = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        monitoredEndpoints: generateMockEndpoints(),
      };
      socket.emit('health:status', healthData);
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

function generateMockEndpoints() {
  const endpoints = [
    { method: 'GET', path: '/api/users', status: 'healthy', latency: '45ms', lastChecked: new Date().toISOString() },
    { method: 'POST', path: '/api/users', status: 'healthy', latency: '120ms', lastChecked: new Date().toISOString() },
    { method: 'GET', path: '/api/products', status: 'healthy', latency: '30ms', lastChecked: new Date().toISOString() },
    { method: 'PUT', path: '/api/orders/:id', status: 'degraded', latency: '350ms', lastChecked: new Date().toISOString() },
    { method: 'DELETE', path: '/api/cache/flush', status: 'down', latency: '5000ms', lastChecked: new Date().toISOString() },
    { method: 'GET', path: '/api/analytics', status: 'healthy', latency: '60ms', lastChecked: new Date().toISOString() },
    { method: 'POST', path: '/api/auth/login', status: 'healthy', latency: '85ms', lastChecked: new Date().toISOString() },
    { method: 'GET', path: '/api/notifications', status: 'degraded', latency: '280ms', lastChecked: new Date().toISOString() },
  ];

  return endpoints;
}

module.exports = { setupSocketHandlers };
