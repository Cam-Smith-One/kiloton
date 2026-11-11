// BASELINE ui (lead). Click to start; nothing else.
import { G, bus, input } from '../core.js';
export default {
  name: 'ui',
  init() {
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:600 20px system-ui;background:#0008;cursor:pointer';
    el.textContent = 'KILOTON baseline — click to start'; G.uiRoot.appendChild(el);
    el.addEventListener('click', () => { input.lock(); bus.emit(G.state.phase === 'paused' ? 'ui:resume' : G.state.phase === 'over' ? 'ui:restart' : 'ui:start'); });
  },
  reset() {},
  update() { this.el.hidden = G.state.phase === 'playing'; },
};
