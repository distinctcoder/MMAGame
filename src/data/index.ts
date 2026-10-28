// Game data, bundled at build time. Edit the JSON files to tune moves, poses and styles.
import strikesJson from './strikes.json';
import fightJson from './fight.json';
import type { FightData, StrikeData } from './types';

export const SD = strikesJson as unknown as StrikeData;
export const FD = fightJson as unknown as FightData;
export type { FightData, StrikeData } from './types';
