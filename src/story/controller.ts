// The story screen: the coach's words, the next opponent's tale of the tape, the fight camp and the career ladder.
import { SD } from '../data';
import type { Color, Fight } from '../fight/fight';
import { withBoost, type Stat } from '../fight/rules';
import { CLASSES, DRILL_TRAINS, STAT_LABEL } from '../park/data';
import { addXp, boosts } from '../park/progress';
import type { UiSound } from '../audio/synth';
import type { Profile } from '../profile/profile';
import { PALETTES, type FighterMesh } from '../rig/stage';
import { DRILLS, type DrillId } from '../training/drills';
import { BOUTS, CHAPTERS, FINALE, type Bout, type Line } from './data';
import { applyBout, campLeft, champion, defaultStory, nextBout, resultOf, useSession, type StoryState } from './progress';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = (n: number) => '$' + n.toLocaleString('en-US');
const BTN = { cross: 0, circle: 1, up: 12, down: 13, left: 14, right: 15 };

export interface StoryHooks {
  get(): Profile;
  set(p: Profile): void;
  startDrill(id: DrillId): void;
  startBout(): void;
  ui?(kind: UiSound): void;
}

/** Tale of the tape: groups of stats, averaged. */
const TAPE: [string, Stat[]][] = [
  ['Striking', ['power', 'speed', 'kicks']], ['Defense', ['defense', 'evasion', 'chin']],
  ['Wrestling', ['takedowns', 'td_defense', 'clinch']], ['Ground', ['top', 'guard']], ['Cardio', ['cardio']]
];

export class StoryController {
  private active = false;
  private message = '';
  private padPrev: boolean[] = [];
  private bout: Bout | null = null;

  constructor(private opponent: FighterMesh, private hooks: StoryHooks) {}

  private get story(): StoryState { return this.hooks.get().story; }
  private save(story: StoryState, park = this.hooks.get().park) { this.hooks.set({ ...this.hooks.get(), story, park }); }

  build() {
    $('story-root').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (b && !b.disabled) this.act(b.dataset.act!, b.dataset.id || '');
    });
    $('br-go').addEventListener('click', () => { location.hash = '#story'; });
  }

  /** The next bout, for labels. */
  upcoming(): Bout | null { return nextBout(this.story); }

  enter() { this.active = true; this.message = ''; this.render(); }
  leave() { this.active = false; }

  /** A camp drill finished: it uses one session. */
  drillDone(id: DrillId) {
    const next = useSession(this.story, 'drill:' + id);
    if (next) this.save(next);
  }

  private act(act: string, id: string) {
    const s = this.story;
    if (act === 'continue') { this.save({ ...s, last: null }); this.message = ''; }
    if (act === 'fight') return this.hooks.startBout();
    if (act === 'drill') return this.hooks.startDrill(id as DrillId);
    if (act === 'class') {
      const c = CLASSES.find(k => k.id === id)!;
      const next = useSession(s, 'class:' + id);
      if (next) {
        // Camp classes are on the house.
        const { park, gains } = addXp(this.hooks.get().park, c.stats, c.xp);
        this.save(next, park);
        this.hooks.ui?.(gains.some(g => g.to > g.from) ? 'level' : 'click');
        this.message = `${c.name}: ` + (gains.map(g => `+${g.xp} ${STAT_LABEL[g.stat]} XP${g.to > g.from ? ` (level ${g.to})` : ''}`).join(', ') || 'already maxed');
      }
    }
    if (act === 'reset' && confirm('Start a new career? Your story record resets. Stats, gear and cash stay.')) {
      this.save(defaultStory());
      this.message = '';
    }
    this.render();
  }

  render() {
    const s = this.story, prof = this.hooks.get(), b = nextBout(s);
    const chapter = CHAPTERS.find(c => c.id === (b || BOUTS[BOUTS.length - 1]).chapter)!;
    const r = s.record;
    const talk = (lines: Line[], cont: boolean) => `<div class="st-talk">${lines.map(l => `<p><b>${esc(l.who)}</b>${esc(l.text)}</p>`).join('')}
      ${cont ? '<div class="row"><button type="button" class="hot" data-act="continue">Continue</button></div>' : ''}</div>`;
    let lines: Line[], cont = false;
    if (s.last) { const lb = BOUTS.find(x => x.id === s.last!.bout)!; lines = s.last.result === 'win' ? lb.win : lb.loss; cont = true; }
    else lines = b ? b.pre : FINALE;

    let main = '';
    if (s.last) { /* read the coach first */ } else if (!b) {
      main = `<section class="st-card st-champ"><span class="label">Champion</span><h2>${esc(prof.name)}</h2>
        <p>Career ${r.wins}-${r.losses}-${r.draws}. The belt is yours. Keep training at the park, or start a new career.</p>
        <div class="row"><a class="btn" href="#park">Go to the park</a><button type="button" data-act="reset">Start a new career</button></div></section>`;
    } else {
      main = `<div class="st-grid">${this.fightCard(b, prof)}${this.campCard(b, s, prof)}</div>`;
    }

    $('story-root').innerHTML = `
      <header class="st-head">
        <div class="eyebrow">Story · ${esc(chapter.name)}</div>
        <h1>${b?.title ? 'The <span class="corner">title</span>' : esc(chapter.name)}</h1>
        <p class="lede">${esc(chapter.blurb)}</p>
        <div class="record"><span class="label">Career</span> <b>${r.wins}-${r.losses}-${r.draws}</b>
          <span class="muted">${champion(s) ? 'Champion' : `Fight ${s.next + 1} of ${BOUTS.length}`} · ${money(prof.park.cash)}</span></div>
      </header>
      ${talk(lines, cont)}
      ${main}
      ${this.ladder(s)}`;
    // With a controller, keep a button focused after the panel redraws.
    if (this.active && this.padPrev.length && document.activeElement === document.body) this.focusFirst();
  }

  private fightCard(b: Bout, prof: Profile) {
    const o = b.opponent;
    const me = withBoost(SD.styles[prof.style], boosts(prof.park)), them = withBoost(SD.styles[o.style], o.boost);
    const avg = (st: typeof me, ks: Stat[]) => Math.round(ks.reduce((n, k) => n + st[k], 0) / ks.length);
    const rows = TAPE.map(([label, ks]) => {
      const a = avg(me, ks), c = avg(them, ks);
      return `<tr><td class="num ${a > c ? 'up' : ''}">${a}</td><th>${label}</th><td class="num ${c > a ? 'up' : ''}">${c}</td></tr>`;
    }).join('');
    const fmt = `${b.rounds} × ${b.roundMs / 60000 === 1 ? '1 min' : `${b.roundMs / 1000} s`}`;
    return `<section class="st-card">
      <div class="st-event"><span class="label">${esc(b.event)}</span><span class="muted">${fmt} · purse ${money(b.purse)}</span></div>
      <div class="st-vs">
        <div><b class="red">${esc(prof.name)}</b><span class="muted">${esc(SD.styles[prof.style].label)}</span></div>
        <span class="vs">vs</span>
        <div><b class="blue">${esc(o.name)}</b><span class="muted">“${esc(o.nick)}” · ${esc(SD.styles[o.style].label)} · ${esc(o.record)}</span></div>
      </div>
      <table class="tape"><tbody>${rows}</tbody></table>
      <p class="st-scout"><span class="label">Scouting</span>${esc(b.scout)}</p>
      <button type="button" class="hot st-fight" data-act="fight">Walk out</button>
    </section>`;
  }

  private campCard(b: Bout, s: StoryState, prof: Profile) {
    const left = campLeft(s);
    const pips = Array.from({ length: b.camp }, (_, i) => `<i class="${i < s.camp.length ? 'used' : ''}"></i>`).join('');
    const drills = (Object.keys(DRILL_TRAINS) as DrillId[]).map(id => {
      const d = DRILLS[id], tip = b.suggest.includes(id), n = s.camp.filter(x => x === 'drill:' + id).length;
      return `<li><div><b>${esc(d.name)}${tip ? ' <span class="pk-tag">Coach’s pick</span>' : ''}</b>
        <span class="muted">Trains ${DRILL_TRAINS[id]!.map(x => STAT_LABEL[x]).join(', ')}${n ? ` · done ${n}×` : ''}${prof.training[id] !== undefined ? ` · best ${prof.training[id]}` : ''}</span></div>
        <button type="button" data-act="drill" data-id="${id}" ${left ? '' : 'disabled'}>Train</button></li>`;
    }).join('');
    const classes = CLASSES.map(c => {
      const used = s.camp.includes('class:' + c.id);
      return `<li><div><b>${esc(c.name)}</b><span class="muted">+${c.xp} XP · ${c.stats.map(x => STAT_LABEL[x]).join(', ')}</span></div>
        <button type="button" data-act="class" data-id="${c.id}" ${left && !used ? '' : 'disabled'}>${used ? 'Done' : 'Free'}</button></li>`;
    }).join('');
    return `<section class="st-card">
      <div class="st-event"><span class="label">Fight camp</span><span class="pips" title="${left} of ${b.camp} sessions left">${pips}</span></div>
      <p class="muted small">${left ? `${left} session${left === 1 ? '' : 's'} left. Each drill or class uses one. Classes are free in camp. You can walk out early.` : 'Camp is over. Time to fight.'}</p>
      ${this.message ? `<p class="pk-msg">${esc(this.message)}</p>` : ''}
      <h3>Drills</h3><ul class="pk-list">${drills}</ul>
      <h3>Classes</h3><ul class="pk-list">${classes}</ul>
    </section>`;
  }

  private ladder(s: StoryState) {
    return `<section class="st-ladder"><h2>Career</h2>${CHAPTERS.map(ch => `<div class="st-chapter"><span class="label">${esc(ch.name)}</span><ol>
      ${BOUTS.filter(x => x.chapter === ch.id).map(x => {
        const i = BOUTS.indexOf(x), res = resultOf(s, x.id);
        const state = res === 'win' ? 'won' : i === s.next ? 'next' : i > s.next ? 'locked' : '';
        const tag = res === 'win' ? 'Won' : i === s.next ? (res ? 'Rematch' : 'Next') : i > s.next ? '' : '';
        return `<li class="${state}"><span>${i > s.next ? '???' : esc(x.opponent.name)}</span><span class="muted">${esc(x.event)}</span>${tag ? `<em>${tag}</em>` : ''}</li>`;
      }).join('')}</ol></div>`).join('')}</section>`;
  }

  // ---------- Fights ----------
  startBout(fight: Fight): boolean {
    const b = nextBout(this.story), prof = this.hooks.get();
    if (!b) return false;
    this.bout = b;
    const o = b.opponent;
    this.opponent.setPalette({ ...PALETTES.blue, ...o.palette });
    $('bout-result').hidden = true;
    fight.start({
      redStyle: prof.style, blueStyle: o.style, level: o.level, redName: prof.name, blueName: o.name,
      redBoost: boosts(prof.park), blueBoost: o.boost, config: { rounds: b.rounds, roundMs: b.roundMs }
    });
    return true;
  }

  endBout(winner: Color | null, how: string) {
    const b = this.bout;
    if (!b) return;
    const result = winner === 'red' ? 'win' : winner ? 'loss' : 'draw';
    const prof = this.hooks.get();
    const r = applyBout(prof.story, prof.park, result, how);
    if (!r) return;
    this.save(r.story, r.park);
    setTimeout(() => this.hooks.ui?.('cash'), 900);
    $('br-title').textContent = result === 'win' ? (b.title ? 'Champion' : 'You won') : result === 'loss' ? 'You lost' : 'Draw';
    $('br-pay').textContent = `+${money(r.pay.cash)}${r.pay.rep ? ` · +${r.pay.rep} park rep` : ''}`;
    $('br-detail').textContent = result === 'win'
      ? (champion(r.story) ? 'The belt is yours.' : `Next: ${BOUTS[r.story.next].opponent.name}, ${BOUTS[r.story.next].event.toLowerCase()}.`)
      : `Show money only. Another camp, then the rematch with ${b.opponent.name}.`;
    $('bout-result').hidden = false;
  }

  endBoutScreen() {
    this.opponent.setPalette(PALETTES.blue);
    $('bout-result').hidden = true;
  }

  // ---------- Controller navigation ----------
  private focusFirst() {
    const first = document.querySelector<HTMLButtonElement>('#story-root button:not(:disabled), #story-root a.btn');
    first?.focus({ preventScroll: true });
  }

  /** Called every frame while the story screen shows: the d-pad moves between buttons, ✕ presses, ○ goes to the menu. */
  poll() {
    if (!this.active) return;
    let gp: Gamepad | undefined;
    try { gp = [...(navigator.getGamepads?.() || [])].find((p): p is Gamepad => !!p && p.connected); } catch { return; }
    if (!gp) return;
    const now = gp.buttons.map(x => x.pressed), was = this.padPrev;
    this.padPrev = now;
    const down = (i: number) => now[i] && !was[i];
    const list = [...document.querySelectorAll<HTMLElement>('#story-root button:not(:disabled), #story-root a.btn')];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (d: number) => { const el = list[(i + d + list.length) % list.length] || list[0]; el?.focus(); el?.scrollIntoView({ block: 'nearest' }); };
    if (down(BTN.down) || down(BTN.right)) move(1);
    if (down(BTN.up) || down(BTN.left)) move(-1);
    if (down(BTN.cross)) { if (i >= 0) list[i].click(); else move(1); }
    if (down(BTN.circle)) location.hash = '#';
  }
}
