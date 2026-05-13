/* Starters registry — load files from server/starters/ at startup, expose via
 *  server-side `read_starter` tool so AI can cp them into project.
 *
 *  Add a new starter:
 *    1. Drop file into server/starters/<name>.<ext>
 *    2. List its short description in STARTER_MANIFEST below
 *    3. server/llm/build.mjs already copies *.js / *.html into bundled assets
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StarterEntry {
  name: string;
  filename: string;          // 文件名(starters/ 下)
  description: string;
  useCases: string[];
  /** suggested in-project destination(相对 .design/),agent 可不依此为准 */
  suggestedPath: string;
}

export const STARTER_MANIFEST: StarterEntry[] = [
  {
    name: 'device-frame',
    filename: 'device-frame.html',
    description:
      'Mobile/tablet device shell with status bar + keyboard placeholder. Pixel-accurate dimensions for iPhone 14 (390×844), Pixel 8 (412×915), iPad (820×1180). Variants iframe their actual page inside this frame.',
    useCases: [
      'Designing iOS / Android app screens (use to wrap variants/<slug>/index.html)',
      'Mobile-first responsive prototypes shown in realistic device context',
      'Side-by-side iPhone vs Pixel rendering for cross-platform check',
    ],
    suggestedPath: 'shared/device-frame.html',
  },
  {
    name: 'deck-stage',
    filename: 'deck-stage.js',
    description:
      'Slide deck infrastructure: auto-fit 1280×720 stages, keyboard nav (← → space PgDn/PgUp), fullscreen (f), print → PDF (p), speaker notes toggle (n), URL hash sync. Each `<section class="slide">` becomes a slide.',
    useCases: [
      'Pitch deck / presentation design',
      'Slide-based product narratives or onboarding flows',
      '"Make me 5 slides about X" tasks',
    ],
    suggestedPath: 'shared/deck-stage.js',
  },
  {
    name: 'image-slot',
    filename: 'image-slot.js',
    description:
      'Drag-and-drop image placeholder web component. Use `<image-slot slot-id="hero" aspect="16/9">` in HTML — empty state shows labeled striped placeholder (skill rule 5), drop an image to persist via localStorage + postMessage signal to host. Round attribute makes it circular (avatar).',
    useCases: [
      'Hero / banner / logo / avatar slots where user supplies real assets later',
      'Replacing AI-generated stock images (which violate skill rule 5) with user-fed real images',
      'Mobile mockups that need real user content (profile pics, product photos)',
    ],
    suggestedPath: 'shared/image-slot.js',
  },
];

function resolveStartersDir(): string {
  // Source mode: __dirname = server/starters → use it
  // Bundled (dist-electron/main.mjs): __dirname = dist-electron → starters copied as siblings
  const candidates = [
    __dirname,
    join(__dirname, '..', 'starters'),
    join(__dirname, 'starters'),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, 'device-frame.html'))) return p;
  }
  return __dirname; // best effort
}

const STARTERS_DIR = resolveStartersDir();

const STARTER_BODIES = new Map<string, string>();
for (const entry of STARTER_MANIFEST) {
  const filePath = join(STARTERS_DIR, entry.filename);
  if (existsSync(filePath)) {
    try {
      STARTER_BODIES.set(entry.name, readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.warn(`[starters] failed to read ${entry.filename}:`, (e as Error).message);
    }
  } else {
    console.warn(`[starters] missing file ${filePath}`);
  }
}

export function listStarters(): StarterEntry[] {
  return STARTER_MANIFEST.filter((e) => STARTER_BODIES.has(e.name));
}

export function readStarter(name: string): {
  entry: StarterEntry;
  body: string;
} | null {
  const entry = STARTER_MANIFEST.find((e) => e.name === name);
  if (!entry) return null;
  const body = STARTER_BODIES.get(name);
  if (!body) return null;
  return { entry, body };
}
