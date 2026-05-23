const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Set project path
router.post('/select', (req, res) => {
  const { projectPath } = req.body;

  if (!projectPath) {
    return res.status(400).json({ error: 'Project path is required' });
  }

  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Project path does not exist' });
  }

  const stats = fs.statSync(projectPath);
  if (!stats.isDirectory()) {
    return res.status(400).json({ error: 'Path must be a directory' });
  }

  process.env.PROJECT_PATH = projectPath;

  res.json({
    success: true,
    path: projectPath,
    message: 'Project path set successfully',
  });
});

// Get current project info
router.get('/info', (req, res) => {
  const projectPath = process.env.PROJECT_PATH;

  if (!projectPath) {
    return res.json({ selected: false });
  }

  try {
    const files = fs.readdirSync(projectPath);
    const packageJsonPath = path.join(projectPath, 'package.json');
    let projectInfo = {};

    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      projectInfo = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
      };
    }

    res.json({
      selected: true,
      path: projectPath,
      ...projectInfo,
      fileCount: files.length,
      hasNodeModules: fs.existsSync(path.join(projectPath, 'node_modules')),
      hasGit: fs.existsSync(path.join(projectPath, '.git')),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Project info error:', error.message);
    res.status(500).json({ error: 'Failed to read project info' });
  }
});

// List project files (with filtering)
router.get('/files', (req, res) => {
  const projectPath = process.env.PROJECT_PATH;
  const { pattern, maxDepth } = req.query;

  if (!projectPath) {
    return res.status(400).json({ error: 'No project path selected' });
  }

  try {
    const depth = parseInt(maxDepth) || 2;
    const files = [];

    function walkDir(dirPath, currentDepth) {
      if (currentDepth > depth) return;

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
          }

          if (entry.isDirectory()) {
            walkDir(fullPath, currentDepth + 1);
          } else if (entry.isFile()) {
            if (!pattern || entry.name.includes(pattern)) {
              files.push({
                name: entry.name,
                path: fullPath,
                relativePath: path.relative(projectPath, fullPath),
                size: fs.statSync(fullPath).size,
              });
            }
          }
        }
      } catch (err) {
        // Skip permission errors
      }
    }

    walkDir(projectPath, 0);
    res.json({ files, count: files.length });
  } catch (error) {
    logger.error('List files error:', error.message);
    res.status(500).json({ error: 'Failed to list project files' });
  }
});

// Read a specific file
router.post('/read-file', (req, res) => {
  const { filePath } = req.body;
  const projectPath = process.env.PROJECT_PATH;

  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }

  try {
    const resolvedPath = path.resolve(projectPath || '', filePath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const stats = fs.statSync(resolvedPath);

    res.json({
      path: resolvedPath,
      content,
      size: stats.size,
      modifiedAt: stats.mtime,
      extension: path.extname(resolvedPath),
    });
  } catch (error) {
    logger.error('Read file error:', error.message);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

module.exports = router;
