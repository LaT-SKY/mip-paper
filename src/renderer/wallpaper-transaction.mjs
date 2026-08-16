function validIdentity(value) {
  return Boolean(value && typeof value.path === 'string' && value.path.length > 0
    && Number.isFinite(value.size) && value.size >= 0
    && Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0);
}

function validTransaction(value) {
  return Boolean(value && typeof value.wallpaperUrl === 'string' && value.wallpaperUrl.length > 0
    && validIdentity(value.wallpaperIdentity)
    && /^sha256:[0-9a-f]{64}$/.test(value.contentKey)
    && Number.isInteger(value.generation) && value.generation >= 0
    && (value.wallpaperLuminance === null
      || (Number.isFinite(value.wallpaperLuminance)
        && value.wallpaperLuminance >= 0 && value.wallpaperLuminance <= 1))
    && (value.audioNeutral === undefined || value.audioNeutral === null
      || (Array.isArray(value.audioNeutral) && value.audioNeutral.length === 3
        && value.audioNeutral.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)))
    && value.color && value.color.contentKey === value.contentKey
    && value.color.generation === value.generation);
}

export function createWallpaperTransactionCoordinator({
  loadImage,
  analyzeImage,
  submitAccent,
  applyColor,
  promoteImage,
} = {}) {
  if (![loadImage, analyzeImage, submitAccent, applyColor, promoteImage].every((fn) => typeof fn === 'function')) {
    throw new TypeError('wallpaper transaction dependencies are required');
  }
  let latestToken = 0;

  return {
    async apply(transaction) {
      if (!validTransaction(transaction)) throw new TypeError('invalid wallpaper transaction');
      const token = ++latestToken;
      const image = await loadImage(transaction.wallpaperUrl);
      if (token !== latestToken) return false;
      promoteImage(image, transaction);
      applyColor({ ...transaction.color, wallpaperLuminance: transaction.wallpaperLuminance,
        ...(transaction.audioNeutral ? { audioNeutral: transaction.audioNeutral } : {}) });
      if (!transaction.color.analyzeWallpaper) return true;
      const analysis = await analyzeImage(image);
      if (token !== latestToken || !analysis) return false;
      applyColor({ ...transaction.color, wallpaperLuminance: analysis.luminance,
        ...(analysis.audioNeutral ? { audioNeutral: analysis.audioNeutral } : {}) });
      if (!transaction.color.analyzeWallpaper) return true;
      await submitAccent({
        rgb: analysis.rgb,
        luminance: analysis.luminance,
        ...(analysis.audioNeutral ? { audioNeutral: analysis.audioNeutral } : {}),
        wallpaperIdentity: transaction.wallpaperIdentity,
        contentKey: transaction.contentKey,
        generation: transaction.generation,
      });
      return token === latestToken;
    },
  };
}
