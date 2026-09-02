import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { existsSync, rmSync } from "fs";

const packs = [
  { src: "src/packs/items", dest: "packs/items" },
];

for (const { src, dest } of packs) {
  if (!existsSync(src)) {
    console.log(`Skipping ${src} -> ${dest} (no source yet)`);
    continue;
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  await compilePack(src, dest, { yaml: false });
  console.log(`Compiled ${src} -> ${dest}`);
}
