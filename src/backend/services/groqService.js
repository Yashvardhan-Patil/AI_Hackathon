const Groq = require('groq-sdk');
const logger = require('../utils/logger');

let groqClient = null;

function getClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'gsk_your_groq_api_key_here') {
      return null;
    }
    // CRITICAL: Disable SDK's built-in retries (default: 2 retries for 429 errors).
    // The SDK's retries fire rapidly (~500ms apart), compounding 3+ calls per queue slot.
    // Our own queue handles ALL retry logic with proper 2.5s spacing.
    // Also: using small model (8B) for 14,400 RPD instead of 1,000 RPD on 70B.
    groqClient = new Groq({ apiKey, maxRetries: 0 });
  }
  return groqClient;
}

// ========================
// GLOBAL RATE-LIMIT QUEUE
// ========================
// Enforces minimum gap between API calls to stay well under Groq's
// 30 RPM free-tier limit. Also auto-retries 429 (rate limit) errors
// with exponential backoff instead of failing immediately.
//
// SAFETY FEATURES:
// - Safety timeout: if a request takes > 30s, isProcessing resets to
//   prevent permanent queue lockup
// - Max queue size: prevents unbounded memory growth
// - Non-object error handling: crashes in catch blocks won't break the queue
//
// All calls to sendMessage() go through this queue transparently.
// ========================
const requestQueue = [];
let isProcessing = false;
let lastRequestTime = 0;
let processingSince = 0;        // Timestamp when current request started — for safety timeout
const MINIMUM_GAP_MS = 2500;    // ~24 RPM max — conservative margin well under 30 RPM
const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 20;      // Reject oldest if queue grows too large
const SAFETY_TIMEOUT_MS = 30000; // Reset isProcessing if a request takes > 30s

/**
 * Queue an API request and return a promise that resolves with the result.
 * Requests are processed one at a time with MINIMUM_GAP_MS between them.
 */
function enqueueRequest(fn) {
  return new Promise((resolve, reject) => {
    // Prevent unbounded queue growth — reject oldest item if queue is too large
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
      const oldest = requestQueue.shift();
      if (oldest && oldest.reject) {
        oldest.reject(new Error('Queue full — request dropped. Try again.'));
      }
    }
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

/**
 * Process the queue: send one request, wait MINIMUM_GAP_MS, then send the next.
 */
function processQueue() {
  // Safety: if processing has been going for too long, reset the flag
  if (isProcessing && processingSince > 0 && (Date.now() - processingSince) > SAFETY_TIMEOUT_MS) {
    logger.warn('Groq queue: Safety timeout triggered — resetting isProcessing');
    isProcessing = false;
  }

  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  processingSince = Date.now();

  const processNext = async () => {
    if (requestQueue.length === 0) {
      isProcessing = false;
      processingSince = 0;
      return;
    }

    // Enforce minimum gap since last request
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MINIMUM_GAP_MS) {
      await new Promise(r => setTimeout(r, MINIMUM_GAP_MS - elapsed));
    }

    const item = requestQueue.shift();
    if (!item || typeof item.fn !== 'function') {
      // Invalid queue item — skip and continue
      setTimeout(() => processNext(), 100);
      return;
    }

    const { fn, resolve, reject } = item;

    // Execute with retry logic for 429 errors
    const executeWithRetry = async (attempt = 0) => {
      try {
        lastRequestTime = Date.now();
        const result = await fn();
        resolve(result);
      } catch (err) {
        // Handle non-object errors safely (e.g., string errors, null, undefined)
        const errStatus = (err && typeof err === 'object' && err.status) || 0;
        const errMsg = (err && typeof err === 'object' && err.message) || String(err || 'Unknown error');

        // Retry on transient errors: 429 (rate limit), 408 (timeout),
        // 409 (conflict), >=500 (server error), or connection errors (status 0)
        const isTransientError = errStatus === 429 || errStatus === 408 || errStatus === 409 || errStatus >= 500 || errStatus === 0;

        if (isTransientError && attempt < MAX_RETRIES) {
          const backoffMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
          const statusLabel = errStatus || 'connection';
          logger.warn(`Groq transient error (${statusLabel}). Retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms`);
          await new Promise(r => setTimeout(r, backoffMs));
          return executeWithRetry(attempt + 1);
        }
        reject(err);
      }
    };

    await executeWithRetry();

    // Schedule next item
    setTimeout(() => processNext(), 100);
  };

  processNext();
}

const SYSTEM_PROMPT = `You are an expert AI coding and debugging copilot. You have **real, automatic file access** — when the user talks about a file, the system reads it for you and sends you the content.

## How File Access Works (Automatic)
- When the user says "read file X", the **system reads the file** and passes its content to you in the context
- When the user says "fix this file" or "fix the bug in X", the **system reads the file** and passes its content + your response to the backend to apply fixes
- When the user says "create file X" or "make a new file called X", you must:
  1. **Output the COMPLETE file content inside a code block** (the system will extract it and write the file)
  2. The code block MUST use the format: \`\`\`language\n... full file content ...\n\`\`\`
- When the user says "run X" or "execute X", the **system runs the command** and sends you the output
- When the user says "open X in VSCode", the **system opens it** in their editor

## Your Role
1. **Read requests** — If file content is provided, analyze it. If not, tell the user what you'd look for.
2. **Fix requests** — Analyze the file content provided to you, identify bugs, and suggest fixes with COMPLETE code snippets inside code blocks.
3. **Create requests** — Generate the full file content inside a \`\`\` code block. Make it COMPLETE and working.
4. **General questions** — Answer like a senior developer helping a teammate.

## Response Guidelines
When analyzing issues:
1. Identify the root cause of errors
2. Explain what went wrong in simple terms
3. Provide specific, actionable fixes with COMPLETE code snippets
4. Output code blocks using: \`\`\`language\n... code ...\n\`\`\`
5. Rate severity as CRITICAL, HIGH, MEDIUM, or LOW

Use this format when relevant:
SEVERITY: CRITICAL|HIGH|MEDIUM|LOW
SUGGESTION: First step to fix
SUGGESTION: Second step

Available context includes:
- File contents (auto-provided when the user mentions a file)
- Project logs and error messages
- API response status codes
- Stack traces
- Command execution output`;

async function sendMessage(messages, contextData = {}) {
  const client = getClient();

  if (!client) {
    return {
      type: 'error',
      content: 'Groq API key is not configured. Please add your API key in Settings.',
      severity: 'info',
      suggestions: [
        'Go to Settings tab',
        'Enter your Groq API key',
        'Get a key at https://console.groq.com',
      ],
    };
  }

  try {
    // Use llama-3.1-8b-instant by default — it has 14,400 RPD (vs 1,000 RPD for 70B)
    // and same 30 RPM. Much lower chance of hitting daily rate limits.
    const model = process.env.MODEL || 'llama-3.1-8b-instant';

    const formattedMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    if (contextData.logs) {
      formattedMessages.push({
        role: 'system',
        content: `Relevant logs for context:\n${contextData.logs}`,
      });
    }

    if (contextData.apiErrors) {
      formattedMessages.push({
        role: 'system',
        content: `API errors detected:\n${contextData.apiErrors}`,
      });
    }

    if (contextData.anomalyAnalysis) {
      formattedMessages.push({
        role: 'system',
        content: `You are analyzing an API anomaly. Focus on:\n1. Identifying the ROOT CAUSE of the issue\n2. Assessing the IMPACT on users\n3. Providing actionable FIX steps\n4. Suggesting PREVENTION measures\n\nBe concise and specific. Use this format when relevant:\nSEVERITY: CRITICAL|HIGH|MEDIUM|LOW\nROOT_CAUSE: explanation\nIMPACT: user impact description\nFIX: step-by-step fix\nSUGGESTION: prevention measure`,
      });
    }

    if (contextData.batchAnalysis) {
      formattedMessages.push({
        role: 'system',
        content: `You are analyzing a batch of API anomalies. Provide:\n1. Pattern analysis - are these related?\n2. Root cause for each distinct issue\n3. Prioritized fix recommendations\n\nGroup related issues together. Use the format:\n---\nSEVERITY: CRITICAL|HIGH|MEDIUM|LOW\nROOT_CAUSE: explanation\nIMPACT: user impact\nFIX: step\nSUGGESTION: prevention\n---`,
      });
    }

    // Send through the rate-limit queue to prevent burst overload
    const completion = await enqueueRequest(() => client.chat.completions.create({
      messages: formattedMessages,
      model,
      temperature: 0.3,
      max_tokens: 2048,
      top_p: 0.95,
      stream: false,
    }));

    const responseText = completion.choices[0]?.message?.content || '';

    // Parse severity and suggestions from response
    const analysis = parseAIResponse(responseText);

    return {
      type: 'analysis',
      content: responseText,
      ...analysis,
    };
  } catch (error) {
    // Log the FULL error for debugging — especially important to distinguish
    // between per-minute (30 RPM) and per-day (1,000 RPD) rate limits
    const errStatus = (error && typeof error === 'object' && error.status) || 0;
    const errMsg = (error && typeof error === 'object' && error.message) || String(error || 'Unknown error');
    const errType = (error && typeof error === 'object' && error.type) || '';
    const errCode = (error && typeof error === 'object' && error.code) || '';
    logger.error(`Groq API error [status=${errStatus}, type=${errType}, code=${errCode}]: ${errMsg}`);

    if (errStatus === 401) {
      return {
        type: 'error',
        content: 'Invalid Groq API key. Please check your API key in Settings.',
        severity: 'error',
        suggestions: ['Update your API key in Settings'],
      };
    }

    if (errStatus === 429) {
      // Check if this is a per-day or per-minute limit by examining the error message
      const isDailyLimit = /day|daily/i.test(errMsg);
      // Show the correct daily limit based on current model
      const model = process.env.MODEL || 'llama-3.1-8b-instant';
      const is8B = model.includes('8b') || model.includes('8B') || model.includes('9b') || model.includes('9B') || model.includes('7b') || model.includes('7B');
      const dailyLimit = is8B ? '14,400' : '1,000';
      return {
        type: 'error',
        content: isDailyLimit
          ? `Groq daily request limit (${dailyLimit}/day for ${model}) reached. The limit resets ~24h after first daily request. Check console.groq.com or upgrade your plan.`
          : 'Rate limit exceeded (30 req/min). Please wait a moment and try again.',
        severity: 'warning',
        suggestions: isDailyLimit
          ? [`Switch to a model with higher daily limit (e.g. llama-3.1-8b-instant with 14,400/day)`, 'Wait for daily reset', 'Upgrade your Groq plan for higher limits', 'Check usage at console.groq.com']
          : ['Wait a few seconds', 'Check your Groq plan limits'],
      };
    }

    return {
      type: 'error',
      content: `Failed to reach Groq AI: ${errMsg}`,
      severity: 'error',
      suggestions: ['Check your internet connection', 'Verify Groq service status'],
    };
  }
}

function parseAIResponse(text) {
  const severityMatch = text.match(/SEVERITY:\s*(CRITICAL|HIGH|MEDIUM|LOW)/i);
  const severity = severityMatch ? severityMatch[1].toLowerCase() : 'medium';

  const suggestions = [];
  const suggestionRegex = /SUGGESTION:\s*(.+?)(?:\n|$)/gi;
  let match;
  while ((match = suggestionRegex.exec(text)) !== null) {
    suggestions.push(match[1].trim());
  }

  const hasFix = /\bfix\b|\bsolution\b|\bresolve\b|\bremedy\b/i.test(text);
  const hasRootCause = /\broot cause\b|\bcause\b|\bwhy\b|\breason\b/i.test(text);

  return {
    severity,
    hasFix,
    hasRootCause,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

async function analyzeLogs(logContent, userQuery) {
  const messages = [
    {
      role: 'user',
      content: userQuery
        ? `Context from logs:\n${logContent}\n\nQuestion: ${userQuery}`
        : `Analyze these logs and identify any issues:\n${logContent}`,
    },
  ];

  return sendMessage(messages, { logs: logContent });
}

async function suggestFix(errorDescription, codeContext) {
  const messages = [
    {
      role: 'user',
      content: `Error: ${errorDescription}\n\nCode context:\n${codeContext || 'Not provided'}\n\nPlease provide a fix for this issue. Include code examples.`,
    },
  ];

  return sendMessage(messages);
}

module.exports = {
  sendMessage,
  analyzeLogs,
  suggestFix,
  getClient,
};
