// Runs training drills on top of the fight: starts them with the right partner, shows score and progress, saves best scores.
import { SD } from '../data';
import type { Fight, FightEvent } from '../fight/fight';
import type { Input } from '../input/input';
import { DRILL_TRAINS, drillXp, STAT_LABEL } from '../park/data';
import { addXp } from '../park/progress';
import { recordDrill, type Profile } from '../profile/profile';
import type { UiSound } from '../audio/synth';
import type { Hud } from '../ui/hud';
import { DRILLS, SPAR_BEHAVIORS, type DrillId } from './drills';
import { currentCombo, handleEvent, newSession, OUTCOME_LABEL, tick, timeLeft, type Award, type Session } from './session';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface ProfileStore { get(): Profile; set(p: Profile): void }

export class TrainingController {
  drillId: DrillId = 'spar';
  /** Set when the drill was started from the park gym or a story fight camp; shows a way back. */
  returnTo: 'park' | 'story' | null = null;
  /** Plays score sounds; set by the app. */
  ui?: (kind: UiSound, step?: number) => void;
  /** Called when a scored drill finishes. */
  onDrillEnd?: (id: DrillId, score: number) => void;
  private session: Session | null = null;
  private ended = false;
  private flashTimer = 0;

  constructor(private fight: Fight, private input: Input, private hud: Hud, private store: ProfileStore) {}

  build() {
    const list = $('drills');
    list.innerHTML = '';
    for (const d of Object.values(DRILLS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.drill = d.id;
      const name = document.createElement('b'), info = document.createElement('span');
      name.textContent = d.name;
      b.append(name, info);
      b.addEventListener('click', () => { this.drillId = d.id; this.start(); });
      list.appendChild(b);
    }
    const spar = $<HTMLSelectElement>('spar');
    spar.innerHTML = '';
    for (const [id, b] of Object.entries(SPAR_BEHAVIORS)) spar.add(new Option(b.label, id));
    spar.addEventListener('change', () => {
      this.store.set({ ...this.store.get(), sparBehavior: spar.value });
      if (this.drillId === 'spar') this.start();
    });
    $('r-retry').addEventListener('click', () => this.start());
    $('r-pick').addEventListener('click', () => $('training-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    this.renderPanel();
  }

  private renderPanel() {
    const p = this.store.get(), d = DRILLS[this.drillId];
    document.querySelectorAll<HTMLButtonElement>('#drills button').forEach(b => {
      const drill = DRILLS[b.dataset.drill as DrillId], best = p.training[drill.id];
      b.classList.toggle('active', drill.id === this.drillId);
      b.querySelector('span')!.textContent = drill.kind === 'spar' ? 'No score' : best !== undefined ? `Best ${best}` : drill.count ? `${drill.count} reps` : `${drill.seconds} s`;
    });
    $('drill-name').textContent = d.name;
    $('drill-blurb').textContent = d.blurb + (d.kind === 'defense' && d.tells === undefined ? ' Turn off Show tells below for a harder read.' : '');
    const best = p.training[d.id];
    $('drill-best').textContent = d.kind === 'spar' ? '' : best !== undefined ? `Your best: ${best}` : 'No score yet';
    $('spar-field').hidden = d.kind !== 'spar';
    $<HTMLSelectElement>('spar').value = p.sparBehavior;
  }

  /** Start (or restart) the selected drill. */
  start() {
    const p = this.store.get(), d = DRILLS[this.drillId];
    const partner = d.partner || p.opponentStyle;
    const config = d.kind === 'spar' ? { ...d.config, cpu: SPAR_BEHAVIORS[p.sparBehavior]?.cpu ?? {} } : d.config;
    this.hud.clearLog();
    this.hud.clearBanner();
    this.fight.tells = d.tells ?? p.tells;
    this.fight.start({ redStyle: p.style, blueStyle: partner, level: d.level ?? p.level, redName: p.name, config });
    $('red-style').textContent = SD.styles[p.style].label;
    $('blue-style').textContent = SD.styles[partner].label;
    this.session = newSession(d, this.fight.now);
    this.ended = false;
    $('box').classList.add('training-on');
    $('drill-hud').hidden = false;
    $('results').hidden = true;
    $('r-park').hidden = !this.returnTo;
    $('r-park').textContent = this.returnTo === 'story' ? 'Back to camp' : 'Back to the park';
    $('dh-last').textContent = '';
    this.hud.log(d.name, d.kind === 'spar' ? SPAR_BEHAVIORS[p.sparBehavior]?.label : d.blurb);
    this.renderPanel();
  }

  /** Leaving training: hide the drill overlays. */
  stop() {
    this.session = null;
    $('box').classList.remove('training-on');
    $('drill-hud').hidden = true;
    $('results').hidden = true;
  }

  onEvent(e: FightEvent) {
    if (!this.session || this.ended) return;
    const a = handleEvent(this.session, e, this.fight.now);
    if (a) this.flash(a);
  }

  frame() {
    const s = this.session;
    if (!s) return;
    if (!this.ended) {
      const a = tick(s, this.fight.now);
      if (a) this.flash(a);
      if (s.over) this.end();
    }
    this.renderHud();
  }

  private flash(a: Award) {
    const s = this.session;
    if (a.good) this.ui?.(s?.drill.kind === 'combo' && a.points >= 100 ? 'combo' : 'point', s?.streak ?? 0);
    else this.ui?.('miss');
    const el = $('dh-last');
    el.textContent = (a.points ? `+${a.points} ` : '') + a.label;
    el.className = 'dh-last ' + (a.good ? 'good' : 'bad');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { el.textContent = ''; }, 1100);
  }

  private renderHud() {
    const s = this.session!, d = s.drill;
    $('dh-name').textContent = d.name;
    $('dh-score').textContent = d.kind === 'spar' ? '' : String(s.score);
    let progress = '';
    if (d.kind === 'spar') progress = `You landed ${s.landed} of ${s.thrown} · stopped ${s.stopped} of ${s.faced} of theirs`;
    else if (d.kind === 'combo') progress = `${Math.ceil(timeLeft(s, this.fight.now) ?? 0)} s left · ${s.combo!.done} combos`;
    else progress = `${d.kind === 'takedown' ? 'Shot' : 'Strike'} ${Math.min(s.count + (s.over ? 0 : 1), d.count!)} of ${d.count} · streak ${s.streak}`;
    $('dh-progress').textContent = progress;
    const chips = $('dh-combo'), combo = currentCombo(s);
    const html = combo && !s.over ? combo.seq.map((k, i) => `<span class="${i < combo.idx ? 'done' : i === combo.idx ? 'next' : ''}">${SD.strikes[k].label} <kbd>${this.input.key(k)}</kbd></span>`).join('') : '';
    if (chips.innerHTML !== html) chips.innerHTML = html;
  }

  private end() {
    const s = this.session!, d = s.drill;
    this.ended = true;
    // Stop the partner and stand them still while the results show.
    this.fight.config = { ...this.fight.config, cpu: { attack: false, defend: false, move: false, takedowns: false, clinch: false } };
    this.hud.tell(null);
    const { profile: scored, best } = recordDrill(this.store.get(), d.id, s.score);
    const prev = this.store.get().training[d.id];
    // Drills also train your fighter's stats for park fights.
    const trains = DRILL_TRAINS[d.id];
    const { park, gains } = trains ? addXp(scored.park, trains, drillXp(s.score)) : { park: scored.park, gains: [] };
    const profile = { ...scored, park };
    this.store.set(profile);
    $('r-xp').textContent = gains.map(g => `+${g.xp} ${STAT_LABEL[g.stat]} XP${g.to > g.from ? ` (level ${g.to})` : ''}`).join(' · ');
    $('r-xp').hidden = !gains.length;
    if (gains.some(g => g.to > g.from)) this.ui?.('level');
    $('r-score').textContent = String(s.score);
    const bestEl = $('r-best');
    bestEl.textContent = best ? (prev === undefined ? 'First score saved' : `New best! Old best ${prev}`) : `Your best: ${profile.training[d.id]}`;
    bestEl.className = best ? 'new' : '';
    const tally = Object.entries(s.tally).sort((a, b) => b[1]! - a[1]!).map(([k, n]) => `${n} ${OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL].toLowerCase()}`);
    $('r-detail').textContent = d.kind === 'combo' ? `${s.combo!.done} combos landed. Best run: ${s.bestStreak} in a row.`
      : `${tally.join(', ')}. Best streak: ${s.bestStreak}.`;
    $('results').hidden = false;
    this.onDrillEnd?.(d.id, s.score);
    this.hud.log(`${d.name}: ${s.score} points`, best ? 'New best' : `Best ${profile.training[d.id]}`);
    this.renderPanel();
  }
}
