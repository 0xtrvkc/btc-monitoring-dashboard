import { ALL_INDICATORS, byId } from '../config.js';
import { esc } from '../ui.js';
import { renderOverlay } from '../overlay.js';

export function render(main, ctx, id) {
  const ind = byId(id) || byId('mvrv');
  main.innerHTML = `
  <div class="page-h"><div><h1>Cycle overlay</h1>
    <p>Every halving cycle on one axis, the indicator above and BTC price below (× the close of the day before each halving). ▲ marks each cycle's peak and ▼ its bottom, for the indicator and for price, so you can see which turned first.</p></div>
    <div class="right"><select class="sel" id="pick">${ALL_INDICATORS.map(x => `<option value="${x.id}" ${x.id === ind.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <button class="btn" data-go="#/ind/${ind.id}">Open indicator →</button></div></div>
  <div class="card"><div class="card-h"><h3>${esc(ind.name)} vs price</h3><span class="sub">hover either panel to read every cycle at that point · [ ] previous / next indicator</span></div><div id="ov"></div></div>`;
  main.querySelector('#pick').onchange = e => ctx.nav('#/overlay/' + e.target.value);
  renderOverlay(main.querySelector('#ov'), ctx.M, ind, { idPrefix: 'ovv', height: 380, priceHeight: 280 });
}
