// Menus with a controller: the D-pad or left stick moves focus to the nearest control in that direction,
// ✕ presses it, and ○ goes back. Used where there's no game to send input to (the main menu).
const FOCUSABLE = 'a[href], button:not([disabled]), select, input:not([type="hidden"])';
const REPEAT_MS = 220;

export class PadNav {
  private prev: boolean[] = [];
  private lastMove = 0;

  constructor(private root: () => HTMLElement | null, private back: () => void) {}

  poll(now: number) {
    let gp: Gamepad | undefined;
    try { gp = [...(navigator.getGamepads?.() || [])].find((p): p is Gamepad => !!p && p.connected); } catch { return; }
    const root = this.root();
    if (!gp || !root) { this.prev = []; return; }
    const b = gp.buttons.map(x => x.pressed), was = this.prev, down = (i: number) => b[i] && !was[i];
    this.prev = b;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const dx = b[15] || ax > 0.6 ? 1 : b[14] || ax < -0.6 ? -1 : 0, dy = b[13] || ay > 0.6 ? 1 : b[12] || ay < -0.6 ? -1 : 0;
    if ((dx || dy) && now - this.lastMove > REPEAT_MS) { this.lastMove = now; this.move(root, dx, dy); }
    if (!dx && !dy) this.lastMove = 0;
    const el = document.activeElement as HTMLElement | null;
    if (down(0) && el && root.contains(el)) {
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.click();
      else if (el instanceof HTMLSelectElement) { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true })); }
      else el.click();
    }
    if (down(1)) this.back();
  }

  /** Focus the nearest visible control in a direction (or the first one when nothing is focused yet). */
  private move(root: HTMLElement, dx: number, dy: number) {
    const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => e.offsetParent !== null);
    if (!all.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !root.contains(cur)) { all[0].focus(); all[0].scrollIntoView({ block: 'nearest' }); return; }
    const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best: HTMLElement | null = null, score = Infinity;
    for (const e of all) {
      if (e === cur) continue;
      const q = e.getBoundingClientRect(), ex = q.left + q.width / 2 - cx, ey = q.top + q.height / 2 - cy;
      const along = dx ? ex * dx : ey * dy, across = dx ? Math.abs(ey) : Math.abs(ex);
      if (along <= 4) continue;
      const s = along + across * 2.5;
      if (s < score) { score = s; best = e; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
  }
}
