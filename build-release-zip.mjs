// Builds the release zip for GitHub Releases (see CLAUDE.md's "Release
// process" section). Ported from the sibling pf2e-weredragon module's own
// build-release-zip.mjs: don't zip this by hand with PowerShell's
// Compress-Archive, which stores every nested path with a literal
// backslash instead of the zip-spec-required forward slash -- confirmed
// by inspecting a past pf2e-weredragon release zip's raw central-directory
// bytes. archiver always writes forward slashes regardless of host OS.

import { ZipArchive } from "archiver";
import { createWriteStream, existsSync } from "node:fs";
import { rm } from "node:fs/promises";

const OUTPUT = "pf2e-hero-points.zip";

// Matches the file list documented in CLAUDE.md's release process.
// packs/ and src/ don't exist yet (no compendium content in this module
// yet, per CLAUDE.md) -- only included if present, same as build.mjs
// already skips a missing src/packs/* subfolder.
const REQUIRED_ENTRIES = [
  { path: "module.json", type: "file" },
  { path: "scripts", type: "dir" },
  { path: "build.mjs", type: "file" },
  { path: "README.md", type: "file" },
];
const OPTIONAL_ENTRIES = [
  { path: "packs", type: "dir" },
  { path: "src", type: "dir" },
];

if (existsSync(OUTPUT)) await rm(OUTPUT);

const output = createWriteStream(OUTPUT);
const archive = new ZipArchive({ zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on("close", resolve);
  archive.on("error", reject);
});

archive.pipe(output);

for (const entry of REQUIRED_ENTRIES) {
  if (!existsSync(entry.path)) {
    throw new Error(`Expected release entry not found: ${entry.path}`);
  }
  if (entry.type === "dir") {
    archive.directory(entry.path, entry.path);
  } else {
    archive.file(entry.path, { name: entry.path });
  }
}

for (const entry of OPTIONAL_ENTRIES) {
  if (!existsSync(entry.path)) continue;
  archive.directory(entry.path, entry.path);
}

await archive.finalize();
await done;

console.log(`Wrote ${OUTPUT}`);
