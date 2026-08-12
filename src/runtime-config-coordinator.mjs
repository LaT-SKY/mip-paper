export function createRuntimeConfigCoordinator({
  config,
  credentials = null,
  applyConfig = async () => {},
  applyCredentials = async () => {},
  onError = () => {},
} = {}) {
  let currentConfig = config;
  let currentCredentials = credentials;
  let generation = 0;
  let stopped = false;
  let queue = Promise.resolve();

  function report(kind, error) {
    const message = error?.message || String(error);
    onError(new Error(`${kind} reload failed: ${message.replace(/(apiHost|apiKey|host|key)\s*[:=]?\s*[^\s,;]+/gi, '$1=[redacted]')}`));
  }

  function enqueue(kind, candidate) {
    const candidateGeneration = ++generation;
    queue = queue.then(async () => {
      const isCurrent = () => !stopped && candidateGeneration === generation;
      const assertCurrent = () => {
        if (!isCurrent()) throw new Error('reload superseded');
      };
      if (!isCurrent()) return false;
      try {
        if (kind === 'credentials') {
          await applyCredentials(candidate, {
            config: currentConfig, generation: candidateGeneration, isCurrent, assertCurrent,
          });
          if (!isCurrent()) return false;
          currentCredentials = candidate;
        } else {
          await applyConfig(candidate, {
            credentials: currentCredentials, generation: candidateGeneration, isCurrent, assertCurrent,
          });
          if (!isCurrent()) return false;
          currentConfig = candidate;
        }
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        report(kind, error);
        return false;
      }
    });
    return queue;
  }

  return {
    updateConfig: (candidate) => enqueue('config', candidate),
    updateCredentials: (candidate) => enqueue('credentials', candidate),
    getState: () => ({ config: currentConfig, credentials: currentCredentials, generation }),
    whenIdle: () => queue,
    async stop() { stopped = true; generation += 1; await queue; },
  };
}
