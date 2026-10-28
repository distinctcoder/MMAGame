// Story mode: chapters, the eight bouts from the amateurs to the title, and what everyone says along the way.
import type { Level, Stat } from '../fight/rules';
import type { Palette } from '../rig/stage';

export interface Line { who: string; text: string }
export interface Chapter { id: string; name: string; blurb: string }
export interface Opponent {
  name: string; nick: string; style: string; level: Level; record: string;
  boost?: Partial<Record<Stat, number>>;
  palette: Pick<Palette, 'skin' | 'hair' | 'shorts' | 'trim' | 'glove' | 'cuff'>;
}
export interface Bout {
  id: string; chapter: string; event: string; opponent: Opponent;
  rounds: number; roundMs: number;
  /** Win purse. A loss pays SHOW_MONEY of it. Wins also add park rep. */
  purse: number; rep: number;
  /** Camp sessions before the fight. */
  camp: number;
  scout: string;
  /** Drills the scouting report points to. */
  suggest: string[];
  pre: Line[]; win: Line[]; loss: Line[];
  title?: boolean;
}

export const COACH = 'Coach Ruiz';
export const SHOW_MONEY = 0.4;

export const CHAPTERS: Chapter[] = [
  { id: 'amateur', name: 'Amateur circuit', blurb: 'Three rounds of a minute. Small crowds, smaller checks. Win the bracket and the pros notice.' },
  { id: 'regional', name: 'Regional pro', blurb: 'Your pro debut on the regional cards. Real rounds, real money, real hitters.' },
  { id: 'title', name: 'Title run', blurb: 'An eliminator, then five rounds for the belt.' }
];

const AMATEUR = { rounds: 3, roundMs: 60000 };
const PRO = { rounds: 3, roundMs: 90000 };

export const BOUTS: Bout[] = [
  {
    id: 'reyes', chapter: 'amateur', event: 'Amateur night, rec center', ...AMATEUR, purse: 150, rep: 6, camp: 2,
    opponent: { name: 'Tommy Reyes', nick: 'Kid', style: 'boxing', level: 'easy', record: '2-1',
      palette: { skin: '#c48a62', hair: '#1c140f', shorts: '#e8e8e8', trim: '#2457b5', glove: '#2457b5', cuff: '#e8e8e8' } },
    scout: 'A boxer with fast hands and no kicks. He never checks a leg kick, and he walks straight in.',
    suggest: ['block', 'combo'],
    pre: [
      { who: COACH, text: "First one's the hardest. Not because of him. Because of the lights." },
      { who: COACH, text: 'He only punches. Kick the legs, keep your hands up, and let him walk into you.' }
    ],
    win: [{ who: COACH, text: 'That is how you start a career. Ice those shins. Next week is a karate guy.' }],
    loss: [{ who: COACH, text: 'Everybody loses one. Watch the tape with me, we run it back.' }]
  },
  {
    id: 'bellini', chapter: 'amateur', event: 'Amateur semifinal', ...AMATEUR, purse: 200, rep: 8, camp: 2,
    opponent: { name: 'Marco Bellini', nick: 'Snapkick', style: 'karate', level: 'easy', record: '4-1', boost: { speed: 4 },
      palette: { skin: '#e4b896', hair: '#3b2416', shorts: '#f4f4f0', trim: '#c8232c', glove: '#2b2f37', cuff: '#c8232c' } },
    scout: 'Long range, bladed stance, quick head kicks. He hates being crowded and fades when you make him work.',
    suggest: ['dodge', 'read'],
    pre: [
      { who: 'Marco Bellini', text: "I watched your fight. You're slow. I'll be gone before you swing." },
      { who: COACH, text: 'Cut the cage, take his kicks on the arms, and close the distance. Make it a fight.' }
    ],
    win: [
      { who: COACH, text: 'Final is next. And look who else made it.' },
      { who: 'Victor Kane', text: "Enjoy the semifinal. It's the last fight you win." }
    ],
    loss: [{ who: COACH, text: 'Kicks from range got you. Work your head movement and get inside next time.' }]
  },
  {
    id: 'kane1', chapter: 'amateur', event: 'Amateur final', ...AMATEUR, purse: 300, rep: 12, camp: 3,
    opponent: { name: 'Victor Kane', nick: 'The Viper', style: 'wrestling', level: 'normal', record: '5-0',
      palette: { skin: '#e2a98a', hair: '#151010', shorts: '#141414', trim: '#3fbf74', glove: '#141414', cuff: '#3fbf74' } },
    scout: 'Undefeated wrestler. He shoots the moment you throw a lazy jab and holds you down all round.',
    suggest: ['sprawl', 'block'],
    pre: [
      { who: 'Victor Kane', text: "Five fights, five finishes. You're just number six." },
      { who: COACH, text: 'He wants to wrestle. Sprawl, punish the shot, and make him stand with you.' }
    ],
    win: [
      { who: COACH, text: 'Amateur champion. A promoter called before you were out of the cage. You turn pro.' },
      { who: 'Victor Kane', text: 'This is not over. See you on the other side.' }
    ],
    loss: [{ who: COACH, text: 'He took you down and kept you there. Sprawl drills, all camp. We want him again.' }]
  },
  {
    id: 'price', chapter: 'regional', event: 'Pro debut, Riverside Arena', ...PRO, purse: 600, rep: 12, camp: 3,
    opponent: { name: 'Jamal Price', nick: 'Elbows', style: 'muay_thai', level: 'normal', record: '4-2',
      palette: { skin: '#6e4530', hair: '#0b0807', shorts: '#e0398a', trim: '#f0c419', glove: '#e0398a', cuff: '#f0c419' } },
    scout: 'Thai fighter. Heavy body kicks and a mean clinch. Do not stand still in front of him.',
    suggest: ['block', 'dodge'],
    pre: [
      { who: COACH, text: 'Pro rules, pro rounds. Ninety seconds feels long when someone is kicking your ribs.' },
      { who: 'Jamal Price', text: 'Welcome to the pros, rookie.' }
    ],
    win: [{ who: COACH, text: '1-0 as a pro. They put you on the next card already.' }],
    loss: [{ who: COACH, text: 'The body kicks added up. Block low, check the kicks, and get out of the clinch.' }]
  },
  {
    id: 'sato', chapter: 'regional', event: 'Regional card, Pier 9', ...PRO, purse: 750, rep: 14, camp: 3,
    opponent: { name: 'Bruno Sato', nick: 'The Octopus', style: 'bjj', level: 'normal', record: '7-2', boost: { guard: 6, top: 4 },
      palette: { skin: '#d49e78', hair: '#2a1a12', shorts: '#5a2d91', trim: '#f2f2f2', glove: '#23252b', cuff: '#5a2d91' } },
    scout: 'Black belt. Pulls guard, sweeps and hunts arms. On the feet he is ordinary.',
    suggest: ['sprawl', 'combo'],
    pre: [
      { who: COACH, text: 'Do not go to the ground with this man. Stuff the shot, stand him up, strike.' },
      { who: 'Bruno Sato', text: 'Everyone says they will keep it standing.' }
    ],
    win: [{ who: COACH, text: 'You stayed out of his world and won in yours. Next is a puncher.' }],
    loss: [{ who: COACH, text: 'Too long on the mat. Defend the shot and get up fast. We go again.' }]
  },
  {
    id: 'grant', chapter: 'regional', event: 'Regional main event', ...PRO, purse: 900, rep: 16, camp: 3,
    opponent: { name: 'Elias Grant', nick: 'Hammer', style: 'boxing', level: 'hard', record: '11-3', boost: { power: 8 },
      palette: { skin: '#8d5b3d', hair: '#0e0a08', shorts: '#7a0e14', trim: '#f2f2f2', glove: '#7a0e14', cuff: '#f2f2f2' } },
    scout: 'Former pro boxer with one-punch power. Slips well. Struggles with kicks and takedowns.',
    suggest: ['read', 'dodge'],
    pre: [
      { who: 'Elias Grant', text: 'One clean shot. That is all it takes.' },
      { who: COACH, text: 'Read the windup, move your head, and never stand at punching range for free.' }
    ],
    win: [
      { who: COACH, text: 'Regional champion in all but name. The big promotion called. They want you in an eliminator.' },
      { who: COACH, text: 'Against Victor Kane.' }
    ],
    loss: [{ who: COACH, text: 'You traded with a puncher. Slip, counter, and use your legs. Run it back.' }]
  },
  {
    id: 'kane2', chapter: 'title', event: 'Title eliminator', ...PRO, purse: 1500, rep: 20, camp: 4,
    opponent: { name: 'Victor Kane', nick: 'The Viper', style: 'wrestling', level: 'hard', record: '14-1',
      boost: { takedowns: 10, top: 8, td_defense: 6, power: 6, speed: 6, cardio: 6, chin: 6, defense: 6 },
      palette: { skin: '#e2a98a', hair: '#151010', shorts: '#141414', trim: '#3fbf74', glove: '#141414', cuff: '#3fbf74' } },
    scout: 'Better everywhere since the amateurs: real striking now, and the same relentless shot. He has one loss.',
    suggest: ['sprawl', 'read'],
    pre: [
      { who: 'Victor Kane', text: 'I have thought about that night every day for two years.' },
      { who: COACH, text: 'Winner fights for the belt. Everything we built is for these three rounds.' }
    ],
    win: [
      { who: 'Victor Kane', text: '...Go get the belt.' },
      { who: COACH, text: 'Five rounds with Andre Okafor. Nobody has finished him. Nobody.' }
    ],
    loss: [{ who: COACH, text: 'He was ready for us. We will be readier. Back to camp.' }]
  },
  {
    id: 'okafor', chapter: 'title', event: 'Championship', rounds: 5, roundMs: 90000, purse: 3000, rep: 40, camp: 4, title: true,
    opponent: { name: 'Andre Okafor', nick: 'The Wall', style: 'mma', level: 'hard', record: '22-0',
      boost: { power: 10, speed: 10, defense: 10, chin: 10, cardio: 10, kicks: 10, evasion: 10, clinch: 10, takedowns: 10, td_defense: 10, top: 10, guard: 10 },
      palette: { skin: '#5a3726', hair: '#0b0807', shorts: '#d4a017', trim: '#141414', glove: '#141414', cuff: '#d4a017' } },
    scout: 'Undefeated champion. Great at everything, never tired, never hurt. You will have to win rounds, not hope for a knockout.',
    suggest: ['read', 'sprawl', 'combo'],
    pre: [
      { who: 'Andre Okafor', text: 'Twenty-two have tried.' },
      { who: COACH, text: 'Five rounds. Win them one at a time. Defense first, then make him pay.' }
    ],
    win: [
      { who: COACH, text: 'AND NEW. Champion of the world.' },
      { who: 'Andre Okafor', text: 'Keep it warm. I want it back.' }
    ],
    loss: [{ who: COACH, text: 'You went toe to toe with the best there is. One more camp. We take that belt.' }]
  }
];
export const BOUT_BY_ID: Record<string, Bout> = Object.fromEntries(BOUTS.map(b => [b.id, b]));

export const FINALE: Line[] = [
  { who: COACH, text: 'From the rec center to the belt. I have been doing this thirty years, kid. You are the best I have trained.' },
  { who: COACH, text: 'Rest up. Then the park, the gym, whatever you want. You earned it.' }
];
