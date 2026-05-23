const http = require('http');
const https = require('https');
const { URL } = require('url');
const logger = require('../utils/logger');

/**
 * EndpointMonitor — Pings real HTTP endpoints, measures latency & status codes,
 * detects downtime and degradation. Replaces current mock data in ApiHealth.
 */
class EndpointMonitor {
  constructor() {
    this.endpoints = new Map();   // url -> EndpointStatus
    this.results = new Map();     // url -> { latency, statusCode, timestamp }
    this.config = {
      checkIntervalMs: 30000,      // Check every 30 seconds
      timeoutMs: 10000,            // Per-request timeout
      consecutiveFailThreshold: 3, // Alert after N consecutive failures
      latencyDegradedMs: 300,      // > 300ms = degraded
      latencyCriticalMs: 1000,     // > 1000ms = critical
    };

    this._monitorInterval = null;
    this._onAlert = null;          // Callback for alert events
  }

  /**
   * Register endpoints to monitor
   * @param {Array} endpoints - Array of { url, method, name, headers }
   */
  registerEndpoints(endpoints) {
    for (const ep of endpoints) {
      const url = ep.url || `${ep.method || 'GET'} ${ep.path || ep.name}`;
      this.endpoints.set(url, {
        url: ep.url,
        method: ep.method || 'GET',
        name: ep.name || ep.path || url,
        path: ep.path || '/',
        headers: ep.headers || {},
        consecutiveFailures: 0,
        lastResponseTime: null,
        status: 'unknown',
        totalChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        avgLatency: 0,
        latencySamples: [],
        registeredAt: new Date().toISOString(),
      });
    }

    logger.info(`EndpointMonitor: Registered ${endpoints.length} endpoint(s)`);
    return { success: true, count: endpoints.length };
  }

  /**
   * Start periodic health checks
   */
  startMonitoring(onAlert) {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
    }

    this._onAlert = onAlert;

    // Immediate first check
    this._checkAllEndpoints();

    // Periodic checks
    this._monitorInterval = setInterval(() => {
      this._checkAllEndpoints();
    }, this.config.checkIntervalMs);

    logger.info('EndpointMonitor: Started periodic health checking');
    return { success: true, interval: this.config.checkIntervalMs };
  }

  /**
   * Stop periodic health checks
   */
  stopMonitoring() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
    logger.info('EndpointMonitor: Stopped health checking');
  }

  /**
   * Get current status of all monitored endpoints
   */
  getStatus() {
    const endpoints = [];
    for (const [, ep] of this.endpoints) {
      endpoints.push({
        method: ep.method,
        path: ep.path,
        name: ep.name,
        status: ep.status,
        latency: ep.lastResponseTime ? `${ep.lastResponseTime}ms` : 'N/A',
        lastChecked: ep.lastCheckTime ? new Date(ep.lastCheckTime).toISOString() : null,
        consecutiveFailures: ep.consecutiveFailures,
        totalChecks: ep.totalChecks,
        uptime: ep.totalChecks > 0
          ? Math.round((ep.successfulChecks / ep.totalChecks) * 100)
          : 100,
        avgLatency: ep.avgLatency ? `${Math.round(ep.avgLatency)}ms` : 'N/A',
      });
    }

    const healthy = endpoints.filter(e => e.status === 'healthy').length;
    const degraded = endpoints.filter(e => e.status === 'degraded').length;
    const down = endpoints.filter(e => e.status === 'down').length;

    return {
      total: endpoints.length,
      healthy,
      degraded,
      down,
      uptime: endpoints.length > 0
        ? Math.round((healthy / endpoints.length) * 100)
        : 100,
      endpoints,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Add a single endpoint to monitor
   */
  addEndpoint(url, options = {}) {
    this.endpoints.set(url, {
      url,
      method: options.method || 'GET',
      name: options.name || url,
      path: options.path || '/',
      headers: options.headers || {},
      consecutiveFailures: 0,
      lastResponseTime: null,
      status: 'unknown',
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      avgLatency: 0,
      latencySamples: [],
      registeredAt: new Date().toISOString(),
    });
    logger.info(`EndpointMonitor: Added endpoint ${url}`);
  }

  /**
   * Remove an endpoint from monitoring
   */
  removeEndpoint(url) {
    const removed = this.endpoints.delete(url);
    if (removed) {
      logger.info(`EndpointMonitor: Removed endpoint ${url}`);
    }
    return removed;
  }

  /**
   * Check all registered endpoints
   */
  async _checkAllEndpoints() {
    const promises = [];
    for (const [url, ep] of this.endpoints) {
      promises.push(this._checkEndpoint(url, ep));
    }
    await Promise.allSettled(promises);
  }

  /**
   * Check a single endpoint
   */
  async _checkEndpoint(url, ep) {
    const startTime = Date.now();

    try {
      const response = await this._makeRequest(ep);
      const latency = Date.now() - startTime;

      ep.totalChecks++;
      ep.lastCheckTime = startTime;
      ep.lastResponseTime = latency;

      // Determine status
      let newStatus;
      if (response.statusCode >= 200 && response.statusCode < 400) {
        if (latency > this.config.latencyCriticalMs) {
          newStatus = 'degraded';
        } else if (latency > this.config.latencyDegradedMs) {
          newStatus = 'degraded';
        } else {
          newStatus = 'healthy';
        }
        ep.consecutiveFailures = 0;
        ep.successfulChecks++;
      } else {
        newStatus = 'down';
        ep.consecutiveFailures++;
        ep.failedChecks++;
      }

      // Track latency for moving average
      ep.latencySamples.push(latency);
      if (ep.latencySamples.length > 20) {
        ep.latencySamples.shift();
      }
      ep.avgLatency = ep.latencySamples.reduce((a, b) => a + b, 0) / ep.latencySamples.length;

      // Detect status changes
      const previousStatus = ep.status;
      ep.status = newStatus;

      // Fire alert callback on status changes or consecutive failures
      if (this._onAlert && (previousStatus !== newStatus || ep.consecutiveFailures >= this.config.consecutiveFailThreshold)) {
        this._fireStatusAlert(ep, previousStatus, newStatus, latency);
      }

      // Track result
      this.results.set(url, {
        latency,
        statusCode: response.statusCode,
        status: newStatus,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      ep.totalChecks++;
      ep.lastCheckTime = startTime;
      ep.consecutiveFailures++;
      ep.failedChecks++;
      ep.lastResponseTime = null;

      const previousStatus = ep.status;
      ep.status = 'down';

      // Fire alert on failure
      if (this._onAlert && (previousStatus !== 'down' || ep.consecutiveFailures >= this.config.consecutiveFailThreshold)) {
        this._fireFailureAlert(ep, error.message);
      }

      this.results.set(url, {
        latency: null,
        statusCode: null,
        status: 'down',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Make an HTTP request to the endpoint
   */
  _makeRequest(ep) {
    return new Promise((resolve, reject) => {
      const targetUrl = ep.url || `http://localhost${ep.path}`;
      let urlObj;

      try {
        urlObj = new URL(targetUrl);
      } catch {
        // Try adding http:// prefix
        try {
          urlObj = new URL(`http://${targetUrl}`);
        } catch {
          reject(new Error(`Invalid URL: ${targetUrl}`));
          return;
        }
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: ep.method || 'GET',
        headers: {
          'User-Agent': 'APIDebuggingCopilot/1.0',
          ...(ep.headers || {}),
        },
        timeout: this.config.timeoutMs,
      };

      const lib = urlObj.protocol === 'https:' ? https : http;
      const req = lib.request(options, (res) => {
        // Consume response data to free memory
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data.substring(0, 1000), // Store first 1000 chars
          });
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.end();
    });
  }

  /**
   * Fire alert callback for status changes
   */
  _fireStatusAlert(ep, previousStatus, newStatus, latency) {
    if (!this._onAlert) return;

    const anomaly = {
      type: newStatus === 'down' ? 'endpoint_down' : 'endpoint_degraded',
      endpoint: ep.name || ep.path,
      severity: newStatus === 'down' ? 'critical' : 'medium',
      message: `Endpoint ${ep.name || ep.path} is ${newStatus}` +
        (previousStatus !== 'unknown' ? ` (was ${previousStatus})` : '') +
        (latency ? ` — ${latency}ms` : ''),
      latency: latency || null,
      previousStatus,
      newStatus,
      source: 'endpoint_monitor',
      timestamp: new Date().toISOString(),
    };

    this._onAlert(anomaly);
  }

  /**
   * Fire alert callback for request failures
   */
  _fireFailureAlert(ep, errorMessage) {
    if (!this._onAlert) return;

    const anomaly = {
      type: 'request_failure',
      endpoint: ep.name || ep.path,
      severity: ep.consecutiveFailures >= this.config.consecutiveFailThreshold ? 'critical' : 'high',
      message: `Request to ${ep.name || ep.path} failed: ${errorMessage}` +
        (ep.consecutiveFailures >= 2 ? ` (${ep.consecutiveFailures} consecutive failures)` : ''),
      consecutiveFailures: ep.consecutiveFailures,
      error: errorMessage,
      source: 'endpoint_monitor',
      timestamp: new Date().toISOString(),
    };

    this._onAlert(anomaly);
  }
}

module.exports = new EndpointMonitor();
