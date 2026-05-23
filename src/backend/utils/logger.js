const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, message, ...args) {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level}]`;
  const output = args.length > 0 ? `${prefix} ${message} ${args.join(' ')}` : `${prefix} ${message}`;

  switch (level) {
    case LOG_LEVELS.ERROR:
      console.error(output);
      break;
    case LOG_LEVELS.WARN:
      console.warn(output);
      break;
    case LOG_LEVELS.DEBUG:
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

module.exports = {
  info: (msg, ...args) => log(LOG_LEVELS.INFO, msg, ...args),
  warn: (msg, ...args) => log(LOG_LEVELS.WARN, msg, ...args),
  error: (msg, ...args) => log(LOG_LEVELS.ERROR, msg, ...args),
  debug: (msg, ...args) => log(LOG_LEVELS.DEBUG, msg, ...args),
  LOG_LEVELS,
};
