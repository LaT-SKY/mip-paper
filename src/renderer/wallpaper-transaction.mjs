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
      applyColor({ ...transaction.color, wallpaperLuminance: transaction.wallpaperLuminance });
      if (!transaction.color.analyzeWallpaper) return true;
      const analysis = await analyzeImage(image);
      if (token !== latestToken || !analysis) return false;
      await submitAccent({
        rgb: analysis.rgb,
        luminance: analysis.luminance,
        wallpaperIdentity: transaction.wallpaperIdentity,
        contentKey: transaction.contentKey,
        generation: transaction.generation,
      });
      return token === latestToken;
    },
  };
}
