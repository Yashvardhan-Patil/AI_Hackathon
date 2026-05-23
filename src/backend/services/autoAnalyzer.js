const groqService = require('./groqService');
const logger = require('../utils/logger');

/**
 * AutoAnalyzer — Automatically feeds detected anomalies to Groq AI
 * for root cause analysis and debugging recommendations.
 *
 * When an anomaly is detected, this service:
 * 1. Prepares a focused prompt with the anomaly details
 * 2. Sends it to the AI for analysis
 * 3. Returns structured root cause + recommendations
 */
class AutoAnalyzer {
  constructor() {
    this.analysisCache = new Map();   // anomaly fingerprint -> { result, timestamp }
    this.config = {
      minIntervalBetweenAnalysisMs: 30 * 1000,  // Don't re-analyze same type within 30s
      maxConcurrentAnalysis: 3,                  // Max concurrent AI calls
    };
    this.activeAnalysis = 0;
  }

  /**
   * Analyze a single anomaly and return AI-powered root cause analysis
   */
  async analyzeAnomaly(anomaly, contextData = {}) {
    if (!anomaly || !anomaly.type) {
      return { success: false, error: 'Invalid anomaly' };
    }

    // Check cache to avoid redundant analysis
    const cacheKey = `${anomaly.type}:${anomaly.endpoint || 'unknown'}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.config.minIntervalBetweenAnalysisMs) {
      return { success: true, result: cached.result, cached: true };
    }

    // Check concurrency limit
    if (this.activeAnalysis >= this.config.maxConcurrentAnalysis) {
      logger.info('AutoAnalyzer: Max concurrent analysis reached, skipping');
      return { success: false, error: 'Too many concurrent analyses' };
    }

    this.activeAnalysis++;

    try {
      const prompt = this._buildAnomalyPrompt(anomaly, contextData);
      const result = await groqService.sendMessage(
        [{ role: 'user', content: prompt }],
        { anomalyAnalysis: true }
      );

      const analysis = {
        anomalyType: anomaly.type,
        endpoint: anomaly.endpoint || 'unknown',
        severity: anomaly.severity || 'medium',
        rootCause: this._extractRootCause(result),
        recommendations: this._extractRecommendations(result),
        aiAnalysis: result,
        analyzedAt: new Date().toISOString(),
      };

      // Cache the result
      this.analysisCache.set(cacheKey, { result: analysis, timestamp: Date.now() });

      logger.info(`AutoAnalyzer: Analysis complete for ${anomaly.type} on ${anomaly.endpoint || 'unknown'}`);

      return { success: true, result: analysis };
    } catch (error) {
      logger.error('AutoAnalyzer: Analysis failed:', error.message);
      return { success: false, error: error.message };
    } finally {
      this.activeAnalysis--;
    }
  }

  /**
   * Analyze a batch of anomalies (e.g., from a log file scan)
   */
  async analyzeBatch(anomalies, contextData = {}) {
    if (!anomalies || anomalies.length === 0) {
      return { success: true, results: [] };
    }

    // Group anomalies by type for efficient batch analysis
    const grouped = this._groupByType(anomalies);
    const results = [];

    for (const [type, typeAnomalies] of Object.entries(grouped)) {
      const topAnomalies = typeAnomalies.slice(0, 5); // Top 5 per type
      const result = await this.analyzeBatchGroup(type, topAnomalies, contextData);
      if (result.success) {
        results.push(result.result);
      }
    }

    return { success: true, results };
  }

  /**
   * Analyze a group of same-type anomalies together
   */
  async analyzeBatchGroup(type, anomalies, contextData = {}) {
    if (anomalies.length === 0) return { success: true, result: null };

    this.activeAnalysis++;

    try {
      const summary = this._buildBatchSummary(type, anomalies);
      const prompt = `I have detected a batch of ${anomalies.length} anomalies of type "${type}" in my API system.

${summary}

For each distinct issue, please provide:
1. ROOT_CAUSE: What is likely causing this
2. IMPACT: How severe is this for users
3. FIX: Step-by-step fix instructions
4. PREVENTION: How to prevent this in the future

Format each distinct issue as:
---
SEVERITY: [CRITICAL|HIGH|MEDIUM|LOW]
ROOT_CAUSE: [explanation]
IMPACT: [user impact description]
FIX: [step-by-step fix]
SUGGESTION: [prevention measure]
---`;

      const result = await groqService.sendMessage(
        [{ role: 'user', content: prompt }],
        { batchAnalysis: true, ...contextData }
      );

      const analysis = {
        type,
        anomalyCount: anomalies.length,
        severity: this._computeBatchSeverity(anomalies),
        aiAnalysis: result,
        analyzedAt: new Date().toISOString(),
      };

      logger.info(`AutoAnalyzer: Batch analysis complete for ${type} (${anomalies.length} anomalies)`);

      return { success: true, result: analysis };
    } catch (error) {
      logger.error('AutoAnalyzer: Batch analysis failed:', error.message);
      return { success: false, error: error.message };
    } finally {
      this.activeAnalysis--;
    }
  }

  /**
   * Build a focused prompt for anomaly analysis
   */
  _buildAnomalyPrompt(anomaly, contextData) {
    const lines = [
      'I detected an anomaly in my API system. Please analyze it:',
      '',
      `Type: ${anomaly.type}`,
      `Endpoint: ${anomaly.endpoint || 'N/A'}`,
      `Severity: ${anomaly.severity || 'N/A'}`,
      `Message: ${anomaly.message || anomaly.alertMessage || 'N/A'}`,
    ];

    if (anomaly.currentLatency) {
      lines.push(`Current Latency: ${anomaly.currentLatency}ms`);
      lines.push(`Baseline Latency: ${anomaly.baselineLatency || 'N/A'}ms`);
    }

    if (anomaly.count && anomaly.count > 1) {
      lines.push(`Occurrences: ${anomaly.count}`);
    }

    if (anomaly.statusCode) {
      lines.push(`Status Code: ${anomaly.statusCode}`);
    }

    if (contextData.logs) {
      lines.push('', 'Relevant logs:', contextData.logs.substring(0, 1500));
    }

    lines.push('',
      'Please provide:',
      '1. ROOT_CAUSE: What is likely causing this issue',
      '2. IMPACT: How does this affect users',
      '3. FIX: Step-by-step debugging and fix instructions',
      '4. PREVENTION: How to prevent this in the future',
      '',
      'Format:',
      'SEVERITY: [CRITICAL|HIGH|MEDIUM|LOW]',
      'ROOT_CAUSE: [your analysis]',
      'IMPACT: [user impact]',
      'FIX: [step 1]',
      'FIX: [step 2]',
      'SUGGESTION: [prevention tip]',
    );

    return lines.join('\n');
  }

  /**
   * Build a summary of batch anomalies for AI analysis
   */
  _buildBatchSummary(type, anomalies) {
    const lines = [
      `Anomaly Type: ${type}`,
      `Total Occurrences: ${anomalies.length}`,
      `Time Window: ${anomalies[0]?.timestamp || 'N/A'} to ${anomalies[anomalies.length - 1]?.timestamp || 'N/A'}`,
      '',
      'Sample anomalies:',
    ];

    for (const anom of anomalies.slice(0, 10)) {
      lines.push(`  - [${anom.severity}] ${(anom.message || anom.alertMessage || '').substring(0, 150)}`);
    }

    return lines.join('\n');
  }

  /**
   * Extract root cause from AI response
   */
  _extractRootCause(aiResult) {
    if (!aiResult || !aiResult.content) return null;

    const content = aiResult.content;
    const match = content.match(/ROOT_CAUSE:\s*(.+?)(?:\n|$)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract recommendations from AI response
   */
  _extractRecommendations(aiResult) {
    if (!aiResult || !aiResult.content) return [];

    const content = aiResult.content;
    const suggestions = [];
    const regex = /(?:FIX|SUGGESTION):\s*(.+?)(?:\n|$)/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      suggestions.push(match[1].trim());
    }
    return suggestions;
  }

  /**
   * Compute batch severity from individual anomaly severities
   */
  _computeBatchSeverity(anomalies) {
    if (anomalies.some(a => a.severity === 'critical')) return 'critical';
    if (anomalies.some(a => a.severity === 'high')) return 'high';
    if (anomalies.some(a => a.severity === 'medium')) return 'medium';
    return 'low';
  }

  /**
   * Group anomalies by type
   */
  _groupByType(anomalies) {
    const groups = {};
    for (const anomaly of anomalies) {
      if (!groups[anomaly.type]) {
        groups[anomaly.type] = [];
      }
      groups[anomaly.type].push(anomaly);
    }
    return groups;
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear();
    logger.info('AutoAnalyzer: Cache cleared');
  }
}

module.exports = new AutoAnalyzer();
