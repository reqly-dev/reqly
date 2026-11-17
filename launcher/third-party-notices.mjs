#!/usr/bin/env node
// THIRD_PARTY_NOTICES.md üretir: dağıtılan pakete giren üçüncü taraf bileşenlerin lisansları.
//
//   node launcher/third-party-notices.mjs            # npm bağımlılıkları + sabit girdiler (Node.js, Inter)
//   node launcher/third-party-notices.mjs --cargo    # + Tauri kabuğunun Rust crate'leri (cargo gerekir;
//                                                    #   host'ta yok, builder imajında koşulur)
//
// npm: package-lock.json'daki dev olmayan paketler (app + server + shared'in üretim bağımlılık kapanışı;
// better-sqlite3'ün kurulum araçları gibi pakete girmeyen birkaç paket de içindedir, fazlası zararsız).
// Rust: `cargo metadata --filter-platform` ile Windows ve macOS hedeflerinin normal (build/dev olmayan)
// bağımlılık grafiği. Lisans metni paket dizinindeki LICENSE*/COPYING*/NOTICE* dosyalarından okunur;
// aynı metni taşıyan paketler tek başlık altında toplanır ki dosya şişmesin.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const withCargo = process.argv.includes('--cargo');
const OUT = join(root, 'THIRD_PARTY_NOTICES.md');
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .filter(Boolean);
}

/** @type {{ name: string, version: string, license: string, source: string, texts: string[] }[]} */
const components = [];

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || meta.dev || meta.link) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (name.startsWith('@reqly/')) continue;
  components.push({
    name,
    version: meta.version ?? '?',
    license: meta.license ?? 'belirtilmemiş',
    source: 'npm',
    texts: licenseTexts(join(root, path)),
  });
}

if (withCargo) {
  const seen = new Set();
  for (const platform of ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    const meta = JSON.parse(
      execFileSync(
        'cargo',
        ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(root, 'src-tauri/Cargo.toml'), '--filter-platform', platform],
        { maxBuffer: 256 * 1024 * 1024 },
      ).toString(),
    );
    const byId = new Map(meta.packages.map((p) => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    // kök crate'ten yalnızca normal bağımlılık kenarlarıyla ulaşılanlar (build-dependency'ler pakete girmez)
    const stack = [meta.resolve.root];
    const reach = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (reach.has(id)) continue;
      reach.add(id);
      for (const dep of nodes.get(id)?.deps ?? []) {
        if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
      }
    }
    for (const id of reach) {
      const p = byId.get(id);
      if (!p || id === meta.resolve.root || seen.has(id)) continue;
      seen.add(id);
      components.push({
        name: p.name,
        version: p.version,
        license: p.license ?? (p.license_file ? `dosya: ${p.license_file}` : 'belirtilmemiş'),
        source: 'crates.io',
        texts: licenseTexts(dirname(p.manifest_path)),
      });
    }
  }
}

const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const fixed = [
  {
    name: 'Node.js',
    version: nodeVersion,
    license: 'MIT (+ gömülü bileşenlerin lisansları)',
    source: 'nodejs.org — sidecar ikilisi',
    texts: [`Tam metin: https://github.com/nodejs/node/blob/v${nodeVersion}/LICENSE`],
  },
  {
    name: 'Inter',
    version: 'InterVariable',
    license: 'OFL-1.1',
    source: 'https://github.com/rsms/inter — packages/app/public/fonts',
    texts: [readFileSync(join(root, 'packages/app/public/fonts/OFL.txt'), 'utf8').trim()],
  },
];

components.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const all = [...fixed, ...components];

// metin → paket listesi (aynı lisans metnini taşıyanlar birlikte)
const groups = new Map();
const noText = [];
for (const c of all) {
  if (c.texts.length === 0) {
    noText.push(c);
    continue;
  }
  // her lisans dosyası ayrı gruplanır (MIT OR Apache-2.0 crate'lerinin ortak Apache metni bir kez yazılsın);
  // boşluk farkları (satır kırma, girinti) aynı metin sayılır, ilk görülen biçim yazılır
  for (const text of c.texts) {
    const key = text.replace(/\s+/g, ' ');
    if (!groups.has(key)) groups.set(key, { text, members: [] });
    groups.get(key).members.push(c);
  }
}

const line = (c) => `- ${c.name} ${c.version} — ${c.license} (${c.source})`;
let md = `# Üçüncü taraf bildirimleri / Third-party notices

Reqly Apache-2.0 lisanslıdır (bkz. \`LICENSE\`, \`NOTICE\`). Dağıtılan paket aşağıdaki üçüncü taraf
bileşenleri içerir; her biri kendi lisansıyla dağıtılır.

Bu dosya \`node launcher/third-party-notices.mjs${withCargo ? ' --cargo' : ''}\` ile üretilir, elle düzenlenmez.

## Bileşenler (${all.length})

${all.map(line).join('\n')}

## Lisans metinleri
`;
for (const { text, members } of groups.values()) {
  md += `\n---\n\n${members.map(line).join('\n')}\n\n\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\`\n`;
}
if (noText.length) {
  md += `\n---\n\nPaket içinde lisans dosyası bulunmayanlar (lisans türü paket bilgisinden):\n\n${noText.map(line).join('\n')}\n`;
}
writeFileSync(OUT, md);
console.log(`${OUT}: ${all.length} bileşen, ${groups.size} farklı lisans metni, ${noText.length} metinsiz`);
