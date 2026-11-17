export function clock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function ago(at: number, now: number, language: string): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (seconds < 45) return format.format(0, 'second');
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400) return format.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 7 * 86_400) return format.format(-Math.round(seconds / 86_400), 'day');
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(at);
}

export function tokens(count: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(count);
}

export function money(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: amount < 1 ? 3 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function bytes(size: number, language: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, { style: 'unit', unit: units[unit], unitDisplay: 'short', maximumFractionDigits: 1 }).format(value);
}
