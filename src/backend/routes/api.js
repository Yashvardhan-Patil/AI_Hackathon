const express = require('express');
const router = express.Router();
const groqService = require('../services/groqService');
const logger = require('../utils/logger');

// Chat with AI assistant
router.post('/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const result = await groqService.sendMessage(messages, context || {});
    res.json(result);
  } catch (error) {
    logger.error('Chat API error:', error.message);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Analyze logs
router.post('/analyze-logs', async (req, res) => {
  try {
    const { logContent, query } = req.body;

    if (!logContent) {
      return res.status(400).json({ error: 'Log content is required' });
    }

    const result = await groqService.analyzeLogs(logContent, query || '');
    res.json(result);
  } catch (error) {
    logger.error('Log analysis API error:', error.message);
    res.status(500).json({ error: 'Failed to analyze logs' });
  }
});

// Suggest fix
router.post('/suggest-fix', async (req, res) => {
  try {
    const { errorDescription, codeContext } = req.body;

    if (!errorDescription) {
      return res.status(400).json({ error: 'Error description is required' });
    }

    const result = await groqService.suggestFix(errorDescription, codeContext);
    res.json(result);
  } catch (error) {
    logger.error('Suggest fix API error:', error.message);
    res.status(500).json({ error: 'Failed to suggest fix' });
  }
});

// Check AI service status
router.get('/status', (req, res) => {
  const client = groqService.getClient();
  res.json({
    configured: !!client,
    model: process.env.MODEL || 'llama-3.3-70b-versatile',
    hasApiKey: !!process.env.GROQ_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
