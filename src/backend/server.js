const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load env from project root
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const apiRoutes = require('./routes/api');
const logRoutes = require('./routes/logs');
const projectRoutes = require('./routes/project');
const { setupSocketHandlers, MONITORED_ENDPOINTS } = require('./services/socketHandlers');
const endpointMonitor = require('./services/endpointMonitor');
const alertManager = require('./services/alertManager');
const anomalyDetector = require('./services/anomalyDetector');
const autoAnalyzer = require('./services/autoAnalyzer');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'file://'],
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'file://'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io accessible to routes
app.set('io', io);

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api', apiRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/project', projectRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO handlers
setupSocketHandlers(io);

// Initialize anomaly detection pipeline
// When endpoint monitor detects an issue, feed it through anomaly detector -> alert manager -> AI analyzer
const onEndpointAlert = async (anomaly) => {
  try {
    // Detect anomaly
    const anomalies = anomalyDetector.analyzeLogEntry({
      type: 'error',
      endpoint: anomaly.endpoint,
      content: anomaly.message,
      statusCode: anomaly.type === 'endpoint_down' ? 503 : 500,
      timestamp: anomaly.timestamp,
    });

    for (const detected of anomalies) {
      // Create alert
      const alert = alertManager.processAnomaly({
        ...detected,
        source: 'endpoint_monitor',
        endpoint: anomaly.endpoint,
        message: anomaly.message,
        severity: anomaly.severity || detected.severity,
      });

      if (alert) {
        // Auto-analyze with AI
        autoAnalyzer.analyzeAnomaly(anomaly).then(analysis => {
          // Broadcast AI-powered analysis
          io.emit('anomaly:ai-analysis', {
            alertId: alert.id,
            analysis: analysis.result,
            alert,
          });
        }).catch(err => {
          logger.error('Auto-analyze failed:', err.message);
        });

        // Broadcast alert to all connected clients
        io.emit('anomaly:new', {
          alert,
          count: 1,
          summary: anomaly.message,
          criticalCount: anomaly.severity === 'critical' ? 1 : 0,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Broadcast updated alert state
    io.emit('alerts:state', alertManager.getActiveAlerts());
  } catch (err) {
    logger.error('Anomaly pipeline error:', err.message);
  }
};

// Register default endpoints and start monitoring
endpointMonitor.registerEndpoints(MONITORED_ENDPOINTS);
endpointMonitor.startMonitoring(onEndpointAlert);

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

server.listen(PORT, () => {
  logger.info(`Backend server running on port ${PORT}`);
  console.log(`Backend server running on http://localhost:${PORT}`);

  // Notify parent process (Electron) that we're ready
  if (process.send) {
    process.send({ type: 'ready', port: PORT });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  endpointMonitor.stopMonitoring();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  endpointMonitor.stopMonitoring();
  server.close(() => {
    process.exit(0);
  });
});
