export function errorEnvelope(error: unknown): { error: string } {
  return { error: (error as any)?.message || String(error) };
}

export interface HandlerRegistryOptions {
  handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => void;
  removeHandler?: (channel: string) => void;
  assertManagedRepo: (repoPath: unknown) => void;
}

export function createHandlerRegistry({ handle, removeHandler = () => {}, assertManagedRepo }: HandlerRegistryOptions) {
  if (typeof handle !== 'function') throw new TypeError('handle must be a function');
  if (typeof assertManagedRepo !== 'function') {
    throw new TypeError('assertManagedRepo must be a function');
  }

  const registeredChannels = new Set<string>();

  const registerHandler = (channel: string, implementation: (...args: any[]) => unknown) => {
    handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await implementation(...args);
      } catch (error) {
        return errorEnvelope(error);
      }
    });
    registeredChannels.add(channel);
  };

  const registerManagedRepoHandler = (channel: string, implementation: (...args: any[]) => unknown) => {
    registerHandler(channel, async (repoPath: unknown, ...args: unknown[]) => {
      assertManagedRepo(repoPath);
      return implementation(repoPath, ...args);
    });
  };

  const dispose = () => {
    for (const channel of registeredChannels) removeHandler(channel);
    registeredChannels.clear();
  };

  return { registerHandler, registerManagedRepoHandler, dispose };
}
