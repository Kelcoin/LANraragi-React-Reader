import { clearArchiveSearchResponseCache, lrrApi } from './api';
import { removeArchivesFromCatalog } from './archiveMetadataCache';
import { extractEhGalleryUrl, getEhCookie, hasReadyEhFavoriteSync, removeEhFavorite, shouldSyncEhFavorite } from './ehFavoriteSync';
import { getSyncToken, getWorkerUrl } from './worker-config';
import { assertArchiveDeletionResult, runArchiveDeletionOperations } from './archiveDeletionCore.js';

export async function deleteArchiveWithFavoriteSync(archive, {
  syncEnabled = false,
  confirmationEnabled = true,
  continueOnFavoriteError = false,
  onFavoriteError,
  retryAttempts = 3,
  retryDelayMs = 100,
} = {}) {
  const archiveId = archive?.arcid || archive?.id;
  if (!archiveId) throw new Error('档案 ID 缺失');
  let galleryUrl = '';
  let favoriteSetupError = null;
  if (shouldSyncEhFavorite(syncEnabled, confirmationEnabled)) {
    galleryUrl = extractEhGalleryUrl(archive);
    if (!hasReadyEhFavoriteSync()) {
      favoriteSetupError = new Error('E-Hentai 收藏同步配置无效');
      if (!continueOnFavoriteError) throw favoriteSetupError;
      onFavoriteError?.({ galleryUrl, error: favoriteSetupError });
    } else if (!galleryUrl) {
      try { galleryUrl = extractEhGalleryUrl({ ...archive, ...await lrrApi.getArchive(archiveId) }); } catch {}
    }
  }
  await runArchiveDeletionOperations({
    favoriteOperation: galleryUrl && !favoriteSetupError
      ? () => removeEhFavorite({ galleryUrl, cookie: getEhCookie(), workerUrl: getWorkerUrl(), token: getSyncToken() })
      : null,
    archiveOperation: async () => assertArchiveDeletionResult(await lrrApi.deleteArchive(archiveId)),
    continueOnFavoriteError,
    onFavoriteError: (error) => onFavoriteError?.({ galleryUrl, error }),
    attempts: retryAttempts,
    delayMs: retryDelayMs,
  });
  removeArchivesFromCatalog(archiveId);
  clearArchiveSearchResponseCache();
  return archiveId;
}
