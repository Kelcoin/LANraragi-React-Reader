function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function assertArchiveDeletionResult(result) {
  if (Number(result?.success) === 0) {
    throw new Error(result?.error || result?.errorMessage || 'LANraragi 删除失败');
  }
  return result;
}

export async function retryOperation(operation, { attempts = 3, delayMs = 100 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(delayMs * attempt);
    }
  }
  throw lastError;
}

export async function runArchiveDeletionOperations({
  favoriteOperation,
  archiveOperation,
  continueOnFavoriteError = false,
  onFavoriteError,
  attempts = 3,
  delayMs = 100,
}) {
  if (favoriteOperation) {
    try {
      await retryOperation(favoriteOperation, { attempts, delayMs });
    } catch (error) {
      if (!continueOnFavoriteError) throw error;
      onFavoriteError?.(error);
    }
  }
  return retryOperation(archiveOperation, { attempts, delayMs });
}
