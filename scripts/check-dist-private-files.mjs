#!/usr/bin/env node
// SR-HOST-04/05: extracted from mitchind's upload-plan.mjs private-artifact refusal.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkDist(dir) {
  if (!fs.statSync(dir).isDirectory()) throw new Error('Build output must be a directory')
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = entry.name
      const file = relative ? `${relative}/${name}` : name
      // Fail before BOTH the full mirror and the incremental plan. A source map must never be uploaded even if
      // the host serves static files before Apache can deny it. Do not include contents in this error.
      const allowedDot = (name === '.htaccess' && entry.isFile()) || (name === '.well-known' && entry.isDirectory())
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())
        || (name.startsWith('.') && !allowedDot)
        || /^(?:Credentials.*|package.*\.json)$|(?:\.map|\.sql|\.bak(?:-[^/]*)?|\.orig|~)$/i.test(name)
        || (entry.isDirectory() && /^(?:node_modules|docs|backup|tmp)$/i.test(name))) {
        throw new Error(`Refuse unsafe public upload: ${file}`)
      }
      const absolute = path.join(directory, name)
      if (entry.isDirectory()) walk(absolute, file)
      else if (/\.js$/i.test(name) && /\/\/[#@]\s*sourceMappingURL\s*=|\/\*[#@]\s*sourceMappingURL\s*=/i.test(fs.readFileSync(absolute, 'utf8'))) {
        throw new Error(`Refuse unsafe public upload: ${file} (sourceMappingURL comment)`)
      }
    }
  }
  walk(dir)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/check-dist-private-files.mjs dist')
    checkDist(path.resolve(process.argv[2]))
    console.log('Build output contains no private artifacts or source-map comments.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
