function createPty(command, args, options) {
  // Loaded lazily so non-agent GitTree paths and unit tests do not require the native module.
  const pty = require('node-pty');
  return pty.spawn(command, args, { ...options, shell: false });
}

module.exports = { createPty };
