const logger = require('../utils/logger');
const codeService = require('./codeService');

/**
 * Intent Router — Analyzes natural language messages and intelligently routes them
 * to file operations, command execution, or AI chat based on detected intent.
 * 
 * The user NEVER needs to use special commands. They just speak naturally.
 */
class IntentRouter {
  /**
   * Common file extensions for path detection
   */
  static FILE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|pyw|rb|go|java|rs|c|cpp|h|hpp|cs|php|swift|kt|scala|ex|exs|erl|lua|r|m|mm|pl|pm|sh|bash|zsh|fish|ps1|bat|cmd|json|yaml|yml|toml|ini|cfg|conf|xml|html|htm|xhtml|css|scss|sass|less|sql|db|sqlite|md|markdown|txt|log|env|gitignore|dockerfile|makefile|gradle|sbt|tf|vue|svelte|astro|mjs|cjs|mts|cts|dart|zig|nim|crystal|clj|cljs|edn|groovy|kt|kts|fs|fsx|ml|lhs|coffee|litcoffee|tsx|jsx)$/i;

  /**
   * Action keywords mapped to their canonical intent types
   */
  static READ_PATTERNS = [
    /\b(read|open|show|display|view|check|examine|inspect|look\s*at|get|fetch|load|dump|print|see|review|scan)\b/i,
    /\b(what'?s?\s+in|what\s+is\s+in|contents?\s+of)\b/i,
    /^(read|open|show|view)\s+(me\s+)?(the\s+)?/i,
  ];

  static FIX_PATTERNS = [
    /\b(fix|correct|repair|resolve|remedy|patch|solve|debug|troubleshoot)\b/i,
    /\b(fix|correct|solve)\s+(the\s+)?(bug|error|issue|problem|typo)\s+(in|of|with|on)\b/i,
  ];

  static WRITE_PATTERNS = [
    /\b(write|save|update|edit|change|modify|overwrite|replace)\b/i,
    /\b(update|edit|change)\s+(the\s+)?/i,
  ];

  static CREATE_PATTERNS = [
    /\b(create|make|generate|new|add|initialize|scaffold|build)\b/i,
    /^(create|make|generate|add)\s+(a\s+|an\s+|new\s+)?/i,
  ];

  static OPEN_IN_VSCODE_PATTERNS = [
    /\bopen\s+(in\s+)?(vscode|vs\s*code|code|editor|ide)\b/i,
    /\blaunch\s+(in\s+)?(vscode|vs\s*code|code|editor)\b/i,
  ];

  static RUN_PATTERNS = [
    /\b(run|execute|start|launch|invoke|call)\s+/i,
    /^(run|execute|start|launch)\s+/i,
  ];

  static ANALYZE_PATTERNS = [
    /\b(analyze|analyse|review|check|examine|investigate|diagnose|debug|refactor|optimize|improve)\b/i,
    /\b(is\s+there\s+(a\s+)?(bug|error|issue|problem))\b/i,
    /\b(what'?s?\s+wrong|what\s+is\s+wrong|why\s+(is|does|are))\b/i,
  ];

  static LIST_PATTERNS = [
    /\b(list|show|display)\s+(all\s+)?(files?|contents?|director(y|ies)|folder)\b/i,
    /^(what|which)\s+(files?|director|folder)/i,
  ];

  /**
   * Process a user message and return the appropriate action + extra context for AI
   */
  static async processMessage(message, projectPath) {
    if (!message || !message.trim()) {
      return { type: 'chat', query: message };
    }

    const trimmed = message.trim();

    // First check for file listing request (doesn't need a specific file)
    if (this.matchesPattern(trimmed, this.LIST_PATTERNS)) {
      const listResult = codeService.listFiles('', 2);
      if (listResult.success && listResult.files.length > 0) {
        const fileList = listResult.files
          .filter(f => f.type === 'file')
          .map(f => `  - ${f.relativePath}`)
          .join('\n');
        return {
          type: 'chat',
          query: trimmed,
          fileContext: `Project files at ${projectPath || 'current directory'}:\n${fileList}`,
        };
      }
    }

    // Check for VSCode open intent
    const vscodeMatch = this.matchesPattern(trimmed, this.OPEN_IN_VSCODE_PATTERNS);
    if (vscodeMatch) {
      const filePath = this.extractFilePath(trimmed) || projectPath;
      if (filePath || projectPath) {
        const targetPath = filePath || projectPath;
        const openResult = await codeService.openInVSCode(targetPath);
        return {
          type: 'vscode',
          query: trimmed,
          operationResult: openResult,
          secondaryQuery: this.getRemainingTextAfterAction(trimmed, ['open']),
        };
      }
    }

    // Check for file read intent
    const readMatch = this.matchesPattern(trimmed, this.READ_PATTERNS);
    if (readMatch) {
      const filePath = this.extractFilePath(trimmed);
      if (filePath) {
        const readResult = codeService.readFile(filePath);
        if (readResult.success) {
          const remainingText = this.getRemainingTextAfterAction(trimmed, ['read', 'open', 'show', 'display', 'view', 'check', 'examine', 'inspect', 'look at', 'get', 'fetch', 'load', 'dump', 'print', 'see', 'review', 'scan']);
          return {
            type: 'read',
            query: remainingText || `Analyze this file for issues`,
            filePath: readResult.relativePath,
            fileContent: readResult.content,
            operationResult: readResult,
          };
        }
        // File not found - still send to AI but note the issue
        return {
          type: 'chat',
          query: trimmed,
          fileContext: `Note: The file "${filePath}" was not found in the project.`,
        };
      }
      // Read intent but no file path found - check if maybe they mean "read the project"
      if (/project|workspace|folder|directory/i.test(trimmed)) {
        const listResult = codeService.listFiles('', 2);
        if (listResult.success) {
          const fileList = listResult.files
            .filter(f => f.type === 'file')
            .slice(0, 30)
            .map(f => `  - ${f.relativePath}`)
            .join('\n');
          return {
            type: 'chat',
            query: trimmed,
            fileContext: `Project files at ${projectPath || 'current directory'}:\n${fileList}`,
          };
        }
      }
    }

    // Check for fix intent
    const fixMatch = this.matchesPattern(trimmed, this.FIX_PATTERNS);
    if (fixMatch) {
      const filePath = this.extractFilePath(trimmed);
      if (filePath) {
        const readResult = codeService.readFile(filePath);
        if (readResult.success) {
          const remainingText = this.getRemainingTextAfterAction(trimmed, ['fix', 'correct', 'repair', 'resolve', 'remedy', 'patch', 'solve', 'debug', 'troubleshoot']);
          return {
            type: 'fix',
            query: remainingText || `Fix bugs and issues in this file`,
            filePath: readResult.relativePath,
            fileContent: readResult.content,
            operationResult: readResult,
          };
        }
        return {
          type: 'chat',
          query: trimmed,
          fileContext: `Note: The file "${filePath}" was not found.`,
        };
      }
      // No file specified with fix - check if they mean the main project files
      const projectFiles = codeService.listFiles('', 1);
      if (projectFiles.success && projectFiles.files.length > 0) {
        const sourceFiles = projectFiles.files
          .filter(f => f.type === 'file' && !f.name.startsWith('.'))
          .slice(0, 5)
          .map(f => f.relativePath);
        if (sourceFiles.length > 0) {
          // Try reading the most relevant source file
          const mainFile = sourceFiles.find(f => /main|index|app|server/i.test(f)) || sourceFiles[0];
          const readResult = codeService.readFile(mainFile);
          if (readResult.success) {
            return {
              type: 'fix',
              query: trimmed,
              filePath: readResult.relativePath,
              fileContent: readResult.content,
              operationResult: readResult,
            };
          }
        }
      }
    }

    // Check for create intent
    const createMatch = this.matchesPattern(trimmed, this.CREATE_PATTERNS);
    if (createMatch) {
      const filePath = this.extractFilePath(trimmed);
      if (filePath) {
        const remainingText = this.getRemainingTextAfterAction(trimmed, ['create', 'make', 'generate', 'new', 'add', 'initialize', 'scaffold', 'build']);
        // Check if user specified content with "with" or "containing" or "that"
        const contentMatch = remainingText.match(/\b(with|containing|that\s+(has|does)|where\s+it)\s+(.+)$/i);
        let content = `# ${filePath.split('/').pop()}\n# Created by API Debugging Copilot\n`;
        let userQuery = remainingText;

        if (contentMatch) {
          content = contentMatch[contentMatch.length - 1].trim();
          userQuery = remainingText.slice(0, contentMatch.index).trim();
        }

        return {
          type: 'create',
          query: userQuery || `Create a complete ${filePath.split('.').pop()} file`,
          filePath: filePath,
          fileContent: content,
          intent: 'create',
        };
      }
      // "create a file called X" or "create file X" pattern
      const calledMatch = trimmed.match(/(?:called|named)\s+([^\s.,!?]+(?:\.[^\s.,!?]+)?)/i);
      if (calledMatch) {
        const detectedPath = calledMatch[1];
        return {
          type: 'create',
          query: trimmed,
          filePath: detectedPath,
          fileContent: `# ${detectedPath.split('/').pop()}\n# Created by API Debugging Copilot\n`,
          intent: 'create',
        };
      }
    }

    // Check for run intent (must come after create since "run" could conflict)
    const runMatch = this.matchesPattern(trimmed, this.RUN_PATTERNS);
    if (runMatch) {
      const command = this.extractCommand(trimmed);
      if (command) {
        const execResult = await codeService.executeCommand(command);
        return {
          type: 'run',
          query: trimmed,
          command: command,
          operationResult: execResult,
        };
      }
    }

    // Check for write/edit intent
    const writeMatch = this.matchesPattern(trimmed, this.WRITE_PATTERNS);
    if (writeMatch) {
      const filePath = this.extractFilePath(trimmed);
      if (filePath) {
        const remainingText = this.getRemainingTextAfterAction(trimmed, ['write', 'save', 'update', 'edit', 'change', 'modify', 'overwrite', 'replace']);
        // Extract content after "with" or "to" or "containing"
        const contentMatch = remainingText.match(/\b(with|to|containing)\s+(.+)$/i);
        let content = null;
        let userQuery = remainingText;
        if (contentMatch) {
          content = contentMatch[2].trim();
          userQuery = remainingText.slice(0, contentMatch.index).trim();
        }
        // Read current content first for context
        const readResult = codeService.readFile(filePath);
        return {
          type: 'write',
          query: userQuery || `Update this file`,
          filePath: filePath,
          fileContent: readResult.success ? readResult.content : '',
          newContent: content,
          intent: 'write',
          operationResult: readResult,
        };
      }
    }

    // Default: send to AI chat with any detected file context
    const filePath = this.extractFilePath(trimmed);
    if (filePath) {
      const readResult = codeService.readFile(filePath);
      if (readResult.success) {
        return {
          type: 'chat',
          query: trimmed,
          filePath: readResult.relativePath,
          fileContent: readResult.content,
        };
      }
    }

    // If project is selected but no specific file mentioned, still pass context
    if (projectPath) {
      return {
        type: 'chat',
        query: trimmed,
        projectContext: `Current project: ${projectPath}`,
      };
    }

    return { type: 'chat', query: trimmed };
  }

  /**
   * Extract file path from natural language.
   * Looks for words with file extensions or path separators.
   */
  static extractFilePath(text) {
    // Try to find paths in quotes first
    const quoteMatch = text.match(/["'`]([^"'`]+\.[a-zA-Z0-9]+)["'`]/);
    if (quoteMatch) return quoteMatch[1];

    // Try to find paths after "file" keyword
    const fileKeywordMatch = text.match(/(?:file|script)\s+(?:called|named|at|located\s+at|in|from)?\s*["'`]?([^\s"'`,!?;:]+(?:\.[a-zA-Z0-9]+))["'`]?/i);
    if (fileKeywordMatch) return fileKeywordMatch[1];

    // Try to find paths after action words
    const actionMatch = text.match(/(?:read|open|show|fix|check|view|run|execute|create|make|write|update|edit|delete|remove)\s+(?:me\s+)?(?:the\s+)?(?:file\s+)?(?:called\s+|named\s+)?["'`]?([^\s"'`,!?;:]+(?:\.[a-zA-Z0-9]+))["'`]?/i);
    if (actionMatch) return actionMatch[1];

    // Generic: find any word with a file extension
    const extMatch = text.match(/([^\s"'`,!?;:()]+\.(?:js|jsx|ts|tsx|py|rb|go|java|rs|cpp|c|cs|php|swift|kt|json|yaml|yml|toml|xml|html|css|scss|sql|md|txt|log|sh|bash|ps1|bat|exe|dll|so|env|gitignore|dockerfile|vue|svelte|astro|mjs|cjs|tf|dart|zig|nim|clj|cljs|edn|groovy|fs|fsx|ml|lhs|coffee|litcoffee|tsx|jsx|mts|cts))/i);
    if (extMatch) return extMatch[1];

    // Try paths with slashes
    const slashMatch = text.match(/([^\s"'`,!?;:()]+\/[^\s"'`,!?;:()]+\.[a-zA-Z0-9]+)/);
    if (slashMatch) return slashMatch[1];

    // Try Windows paths with backslashes
    const backslashMatch = text.match(/([^\s"'`,!?;:()]+\\[^\s"'`,!?;:()]+\.[a-zA-Z0-9]+)/);
    if (backslashMatch) return backslashMatch[1];

    return null;
  }

  /**
   * Extract command from a "run X" or "execute X" statement
   */
  static extractCommand(text) {
    // Remove action prefixes
    const cmdMatch = text.match(/(?:run|execute|start|launch)\s+(.+)/i);
    if (cmdMatch) {
      let command = cmdMatch[1].trim();
      // Remove trailing punctuation
      command = command.replace(/[.,!?;:]+$/, '').trim();
      // Remove "please" or other polite words at the end
      command = command.replace(/\s+(please|thanks|thank\s*you|pls)$/i, '').trim();
      return command || null;
    }
    return null;
  }

  /**
   * Get remaining text after removing the action keyword
   */
  static getRemainingTextAfterAction(text, actions) {
    let remaining = text;
    for (const action of actions) {
      // Try to remove action prefix
      const regex = new RegExp(`^.*?\\b${action}\\b\\s*(?:me\\s+)?(?:the\\s+)?(?:file\\s+)?(?:called\\s+|named\\s+)?`, 'i');
      remaining = remaining.replace(regex, '').trim();
    }
    // Remove extracted file path at the start
    remaining = remaining.replace(/^[^\s"'`,!?;:()]*\.[a-zA-Z0-9]+\s*/, '').trim();
    // Remove punctuation at start
    remaining = remaining.replace(/^[,\s]+/, '').trim();
    return remaining || '';
  }

  /**
   * Check if text matches any of the given patterns
   */
  static matchesPattern(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
  }
}

module.exports = IntentRouter;
