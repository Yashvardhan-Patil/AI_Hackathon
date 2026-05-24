const https = require('https');
const http = require('http');
const { URL } = require('url');
const { exec } = require('child_process');
const logger = require('../utils/logger');

/**
 * WebService — Provides web search and URL fetch capabilities to the AI.
 * Allows the chat AI to access web content, search, fetch pages, etc.
 */
class WebService {
  constructor() {
    this.searchEngines = {
      google: 'https://www.google.com/search?q=',
      duckduckgo: 'https://html.duckduckgo.com/html/?q=',
    };
    this.config = {
      defaultSearchEngine: 'duckduckgo',
      fetchTimeoutMs: 15000,
      maxResponseSize: 50000,
    };
  }

  /**
   * Fetch a URL and extract readable text content.
   * Returns the page title + text content (stripped of HTML tags).
   */
  fetchUrl(urlString) {
    return new Promise((resolve) => {
      try {
        const urlObj = new URL(urlString);
        const lib = urlObj.protocol === 'https:' ? https : http;

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          timeout: this.config.fetchTimeoutMs,
        };

        const req = lib.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk.toString();
            if (data.length > this.config.maxResponseSize) {
              req.destroy();
              resolve(this._parseResult(data.substring(0, this.config.maxResponseSize), urlString));
            }
          });

          res.on('end', () => {
            resolve(this._parseResult(data, urlString));
          });
        });

        req.on('error', (err) => {
          resolve({ success: false, error: `Request failed: ${err.message}` });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timed out' });
        });

        req.end();
      } catch (err) {
        resolve({ success: false, error: `Invalid URL: ${err.message}` });
      }
    });
  }

  /**
   * Search the web using the configured search engine.
   */
  async searchWeb(query) {
    const searchUrl = this.searchEngines[this.config.defaultSearchEngine] + encodeURIComponent(query);
    logger.info(`WebService: Searching for "${query}"`);

    const result = await this.fetchUrl(searchUrl);

    if (result.success) {
      // Extract search result snippets from DuckDuckGo HTML
      const snippets = this._extractSearchSnippets(result.text);
      return {
        success: true,
        query,
        snippets: snippets.slice(0, 8),
        rawText: result.text.substring(0, 4000),
        source: this.config.defaultSearchEngine,
      };
    }

    return result;
  }

  /**
   * Try to determine if something is a URL or a search query.
   */
  classifyInput(input) {
    const trimmed = input.trim();

    // Check if it looks like a URL
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      if (url.hostname.includes('.')) {
        return { type: 'url', url: url.href };
      }
    } catch {
      // Not a URL
    }

    // Check for YouTube patterns
    const youtubePatterns = [
      /youtube\.com/i,
      /youtu\.be/i,
      /m\.youtube\.com/i,
      /youtube/i,
    ];
    if (youtubePatterns.some(p => p.test(trimmed))) {
      // It's a YouTube video or channel reference
      return { type: 'url', url: trimmed.startsWith('http') ? trimmed : `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}` };
    }

    // Default: search query
    return { type: 'search', query: trimmed };
  }

  /**
   * Extract search result snippets from DuckDuckGo HTML.
   */
  _extractSearchSnippets(html) {
    const snippets = [];

    // DuckDuckGo result pattern: <a class="result__a" href="...">title</a>
    const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const titles = [];
    let match;
    while ((match = titleRegex.exec(html)) !== null && titles.length < 8) {
      titles.push({
        url: match[1],
        title: this._stripHtml(match[2]).trim(),
      });
    }

    const snippetTexts = [];
    while ((match = snippetRegex.exec(html)) !== null && snippetTexts.length < 8) {
      snippetTexts.push(this._stripHtml(match[1]).trim());
    }

    for (let i = 0; i < Math.min(titles.length, 8); i++) {
      snippets.push({
        title: titles[i]?.title || '',
        url: titles[i]?.url || '',
        snippet: snippetTexts[i] || '',
      });
    }

    return snippets;
  }

  /**
   * Parse fetched HTML/text into a structured result.
   */
  _parseResult(rawData, url) {
    try {
      const text = this._stripHtml(rawData);
      const title = this._extractTitle(rawData);

      return {
        success: true,
        url,
        title,
        text: text.substring(0, 10000),
        rawLength: rawData.length,
      };
    } catch (err) {
      return { success: false, error: `Parse error: ${err.message}` };
    }
  }

  /**
   * Extract page title from HTML.
   */
  _extractTitle(html) {
    const match = html.match(/<title>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim() : 'Untitled Page';
  }

  /**
   * Strip HTML tags and normalize whitespace.
   */
  _stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Open a URL in the default browser (Chrome, Edge, etc.)
   * On Windows this uses `start`, on macOS `open`, on Linux `xdg-open`.
   */
  openInBrowser(urlString) {
    return new Promise((resolve) => {
      // Ensure URL has protocol
      let targetUrl = urlString.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      const platform = process.platform;
      let command;

      if (platform === 'win32') {
        command = `start "" "${targetUrl}"`;
      } else if (platform === 'darwin') {
        command = `open "${targetUrl}"`;
      } else {
        command = `xdg-open "${targetUrl}"`;
      }

      logger.info(`WebService: Opening in browser: ${targetUrl}`);

      exec(command, (error) => {
        if (error) {
          logger.error('WebService: Failed to open browser:', error.message);
          resolve({ success: false, error: `Failed to open browser: ${error.message}` });
        } else {
          resolve({ success: true, message: `Opened ${targetUrl} in default browser` });
        }
      });
    });
  }
}

module.exports = new WebService();
