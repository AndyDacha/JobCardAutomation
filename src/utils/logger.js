import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log file path
const LOG_FILE = path.join(__dirname, '../../logs/server.log');

// Ensure logs directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Helper to write to both console and file
const writeLog = (level, prefix, message, ...args) => {
  const normalizeArg = (a) => {
    if (a instanceof Error) {
      return { name: a.name, message: a.message, stack: a.stack };
    }
    return a;
  };

  const safeStringify = (obj) => {
    try {
      return JSON.stringify(obj, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v));
    } catch {
      try {
        return String(obj);
      } catch {
        return '[Unserializable]';
      }
    }
  };

  const normalizedArgs = args.map(normalizeArg);
  const logLine = `${prefix} ${message}${normalizedArgs.length > 0 ? ' ' + normalizedArgs.map(a => typeof a === 'object' ? safeStringify(a) : a).join(' ') : ''}\n`;
  
  // Write to console
  switch (level) {
    case 'error':
      console.error(prefix, message, ...normalizedArgs);
      break;
    case 'warn':
      console.warn(prefix, message, ...normalizedArgs);
      break;
    default:
      console.log(prefix, message, ...normalizedArgs);
  }
  
  // Write to file (async, don't block)
  fs.appendFile(LOG_FILE, logLine, (err) => {
    if (err) {
      console.error('Failed to write to log file:', err);
    }
  });
};

const log = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  writeLog(level, prefix, message, ...args);
};

export default {
  error: (message, ...args) => log('error', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  info: (message, ...args) => log('info', message, ...args),
  debug: (message, ...args) => log('debug', message, ...args)
};
