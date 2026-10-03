type LoggerPayload = Record<string, unknown>;

const formatLog = (level: 'info' | 'warn' | 'error', message: string, meta: LoggerPayload = {}) => ({
  level,
  message,
  timestamp: new Date().toISOString(),
  ...meta,
});

export const logger = {
  info(message: string, meta: LoggerPayload = {}) {
    console.info(JSON.stringify(formatLog('info', message, meta)));
  },
  warn(message: string, meta: LoggerPayload = {}) {
    console.warn(JSON.stringify(formatLog('warn', message, meta)));
  },
  error(message: string, meta: LoggerPayload = {}) {
    console.error(JSON.stringify(formatLog('error', message, meta)));
  },
};
