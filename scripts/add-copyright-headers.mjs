#!/usr/bin/env node
// Adds the dual-license SPDX header to every source file under apps/ and
// packages/. Idempotent: files that already carry an SPDX-FileCopyrightText
// line are left untouched. Run from the repo root:
//
//   node scripts/add-copyright-headers.mjs
//
// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname

const COPYRIGHT = "SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>"
const LICENSE = "SPDX-License-Identifier: SSPL-1.0"

// Extension -> function rendering the two header lines as a comment block.
const STYLES = {
  ".ts": (lines) => lines.map((l) => `// ${l}`).join("\n"),
  ".tsx": (lines) => lines.map((l) => `// ${l}`).join("\n"),
  ".mts": (lines) => lines.map((l) => `// ${l}`).join("\n"),
  ".mjs": (lines) => lines.map((l) => `// ${l}`).join("\n"),
  ".js": (lines) => lines.map((l) => `// ${l}`).join("\n"),
  ".css": (lines) => `/* ${lines[0]}\n * ${lines[1]} */`,
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "coverage"])

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...(await walk(join(dir, entry.name))))
    } else {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

const hasShebang = (content) => content.startsWith("#!")

let stamped = 0
let skipped = 0

for (const top of ["apps", "packages"]) {
  for (const file of await walk(join(ROOT, top))) {
    const ext = file.slice(file.lastIndexOf("."))
    const style = STYLES[ext]
    if (!style) continue
    const content = await readFile(file, "utf8")
    if (content.includes("SPDX-FileCopyrightText")) {
      skipped++
      continue
    }
    const header = `${style([COPYRIGHT, LICENSE])}\n\n`
    // Keep shebangs (#!) as line 1 — required for executable .mjs scripts.
    await writeFile(file, hasShebang(content) ? content.replace(/^#![^\n]*\n/, (m) => `${m}${header}`) : header + content)
    stamped++
  }
}

console.log(`copyright headers: stamped ${stamped}, already-present ${skipped}`)
