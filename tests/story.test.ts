// Story mode: the bout data, camps, career progress and payouts.
import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { CLASSES } from '../src/park/data';
import { defaultPark } from '../src/park/progress';
import { BOUTS, CHAPTERS, SHOW_MONEY } from '../src/story/data';
import { applyBout, boutPay, campLeft, champion, defaultStory, nextBout, normalizeStory, resultOf, useSession } from '../src/story/progress';
import { DRILLS } from '../src/training/drills';

describe('story data', () => {
  it('uses real styles, chapters and drills, with unique ids', () => {
    expect(new Set(BOUTS.map(b => b.id)).size).toBe(BOUTS.length);
    for (const b of BOUTS) {
      expect(SD.styles[b.opponent.style], b.id).toBeDefined();
      expect(CHAPTERS.some(c => c.id === b.chapter), b.id).toBe(true);
      for (const d of b.suggest) expect(DRILLS[d as keyof typeof DRILLS], `${b.id} suggests ${d}`).toBeDefined();
      expect(b.pre.length && b.win.length && b.loss.length, b.id).toBeTruthy();
    }
  });
  it('gets harder and pays more as the career goes on, and ends with a title fight', () => {
    for (let i = 1; i < BOUTS.length; i++) expect(BOUTS[i].purse).toBeGreaterThan(BOUTS[i - 1].purse);
    expect(BOUTS[BOUTS.length - 1].title).toBe(true);
    expect(BOUTS[BOUTS.length - 1].rounds).toBe(5);
  });
});

describe('fight camp', () => {
  it('limits sessions, and each class once per camp', () => {
    let s = defaultStory();
    const camp = nextBout(s)!.camp;
    s = useSession(s, 'class:roadwork')!;
    expect(useSession(s, 'class:roadwork')).toBeNull();
    for (let i = 1; i < camp; i++) s = useSession(s, 'drill:block')!;
    expect(campLeft(s)).toBe(0);
    expect(useSession(s, 'drill:block')).toBeNull();
    expect(CLASSES.some(c => c.id === 'roadwork')).toBe(true);
  });
});

describe('career', () => {
  it('moves on only after a win, and pays show money for a loss', () => {
    const park = defaultPark(), first = BOUTS[0];
    const loss = applyBout(useSession(defaultStory(), 'drill:block')!, park, 'loss', 'KO')!;
    expect(loss.story.next).toBe(0);
    expect(loss.story.camp).toEqual([]);
    expect(loss.pay).toEqual({ cash: Math.round(first.purse * SHOW_MONEY), rep: 0 });
    expect(loss.story.last).toMatchObject({ bout: first.id, result: 'loss' });
    const win = applyBout(loss.story, loss.park, 'win', 'Decision')!;
    expect(win.story.next).toBe(1);
    expect(win.park.cash).toBe(park.cash + boutPay(first, 'loss').cash + first.purse);
    expect(win.park.rep).toBe(first.rep);
    expect(win.story.record).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(resultOf(win.story, first.id)).toBe('win');
  });
  it('ends as champion after the last bout', () => {
    let s = defaultStory(), park = defaultPark();
    for (let i = 0; i < BOUTS.length; i++) ({ story: s, park } = applyBout(s, park, 'win', 'KO')!);
    expect(champion(s)).toBe(true);
    expect(nextBout(s)).toBeNull();
    expect(applyBout(s, park, 'win', 'KO')).toBeNull();
  });
  it('repairs bad saves', () => {
    expect(normalizeStory(undefined)).toEqual(defaultStory());
    const s = normalizeStory({ next: 99, last: { bout: 'nobody', result: 'win', how: 'KO' }, history: [{ bout: 'nobody', result: 'win', how: '' }] });
    expect(s.next).toBe(BOUTS.length);
    expect(s.last).toBeNull();
    expect(s.history).toEqual([]);
  });
});
