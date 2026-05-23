const logger = require('../utils/logger');

/**
 * AnomalyDetector — Analyzes logs and endpoint data in real-time to detect:
 * - Sudden error rate increases
 * - Latency spikes (> 2x baseline)
 * - Status code pattern changes
 * - Recurring error message clusters
 * - Silent failures (errors without corresponding log entries)
 */
class AnomalyDetector {
  constructor() {
    // Rolling windows for baseline computation
    this.latencyWindow = [];      // [{ endpoint, latency, timestamp }]
    this.errorRateWindow = [];     // [{ endpoint, statusCode, timestamp, message }]
    this.statusCodeWindow = [];    // [{ endpoint, statusCode, timestamp }]

    // Configurable thresholds
    this.config = {
      latencySpikeMultiplier: 2,     // Latency > 2x baseline = spike
      errorRateSurgeThreshold: 0.3,  // Error rate > 30% = surge
      minBaselineSamples: 5,         // Minimum samples before detecting
      windowSizeMs: 5 * 60 * 1000,   // 5 minute rolling window
      recurrenceWindowMs: 60 * 1000, // 1 minute for recurrence grouping
      silentFailureThreshold: 30000, // No response > 30s = silent failure
    };

    // Recurring error tracker
    this.errorFingerprints = new Map(); // fingerprint -> { count, firstSeen, lastSeen, message, endpoints }
  }

  /**
   * Analyze a single log entry for anomalies
   */
  analyzeLogEntry(entry) {
    const anomalies = [];

    if (!entry || !entry.timestamp) return anomalies;

    const timestamp = new Date(entry.timestamp).getTime() || Date.now();

    // Track status codes
    if (entry.statusCode) {
      this.statusCodeWindow.push({ endpoint: entry.endpoint, statusCode: entry.statusCode, timestamp });
      this.pruneWindow(this.statusCodeWindow);
    }

    // Track errors
    if (entry.type === 'error' || (entry.statusCode && entry.statusCode >= 400)) {
      this.errorRateWindow.push({
        endpoint: entry.endpoint || 'unknown',
        statusCode: entry.statusCode,
        timestamp,
        message: entry.content || entry.message || '',
      });
      this.pruneWindow(this.errorRateWindow);

      // Check for recurring error patterns
      const fingerprint = this.createErrorFingerprint(entry);
      if (fingerprint) {
        const recurrenceAnomaly = this.trackRecurringError(fingerprint, entry);
        if (recurrenceAnomaly) {
          anomalies.push(recurrenceAnomaly);
        }
      }

      // Check for error rate surge on this endpoint
      const errorRateAnomaly = this.detectErrorRateSurge(entry.endpoint, timestamp);
      if (errorRateAnomaly) {
        anomalies.push(errorRateAnomaly);
      }

      // Check for status code pattern changes
      const statusAnomaly = this.detectStatusCodeAnomaly(entry.endpoint, entry.statusCode, timestamp);
      if (statusAnomaly) {
        anomalies.push(statusAnomaly);
      }
    }

    return anomalies;
  }

  /**
   * Analyze endpoint latency data for spikes
   */
  analyzeLatency(endpoint, latencyMs, timestamp = Date.now()) {
    this.latencyWindow.push({ endpoint, latency: latencyMs, timestamp });
    this.pruneWindow(this.latencyWindow);

    if (this.latencyWindow.length < this.config.minBaselineSamples) {
      return null; // Not enough data yet
    }

    const baseline = this.computeLatencyBaseline(endpoint);
    if (!baseline) return null;

    const threshold = baseline * this.config.latencySpikeMultiplier;

    if (latencyMs > threshold && latencyMs > 100) {
      const severity = latencyMs > threshold * 3 ? 'critical' : (latencyMs > threshold * 2 ? 'high' : 'medium');

      return {
        type: 'latency_spike',
        endpoint,
        currentLatency: latencyMs,
        baselineLatency: Math.round(baseline),
        threshold: Math.round(threshold),
        multiplier: (latencyMs / baseline).toFixed(1),
        severity,
        timestamp: new Date(timestamp).toISOString(),
        message: `Latency spike on ${endpoint}: ${latencyMs}ms (baseline: ${Math.round(baseline)}ms, ${(latencyMs / baseline).toFixed(1)}x)`,
      };
    }

    return null;
  }

  /**
   * Analyze for silent failures — endpoints that should be responding but aren't
   */
  analyzeSilentFailure(endpoint, lastResponseTime, currentTime = Date.now()) {
    if (!lastResponseTime) return null;

    const elapsed = currentTime - new Date(lastResponseTime).getTime();
    if (elapsed > this.config.silentFailureThreshold) {
      return {
        type: 'silent_failure',
        endpoint,
        elapsedSeconds: Math.round(elapsed / 1000),
        lastResponse: new Date(lastResponseTime).toISOString(),
        severity: 'high',
        timestamp: new Date(currentTime).toISOString(),
        message: `Silent failure detected on ${endpoint}: no response for ${Math.round(elapsed / 1000)}s`,
      };
    }

    return null;
  }

  /**
   * Log file analysis — batch analyze a complete log file for anomalies
   */
  analyzeLogFile(parsedLogData) {
    const anomalies = [];

    if (!parsedLogData || !parsedLogData.entries) return anomalies;

    for (const entry of parsedLogData.entries) {
      const entryAnomalies = this.analyzeLogEntry(entry);
      anomalies.push(...entryAnomalies);
    }

    // Group anomalies by type for the batch result
    const grouped = this.groupAnomalies(anomalies);

    return {
      totalAnomalies: anomalies.length,
      anomalies,
      groups: grouped,
      summary: this.createSummary(grouped),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a fingerprint for an error to detect recurrences
   */
  createErrorFingerprint(entry) {
    const message = (entry.content || entry.message || '').trim();
    if (!message) return null;

    // Normalize: lowercase, remove timestamps, remove dynamic values (numbers, UUIDs, hashes)
    let normalized = message.toLowerCase()
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
      .replace(/\b\d{2,}\b/g, '<NUM>')
      .replace(/"([^"]+)"/g, '"<VAL>"')
      .replace(/'([^']+)'/g, "'<VAL>'")
      .replace(/at\s+\S+/g, 'at <LOCATION>')
      .replace(/:\d+:/g, ':<LINE>:')
      .replace(/line\s+\d+/g, 'line <N>')
      .trim();

    // Truncate to first 200 chars for fingerprint
    return normalized.substring(0, 200);
  }

  /**
   * Track a recurring error and return anomaly if threshold exceeded
   */
  trackRecurringError(fingerprint, entry) {
    const now = Date.now();
    const existing = this.errorFingerprints.get(fingerprint);

    if (existing) {
      existing.count++;
      existing.lastSeen = now;
      existing.severity = existing.count >= 10 ? 'critical' : existing.count >= 5 ? 'high' : 'medium';

      const endpoint = entry.endpoint || 'unknown';
      if (!existing.endpoints.includes(endpoint)) {
        existing.endpoints.push(endpoint);
      }

      // Alert on recurrence milestones
      if (existing.count === 3 || existing.count === 5 || existing.count === 10 || existing.count % 20 === 0) {
        return {
          type: 'recurring_error',
          fingerprint,
          count: existing.count,
          firstSeen: new Date(existing.firstSeen).toISOString(),
          lastSeen: new Date(existing.lastSeen).toISOString(),
          message: entry.content || entry.message || '',
          endpoints: existing.endpoints,
          severity: existing.severity,
          timestamp: new Date(now).toISOString(),
          alertMessage: `Recurring error (×${existing.count}): ${(entry.content || entry.message || '').substring(0, 120)}`,
        };
      }
    } else {
      this.errorFingerprints.set(fingerprint, {
        count: 1,
        firstSeen: now,
        lastSeen: now,
        message: entry.content || entry.message || '',
        endpoints: [entry.endpoint || 'unknown'],
        severity: 'low',
      });

      // Clean up old fingerprints (> 1 hour old)
      this.pruneFingerprints();
    }

    return null;
  }

  /**
   * Detect if error rate for an endpoint has surged above baseline
   */
  detectErrorRateSurge(endpoint, timestamp) {
    const recentEntries = this.errorRateWindow.filter(e => e.endpoint === endpoint);
    const recentCount = recentEntries.length;

    if (recentCount < 3) return null;

    // Compute rate: errors per minute
    const oldestTime = Math.min(...recentEntries.map(e => e.timestamp));
    const windowMinutes = Math.max(1, (timestamp - oldestTime) / 60000);
    const errorRate = recentCount / windowMinutes;

    // Simple threshold-based detection
    if (errorRate > 10) {
      return {
        type: 'error_rate_surge',
        endpoint,
        errorRate: Math.round(errorRate * 10) / 10,
        errorCount: recentCount,
        windowMinutes: Math.round(windowMinutes * 10) / 10,
        severity: errorRate > 50 ? 'critical' : errorRate > 20 ? 'high' : 'medium',
        timestamp: new Date(timestamp).toISOString(),
        message: `Error rate surge on ${endpoint}: ${Math.round(errorRate * 10) / 10} errors/min (${recentCount} in ${Math.round(windowMinutes * 10) / 10} min)`,
      };
    }

    return null;
  }

  /**
   * Detect unusual status code patterns (e.g., sudden 500s instead of 200s)
   */
  detectStatusCodeAnomaly(endpoint, statusCode, timestamp) {
    const recentCodes = this.statusCodeWindow.filter(e => e.endpoint === endpoint);
    if (recentCodes.length < 5) return null;

    const serverErrors = recentCodes.filter(e => e.statusCode >= 500).length;
    const clientErrors = recentCodes.filter(e => e.statusCode >= 400 && e.statusCode < 500).length;
    const total = recentCodes.length;

    const serverErrorRate = serverErrors / total;
    const clientErrorRate = clientErrors / total;

    const anomalies = [];

    if (serverErrorRate > 0.5 && statusCode >= 500) {
      anomalies.push({
        type: 'server_error_cluster',
        endpoint,
        errorRate: Math.round(serverErrorRate * 100),
        statusCode,
        totalRequests: total,
        severity: 'critical',
        timestamp: new Date(timestamp).toISOString(),
        message: `Server error cluster on ${endpoint}: ${Math.round(serverErrorRate * 100)}% 5xx errors (${serverErrors}/${total})`,
      });
    }

    if (clientErrorRate > 0.7 && statusCode >= 400 && statusCode < 500) {
      anomalies.push({
        type: 'client_error_cluster',
        endpoint,
        errorRate: Math.round(clientErrorRate * 100),
        statusCode,
        totalRequests: total,
        severity: 'high',
        timestamp: new Date(timestamp).toISOString(),
        message: `Client error cluster on ${endpoint}: ${Math.round(clientErrorRate * 100)}% 4xx errors (${clientErrors}/${total})`,
      });
    }

    return anomalies.length > 0 ? anomalies[0] : null;
  }

  /**
   * Compute latency baseline for an endpoint
   */
  computeLatencyBaseline(endpoint) {
    const recent = this.latencyWindow
      .filter(e => e.endpoint === endpoint)
      .map(e => e.latency);

    if (recent.length < this.config.minBaselineSamples) return null;

    // Use median to be robust against outliers
    const sorted = [...recent].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Group anomalies by type and severity
   */
  groupAnomalies(anomalies) {
    const groups = {
      latency_spikes: anomalies.filter(a => a.type === 'latency_spike'),
      error_rate_surges: anomalies.filter(a => a.type === 'error_rate_surge'),
      recurring_errors: anomalies.filter(a => a.type === 'recurring_error'),
      silent_failures: anomalies.filter(a => a.type === 'silent_failure'),
      server_error_clusters: anomalies.filter(a => a.type === 'server_error_cluster'),
      client_error_clusters: anomalies.filter(a => a.type === 'client_error_cluster'),
    };

    return Object.fromEntries(
      Object.entries(groups).filter(([, v]) => v.length > 0)
    );
  }

  /**
   * Create summary text from grouped anomalies
   */
  createSummary(groups) {
    const total = Object.values(groups).reduce((sum, arr) => sum + arr.length, 0);
    if (total === 0) return null;

    const critical = Object.values(groups).reduce((sum, arr) => sum + arr.filter(a => a.severity === 'critical').length, 0);
    const high = Object.values(groups).reduce((sum, arr) => sum + arr.filter(a => a.severity === 'high').length, 0);
    const medium = Object.values(groups).reduce((sum, arr) => sum + arr.filter(a => a.severity === 'medium').length, 0);

    const lines = [`Detected ${total} anomaly(ies):`];
    if (critical > 0) lines.push(`  🔴 ${critical} critical`);
    if (high > 0) lines.push(`  🟠 ${high} high`);
    if (medium > 0) lines.push(`  🟡 ${medium} medium`);

    for (const [type, items] of Object.entries(groups)) {
      if (items.length > 0) {
        const firstMsg = items[0].message || items[0].alertMessage || '';
        lines.push(`  • ${type.replace(/_/g, ' ')}: ${items.length} — ${firstMsg.substring(0, 80)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get all tracked recurring errors for reporting
   */
  getRecurringErrors() {
    const errors = [];
    for (const [fingerprint, data] of this.errorFingerprints) {
      if (data.count >= 2) {
        errors.push({
          fingerprint,
          ...data,
          firstSeen: new Date(data.firstSeen).toISOString(),
          lastSeen: new Date(data.lastSeen).toISOString(),
        });
      }
    }
    return errors.sort((a, b) => b.count - a.count);
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.latencyWindow = [];
    this.errorRateWindow = [];
    this.statusCodeWindow = [];
    this.errorFingerprints.clear();
    logger.info('AnomalyDetector: Reset all tracking data');
  }

  /**
   * Prune old entries from rolling window
   */
  pruneWindow(window) {
    const cutoff = Date.now() - this.config.windowSizeMs;
    while (window.length > 0 && window[0].timestamp < cutoff) {
      window.shift();
    }
  }

  /**
   * Prune old error fingerprints (> 1 hour)
   */
  pruneFingerprints() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [fingerprint, data] of this.errorFingerprints) {
      if (data.lastSeen < cutoff) {
        this.errorFingerprints.delete(fingerprint);
      }
    }
  }
}

module.exports = new AnomalyDetector();
