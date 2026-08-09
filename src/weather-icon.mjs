export function qweatherIconClass(value) {
  const code = String(value ?? '');
  return /^\d{3}$/.test(code) ? `qi-${code}` : 'qi-999';
}
