let cachedPath: string | undefined;

function getSitePath(): string {
  if (cachedPath === undefined) {
    cachedPath = document.querySelector('meta[name="site-path"]')?.getAttribute('content') ?? '';
  }
  return cachedPath;
}

export function withPath(path: string): string {
  const base = getSitePath();
  if (!base) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}