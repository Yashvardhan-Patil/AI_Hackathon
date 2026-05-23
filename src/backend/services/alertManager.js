const logger = require('../utils/logger');

/**
 * AlertManager — Manages alert lifecycle:
 * - Groups similar alerts by fingerprint
 * - Deduplicates recurring alerts
 * - Counts occurrences and tracks frequency
 * - Assigns and escalates severity levels
 * - Stores alert history for reporting
 * - Auto-resolves stale alerts
 */
class AlertManager {
  constructor() {
    this.activeAlerts = new Map();   // fingerprint -> Alert object
    this.alertHistory = [];          // Historical alerts (resolved/expired)
    this.config = {
      maxHistorySize: 500,            // Max historical alerts to keep
      autoResolveAfterMs: 30 * 60 * 1000,  // Auto-resolve after 30 min without recurrence
      escalationThresholds: {
        critical: { count: 10, windowMs: 5 * 60 * 1000 },  // 10 in 5 min = critical
        high: { count: 5, windowMs: 10 * 60 * 1000 },       // 5 in 10 min = high
        medium: { count: 3, windowMs: 15 * 60 * 1000 },     // 3 in 15 min = medium
      },
    };
    this.alertCounter = 0;

    // Start auto-resolve checker
    this._startAutoResolveChecker();
  }

  /**
   * Process a new anomaly into an alert
   */
  processAnomaly(anomaly) {
    if (!anomaly || !anomaly.type) return null;

    const fingerprint = this._createAlertFingerprint(anomaly);
    const now = Date.now();

    let alert = this.activeAlerts.get(fingerprint);

    if (alert) {
      // Update existing alert
      alert.count++;
      alert.lastSeen = now;
      alert.lastAnomaly = anomaly;
      alert.severity = this._computeSeverity(alert);
      alert.duration = Math.round((now - alert.firstSeen) / 1000);

      // Add timestamp to occurrences
      alert.occurrences.push(now);
      if (alert.occurrences.length > 100) {
        alert.occurrences.shift();
      }

      // Check for escalation
      if (alert.severity !== alert.previousSeverity) {
        alert.escalated = true;
        alert.escalatedAt = now;
        alert.escalatedFrom = alert.previousSeverity;
        alert.previousSeverity = alert.severity;
      }

      logger.info(`AlertManager: Updated alert (×${alert.count}) — ${anomaly.type}/${alert.severity}: ${(anomaly.message || anomaly.alertMessage || '').substring(0, 80)}`);
    } else {
      // Create new alert
      this.alertCounter++;
      alert = {
        id: `alert-${this.alertCounter}-${Date.now()}`,
        fingerprint,
        type: anomaly.type,
        severity: anomaly.severity || 'medium',
        previousSeverity: anomaly.severity || 'medium',
        message: anomaly.message || anomaly.alertMessage || '',
        endpoint: anomaly.endpoint || 'unknown',
        firstSeen: now,
        lastSeen: now,
        count: 1,
        occurrences: [now],
        duration: 0,
        escalated: false,
        resolved: false,
        anomaly,
        lastAnomaly: anomaly,
        tags: this._extractTags(anomaly),
        source: anomaly.source || 'log_monitor',
      };

      this.activeAlerts.set(fingerprint, alert);
      logger.info(`AlertManager: Created new alert — ${anomaly.type}/${alert.severity}: ${(anomaly.message || anomaly.alertMessage || '').substring(0, 80)}`);
    }

    return alert;
  }

  /**
   * Resolve an alert manually
   */
  resolveAlert(alertId) {
    for (const [fingerprint, alert] of this.activeAlerts) {
      if (alert.id === alertId) {
        this._resolveAlert(fingerprint, alert);
        return { success: true, alertId };
      }
    }
    return { success: false, error: 'Alert not found' };
  }

  /**
   * Resolve all alerts for a specific endpoint
   */
  resolveAlertsForEndpoint(endpoint) {
    let count = 0;
    for (const [fingerprint, alert] of this.activeAlerts) {
      if (alert.endpoint === endpoint) {
        this._resolveAlert(fingerprint, alert);
        count++;
      }
    }
    return { success: true, resolvedCount: count };
  }

  /**
   * Get all active (unresolved) alerts
   */
  getActiveAlerts(options = {}) {
    let alerts = Array.from(this.activeAlerts.values());

    // Filter by severity
    if (options.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }

    // Filter by type
    if (options.type) {
      alerts = alerts.filter(a => a.type === options.type);
    }

    // Filter by endpoint
    if (options.endpoint) {
      alerts = alerts.filter(a => a.endpoint === options.endpoint);
    }

    // Sort: by severity (critical first), then by count (most frequent first)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
      if (sevDiff !== 0) return sevDiff;
      return b.count - a.count;
    });

    return {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
      alerts,
    };
  }

  /**
   * Get alert history (resolved/expired alerts)
   */
  getAlertHistory(options = {}) {
    let history = [...this.alertHistory];

    if (options.limit) {
      history = history.slice(-options.limit);
    }

    if (options.severity) {
      history = history.filter(a => a.severity === options.severity);
    }

    return {
      total: history.length,
      alerts: history.reverse(), // Most recent first
    };
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const active = this.getActiveAlerts();
    return {
      activeAlerts: active.total,
      critical: active.critical,
      high: active.high,
      medium: active.medium,
      low: active.low,
      historyTotal: this.alertHistory.length,
      totalTracked: this.alertCounter,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset all alerts
   */
  reset() {
    this.activeAlerts.clear();
    this.alertHistory = [];
    this.alertCounter = 0;
    logger.info('AlertManager: Reset all alerts');
  }

  /**
   * Create a fingerprint for an anomaly for deduplication
   */
  _createAlertFingerprint(anomaly) {
    // Combine type + endpoint + normalized message for grouping
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
   * Compute severity based on recurrence count and frequency
   */
  _computeSeverity(alert) {
    const now = Date.now();
    const windowStart = now - this.config.escalationThresholds.critical.windowMs;
    const recentOccurrences = alert.occurrences.filter(t => t > windowStart);

    if (recentOccurrences.length >= this.config.escalationThresholds.critical.count) {
      return 'critical';
    }

    const highWindow = now - this.config.escalationThresholds.high.windowMs;
    const highOccurrences = alert.occurrences.filter(t => t > highWindow);
    if (highOccurrences.length >= this.config.escalationThresholds.high.count) {
      return 'high';
    }

    const mediumWindow = now - this.config.escalationThresholds.medium.windowMs;
    const mediumOccurrences = alert.occurrences.filter(t => t > mediumWindow);
    if (mediumOccurrences.length >= this.config.escalationThresholds.medium.count) {
      return 'medium';
    }

    if (alert.anomaly && alert.anomaly.severity) {
      return alert.anomaly.severity;
    }

    return 'low';
  }

  /**
   * Extract tags from an anomaly
   */
  _extractTags(anomaly) {
    const tags = [];

    if (anomaly.endpoint) tags.push(`endpoint:${anomaly.endpoint}`);
    if (anomaly.statusCode) tags.push(`status:${anomaly.statusCode}`);
    if (anomaly.type === 'latency_spike') tags.push('performance');
    if (anomaly.type === 'error_rate_surge') tags.push('reliability');
    if (anomaly.type === 'silent_failure') tags.push('availability');
    if (anomaly.type === 'recurring_error') tags.push('recurring');

    return tags;
  }

  /**
   * Resolve an alert and move to history
   */
  _resolveAlert(fingerprint, alert) {
    alert.resolved = true;
    alert.resolvedAt = Date.now();
    alert.duration = Math.round((alert.resolvedAt - alert.firstSeen) / 1000);

    this.alertHistory.push({
      ...alert,
      occurrences: alert.occurrences.length, // Just store count, not all timestamps
    });

    // Prune history
    if (this.alertHistory.length > this.config.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.config.maxHistorySize);
    }

    this.activeAlerts.delete(fingerprint);
    logger.info(`AlertManager: Resolved alert ${alert.id} after ${alert.duration}s (×${alert.count})`);
  }

  /**
   * Periodically check for stale alerts and auto-resolve
   */
  _startAutoResolveChecker() {
    setInterval(() => {
      const now = Date.now();
      for (const [fingerprint, alert] of this.activeAlerts) {
        if (now - alert.lastSeen > this.config.autoResolveAfterMs) {
          this._resolveAlert(fingerprint, alert);
        }
      }
    }, 60 * 1000); // Check every minute
  }
}

module.exports = new AlertManager();
