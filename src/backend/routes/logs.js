const express = require('express');
const router = express.Router();
const logParser = require('../services/logParser');
const logger = require('../utils/logger');

// Parse a log file
router.get('/parse', (req, res) => {
  const { filePath, maxLines } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath query parameter is required' });
  }

  const result = logParser.parseLogFile(filePath, parseInt(maxLines) || 5000);
  res.json(result);
});

// Scan directory for log files
router.get('/scan', (req, res) => {
  const { dirPath } = req.query;

  if (!dirPath) {
    return res.status(400).json({ error: 'dirPath query parameter is required' });
  }

  const result = logParser.scanDirectory(dirPath);
  res.json(result);
});

// Extract errors from log content (POST)
router.post('/extract-errors', (req, res) => {
  const { content, maxErrors } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Log content is required' });
  }

  const errors = logParser.extractErrors(content, parseInt(maxErrors) || 20);
  res.json({ errors, count: errors.length });
});

// Get log file stats
router.get('/stats', (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath query parameter is required' });
  }

  const result = logParser.parseLogFile(filePath);
  res.json(result.stats || { total: 0, errors: 0, warnings: 0, info: 0 });
});

module.exports = router;
