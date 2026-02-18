export function normalizeUploadDate(value?: string): string | undefined {
  if (!value) return undefined;
  // yt-dlp upload_date is often YYYYMMDD.
  if (/^\d{8}$/.test(value)) return value;
  // Accept YYYY-MM-DD and normalize to YYYYMMDD.
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    // Unexpected format; keep filtering permissive but log for debugging.
    process.stderr.write(
      `[date] Unexpected upload_date format: ${value}\n`
    );
    return undefined;
  }
  return `${m[1]}${m[2]}${m[3]}`;
}

export function isAfterDate(uploadDate?: string, after?: string): boolean {
  if (!after) return true;
  const u = normalizeUploadDate(uploadDate);
  const a = normalizeUploadDate(after);
  if (!u || !a) return true;
  return u >= a;
}

export function isBeforeDate(uploadDate?: string, before?: string): boolean {
  if (!before) return true;
  const u = normalizeUploadDate(uploadDate);
  const b = normalizeUploadDate(before);
  if (!u || !b) return true;
  return u <= b;
}
