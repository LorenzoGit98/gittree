function errorEnvelope(error) {
  return { error: error?.message || String(error) };
}

function createHandlerRegistry({ handle, assertManagedRepo }) {
  if (typeof handle !== 'function') throw new TypeError('handle must be a function');
  if (typeof assertManagedRepo !== 'function') {
    throw new TypeError('assertManagedRepo must be a function');
  }

  const registerHandler = (channel, implementation) => {
    handle(channel, async (_event, ...args) => {
      try {
        return await implementation(...args);
      } catch (error) {
        return errorEnvelope(error);
      }
    });
  };

  const registerManagedRepoHandler = (channel, implementation) => {
    registerHandler(channel, async (repoPath, ...args) => {
      assertManagedRepo(repoPath);
      return implementation(repoPath, ...args);
    });
  };

  return { registerHandler, registerManagedRepoHandler };
}

module.exports = { createHandlerRegistry };
