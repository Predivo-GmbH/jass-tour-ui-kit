// SR-HOST-11: shared by the offline source guard and visitor-only live checks.
// Copied from mitchind 8e62d061; inspect the raw path before URL normalisation.
export function scannerPath(value) {
  // Decode before checking, but never use URL.pathname: URL would erase ../ before we can detect it.
  for (let n = 0; n < 3; n++) {
    try { const decoded = decodeURIComponent(value); if (decoded === value) break; value = decoded } catch { break }
  }
  const pathname = value.replace(/^(?:https?:)?\/\/[^/]+/i, '').split(/[?#]/)[0].replaceAll('\\', '/')
  if (/\s/.test(pathname)) return false
  return /(?:^|\/)\.(?:env|git|htaccess|htpasswd)(?:[./]|$)|\/\.(?!well-known(?:\/|$)|\.\/)[^/]+|\/docs(?:\/|$)|(?:^|\/)(?:wp-[^/]*|phpmyadmin|xmlrpc[^/]*|Credentials[^/]*)(?:\/|$)|\.(?:map|bak|sql)(?:$|[./-])|(?:^|\/)\.\.(?:\/|$)/i.test(pathname)
}
