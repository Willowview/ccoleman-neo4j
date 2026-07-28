/** Hardcoded ALB path prefix — must match APP_ROOT in src/index.js */
export function getBase() {
  return "/kg-app-2";
}

/** Prefix an absolute app path (must start with /). */
export function withBase(path) {
  const base = getBase();
  if (path == null || path === "") return `${base}/`;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
