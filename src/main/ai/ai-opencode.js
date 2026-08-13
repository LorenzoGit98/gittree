function collectOpencodeText(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const parts = [];
  let errorMessage = '';
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'error') {
      const message = event?.error?.data?.message
        || event?.error?.message
        || event?.error?.name
        || 'OpenCode error';
      if (!errorMessage) errorMessage = String(message);
    }
    if (event.type === 'message' && event.part?.type === 'text') {
      const text = String(event.part.text || '').trim();
      if (text) parts.push(text);
    }
  }
  if (errorMessage && !parts.length) throw new Error(errorMessage);
  const output = parts.join('\n').trim();
  if (!output) throw new Error('OpenCode did not return any text');
  return output;
}

function generateWithOpencode({ execute, executable, prompt, timeoutMs, maxBuffer }) {
  return new Promise((resolve, reject) => {
    try {
      execute(executable, ['run', prompt, '--format', 'json'], {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: maxBuffer || 1024 * 1024
      }, (error, stdout) => {
        if (error) {
          reject(new Error(
            error.code === 'ETIMEDOUT' ? 'OpenCode timed out' : (error.message || 'OpenCode failed')
          ));
          return;
        }
        try {
          resolve(collectOpencodeText(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      });
    } catch (error) {
      reject(new Error(error.message || 'OpenCode failed'));
    }
  });
}

module.exports = { generateWithOpencode, collectOpencodeText };
