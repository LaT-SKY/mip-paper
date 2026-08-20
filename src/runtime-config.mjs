function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) { return Number.isFinite(value); }

export function validateRuntimeConfig(value) {
  const valid = object(value)
    && object(value.mouse)
    && typeof value.mouse.buttonsEnabled === 'boolean'
    && typeof value.mouse.interactionEnabled === 'boolean'
    && object(value.wallpaper) && ['kde', 'manual'].includes(value.wallpaper.mode)
    && ['cover', 'contain', 'stretch', 'center'].includes(value.wallpaper.fit ?? 'cover')
    && Number.isInteger(value.wallpaper.crossfadeMs ?? 0)
    && object(value.color) && ['default', 'kde', 'wallpaper', 'hybrid'].includes(value.color.mode)
    && Number.isInteger(value.color.transitionDurationMs)
    && object(value.appearance) && ['light', 'dark', 'system'].includes(value.appearance.mode)
    && object(value.appearance.dark) && finite(value.appearance.dark.wallpaperBrightness)
    && value.appearance.dark.wallpaperBrightness >= 0.2
    && value.appearance.dark.wallpaperBrightness <= 1
    && object(value.audio) && typeof value.audio.enabled === 'boolean'
    && finite(value.audio.gain) && finite(value.audio.silenceDelayMs)
    && finite(value.audio.fadeOutMs) && finite(value.audio.fadeInMs)
    && object(value.frameRate) && Number.isInteger(value.frameRate.interactive)
    && Number.isInteger(value.frameRate.drift)
    && object(value.motion) && finite(value.motion.interactionSpeed)
    && finite(value.motion.returnSpeed) && finite(value.motion.driftSpeed)
    && finite(value.motion.deadZonePx) && finite(value.motion.horizontalPanPercent)
    && finite(value.motion.verticalPanPercent) && finite(value.motion.maxRotationDegrees)
    && object(value.panel) && typeof value.panel.autoExpandHide === 'boolean'
    && finite(value.panel.expandTriggerDistancePx) && finite(value.panel.collapseDelaySeconds)
    && typeof value.panel.expanded === 'boolean' && finite(value.panel.collapsedOpacity)
    && finite(value.panel.borderRadius) && value.panel.borderRadius >= 0 && value.panel.borderRadius <= 24
    && finite(value.panel.surfaceOpacity ?? 0.77) && finite(value.panel.shadowIntensity ?? 1) && finite(value.panel.height ?? 400)
    && object(value.panel.animation) && finite(value.panel.animation.staggerDelayMs)
    && finite(value.panel.animation.durationMs)
    && object(value.weather) && object(value.weather.location)
    && ['auto', 'fixed'].includes(value.weather.location.mode)
    && typeof value.weather.location.fallbackLocationId === 'string'
    && typeof value.weather.tideStationId === 'string';
  if (!valid) throw new TypeError('invalid runtime configuration');
  return structuredClone(value);
}
