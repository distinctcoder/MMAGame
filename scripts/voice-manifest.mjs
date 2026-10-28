// Lists the voice clips in public/voice/ so the game only requests clips that exist.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';

const dir = 'public/voice';
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const clips = readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)).sort();
writeFileSync(`${dir}/manifest.json`, JSON.stringify(clips) + '\n');
console.log(`Voice manifest: ${clips.length} clip${clips.length === 1 ? '' : 's'}`);
