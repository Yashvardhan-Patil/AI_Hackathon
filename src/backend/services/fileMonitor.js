const chokidar = require('chokidar');
const path = require('path');
const logger = require('../utils/logger');
const { parseLogFile, extractErrors } = require('./logParser');

class FileMonitor {
  constructor(io) {
    this.io = io;
    this.watchers = new Map();
    this.watchedPaths = new Set();
    this.logCache = new Map();
  }

  startWatching(dirPath, options = {}) {
    const resolvedPath = path.resolve(dirPath);

    if (this.watchedPaths.has(resolvedPath)) {
      logger.info(`Already watching: ${resolvedPath}`);
      return { success: true, message: 'Already watching this directory' };
    }

    try {
      const watcher = chokidar.watch(resolvedPath, {
        ignored: /(node_modules|\.git|dist|build|\.next)/,
        persistent: true,
        ignoreInitial: true,
        depth: options.depth || 3,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });

      watcher
        .on('add', (filePath) => this.handleFileEvent('add', filePath))
        .on('change', (filePath) => this.handleFileEvent('change', filePath))
        .on('unlink', (filePath) => this.handleFileEvent('unlink', filePath))
        .on('error', (error) => {
          logger.error(`File watcher error for ${resolvedPath}:`, error.message);
          this.emitToUI('monitor:error', {
            path: resolvedPath,
            error: error.message,
          });
        });

      this.watchers.set(resolvedPath, watcher);
      this.watchedPaths.add(resolvedPath);

      logger.info(`Started watching: ${resolvedPath}`);
      this.emitToUI('monitor:started', {
        path: resolvedPath,
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: `Watching ${resolvedPath}` };
    } catch (error) {
      logger.error(`Failed to start watching ${resolvedPath}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  stopWatching(dirPath) {
    const resolvedPath = path.resolve(dirPath);
    const watcher = this.watchers.get(resolvedPath);

    if (watcher) {
      watcher.close();
      this.watchers.delete(resolvedPath);
      this.watchedPaths.delete(resolvedPath);
      this.logCache.delete(resolvedPath);

      logger.info(`Stopped watching: ${resolvedPath}`);
      this.emitToUI('monitor:stopped', {
        path: resolvedPath,
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: `Stopped watching ${resolvedPath}` };
    }

    return { success: false, message: 'Not watching this directory' };
  }

  handleFileEvent(eventType, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const logExtensions = ['.log', '.txt', '.out', '.err'];

    if (logExtensions.includes(ext)) {
      const result = parseLogFile(filePath);

      if (result.entries && result.entries.length > 0) {
        const newErrors = result.entries.filter((e) => e.type === 'error');

        this.emitToUI('logs:updated', {
          file: filePath,
          fileName: path.basename(filePath),
          event: eventType,
          stats: result.stats,
          timestamp: new Date().toISOString(),
        });

        if (newErrors.length > 0) {
          this.emitToUI('logs:errors-detected', {
            file: filePath,
            errors: newErrors.slice(-5),
            count: newErrors.length,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  emitToUI(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  getWatchedPaths() {
    return Array.from(this.watchedPaths);
  }

  stopAll() {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      logger.info(`Stopped watching: ${path}`);
    }
    this.watchers.clear();
    this.watchedPaths.clear();
    this.logCache.clear();
  }
}

module.exports = FileMonitor;
