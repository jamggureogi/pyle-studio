// System room: class tree, stat growth, skills, and a damage/AP calculator comparing rule sets.
import { h, toast, confirmBox } from '../ui.js';
import { requestPanel } from './requests.js';

const FILE = 'data/system/classes.json';
const LEVELS = ['1', '15', '30', '60'];
const CHAR_NAMES = { pyle: '파일', mirette: '미레트', fenel: '페넬' };
let D = null, sha = null, dirty = false, storeRef = null;

async function load(ctx) {
  const r = await ctx.store.getJSON(FILE);
  if (!r.data) throw new Error('시스템 데이터(data/system/classes.json)가 없어요.');
  D = r.data; sha = r.sha; dirty = false; storeRef = ctx.store;
}
const cls = id => D.classes.find(c => c.id === id);
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// Linear interpolation of a class's stats at any level from its snapshots.
export function statsAt(c, level) {
  const keys = Object.keys(c.statsAt).map(Number).sort((a, b) => a - b);
  if (level <= keys[0]) return { ...c.statsAt[keys[0]] };
  if (level >= keys.at(-1)) return { ...c.statsAt[keys.at(-1)] };
  const hi = keys.find(k => k >= level), lo = keys[keys.indexOf(hi) - 1];
  const t = (level - lo) / (hi - lo), a = c.statsAt[lo], b = c.statsAt[hi];
  return Object.fromEntries(Object.keys(a).map(k => [k, Math.round(a[k] + (b[k] - a[k]) * t)]));
}
export function apOf(rule, agi) {
  const r = rule.ap;
  let ap = r.base + Math.floor(Math.max(agi - r.from, 0) / r.per);
  return r.cap ? Math.min(ap, r.cap) : ap;
}
export function damageOf(rule, atk, def, power) {
  if (rule.damage === 'ratio') return Math.max(1, Math.round(atk * power / 100 * (rule.ratioK || 100) / ((rule.ratioK || 100) + def)));
  return Math.max(1, Math.round(atk * power / 100 - def));
}

function saveBar(ctx) {
  const msg = h('span', { class: 'msg' }, dirty ? '저장 안 한 변경 있음' : '모두 저장됨');
  const btn = h('button', { class: 'btn small primary', disabled: !dirty, onclick: async () => {
    try {
      const next = await ctx.store.updateJSON(FILE, latest => ({ ...latest, classes: D.classes, skills: D.skills, rules: D.rules }), '시스템 데이터 수정');
      D = next; dirty = false; toast('저장했어요.');
      msg.textContent = '모두 저장됨'; btn.disabled = true; bar.classList.remove('dirty');
    } catch (e) { toast(e.message, true); }
  } }, '저장');
  const bar = h('div', { class: `savebar ${dirty ? 'dirty' : ''}` }, msg, h('span', { class: 'spacer' }), btn);
  bar._mark = () => { dirty = true; msg.textContent = '저장 안 한 변경 있음'; btn.disabled = false; bar.classList.add('dirty'); };
  return bar;
}

export async function render(ctx, rest) {
  const tab = ['tree', 'stats', 'skills', 'calc', 'requests'].includes(rest[0]) ? rest[0] : 'tree';
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '⚔️ 시스템룸'),
    h('p', { class: 'sub' }, '직업과 전직, 능력치 성장, 기술, 전투 공식을 보고 고쳐요. 공식은 R14(이전 안)와 R15(Claude 초안)를 나란히 비교할 수 있어요.'),
    h('div', { class: 'tabs' }, [['tree', '직업 트리'], ['stats', '능력치 성장'], ['skills', '기술'], ['calc', '전투 계산기'], ['requests', '요청함']]
      .map(([id, l]) => h('a', { href: `#/system/${id}`, class: tab === id ? 'on' : '' }, l))));
  if (tab === 'requests') { page.append(requestPanel(ctx, 'system')); return page; }
  if (!D || storeRef !== ctx.store) await load(ctx);
  const bar = saveBar(ctx);
  page.append(bar);
  const mark = () => bar._mark();
  if (tab === 'tree') page.append(treeView(ctx, rest[1], mark));
  if (tab === 'stats') page.append(statsView(ctx, rest[1], rest[2], mark));
  if (tab === 'skills') page.append(skillsView(ctx, rest[1], mark));
  if (tab === 'calc') page.append(calcView());
  return page;
}

// ---------- tree ----------
function treeView(ctx, sel, mark) {
  const node = c => {
    const kids = D.classes.filter(k => k.parent === c.id);
    return h('div', { class: 'tnode' },
      h('a', { href: `#/system/tree/${c.id}`, class: `tcard tier${c.tier} ${sel === c.id ? 'on' : ''}` },
        h('b', {}, c.name), h('small', {}, `Lv${c.unlockLevel}~`), c.unlockNote && h('span', { title: c.unlockNote }, ' 🔒')),
      kids.length ? h('div', { class: 'tkids' }, kids.map(node)) : null);
  };
  const roots = D.classes.filter(c => !c.parent);
  const detail = sel && cls(sel) ? classDetail(ctx, cls(sel), mark) : h('div', { class: 'card empty' }, '직업을 누르면 설명과 기술이 보여요.');
  return h('div', {},
    h('div', { class: 'card tree-wrap' }, roots.map(r => h('div', { class: 'troot' }, h('h4', {}, CHAR_NAMES[r.character] || r.character), node(r)))),
    detail);
}

function classDetail(ctx, c, mark) {
  const concept = h('textarea', { rows: 2 }); concept.value = c.concept || '';
  concept.oninput = () => { c.concept = concept.value; mark(); };
  const skills = D.skills.filter(s => s.class === c.id);
  const st = c.statsAt;
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, c.name), h('span', { class: 'badge info' }, c.status || ''), h('span', { class: 'muted' }, `${CHAR_NAMES[c.character]} · ${c.tier}차 · Lv${c.unlockLevel}부터${c.parent ? ' · ' + cls(c.parent).name + '에서 전직' : ''}`)),
    c.unlockNote && h('p', { class: 'muted' }, '🔒 ' + c.unlockNote),
    h('label', { class: 'field' }, h('span', {}, '직업 설명'), concept),
    h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '레벨'), Object.values(D.stats).map(s => h('th', {}, s)), h('th', {}, 'AP R14→R15')),
      LEVELS.filter(l => st[l]).map(l => h('tr', {}, h('td', {}, `Lv${l}`), Object.keys(D.stats).map(k => h('td', {}, st[l][k])), h('td', {}, `${apOf(D.rules.current, st[l].agi)} → ${apOf(D.rules.draft, st[l].agi)}`)))),
    h('h4', {}, `기술 ${skills.length}개`),
    h('ul', {}, skills.map(s => h('li', {}, h('b', {}, s.name), ` · ${D.effects[s.effect] || s.effect} · 사거리 ${s.range}${s.area ? ` · 범위 ${s.area}` : ''} · AP ${s.r14.ap}→${s.draft.ap} · 위력 ${s.draft.power || '-'}%`))),
    h('a', { href: `#/system/stats/${c.id}` }, '능력치 성장 그래프 보기 →'));
}

// ---------- stats ----------
const COLORS = ['#4f7a5a', '#b4473b', '#6b8fb8', '#d4a33b', '#8a6bb8', '#5aa3a3'];
function statsView(ctx, aId, bId, mark) {
  const a = cls(aId) || D.classes[0], b = bId ? cls(bId) : null;
  const opts = sel => D.classes.map(c => h('option', { value: c.id, selected: c.id === sel }, `${CHAR_NAMES[c.character]} · ${c.name}`));
  const selA = h('select', {}, opts(a.id)); const selB = h('select', {}, h('option', { value: '' }, '(비교 안 함)'), opts(b?.id));
  const go = () => location.hash = `#/system/stats/${selA.value}/${selB.value}`;
  selA.onchange = go; selB.onchange = go;
  const statSel = h('select', {}, Object.entries(D.stats).map(([k, l]) => h('option', { value: k }, l)));
  const chartBox = h('div');
  const draw = () => chartBox.replaceChildren(chart([a, b].filter(Boolean), statSel.value));
  statSel.onchange = draw; draw();
  const table = h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, '레벨'), Object.values(D.stats).map(s => h('th', {}, s))),
    LEVELS.filter(l => a.statsAt[l]).map(l => h('tr', {}, h('td', {}, `Lv${l}`), Object.keys(D.stats).map(k => {
      const i = h('input', { type: 'number', value: a.statsAt[l][k], class: 'num' });
      i.oninput = () => { a.statsAt[l][k] = Number(i.value) || 0; mark(); draw(); };
      return h('td', {}, i);
    }))));
  return h('div', {},
    h('div', { class: 'card row' }, h('b', {}, '직업'), selA, h('b', {}, '비교'), selB, h('b', {}, '능력치'), statSel),
    h('div', { class: 'card' }, chartBox),
    h('div', { class: 'card' }, h('h2', {}, `${a.name} 능력치 (레벨별 기준값, 사이 레벨은 자동 계산)`), table));
}

function chart(list, stat) {
  const W = 760, H = 300, P = 40;
  const maxL = 60;
  const pts = list.map(c => { const out = []; for (let l = c.unlockLevel; l <= maxL; l++) out.push([l, stat === 'ap' ? 0 : statsAt(c, l)[stat]]); return out; });
  const maxV = Math.max(...pts.flat().map(p => p[1]), 1) * 1.1;
  const x = l => P + (l - 1) / (maxL - 1) * (W - P * 1.5), y = v => H - P - v / maxV * (H - P * 1.6);
  const svg = [`<svg viewBox="0 0 ${W} ${H}" class="chart">`];
  for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; svg.push(`<line x1="${P}" x2="${W - P / 2}" y1="${y(v)}" y2="${y(v)}" stroke="#e4dfd4"/><text x="${P - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7a766d">${Math.round(v)}</text>`); }
  for (const l of [1, 15, 30, 45, 60]) svg.push(`<text x="${x(l)}" y="${H - P + 18}" text-anchor="middle" font-size="11" fill="#7a766d">Lv${l}</text>`);
  pts.forEach((p, i) => svg.push(`<polyline fill="none" stroke="${COLORS[i]}" stroke-width="2.5" points="${p.map(([l, v]) => `${x(l)},${y(v)}`).join(' ')}"/>`));
  list.forEach((c, i) => svg.push(`<rect x="${P + 10 + i * 160}" y="8" width="12" height="12" fill="${COLORS[i]}"/><text x="${P + 28 + i * 160}" y="18" font-size="13">${c.name}</text>`));
  svg.push('</svg>');
  return h('div', { html: svg.join('') });
}

// ---------- skills ----------
function skillsView(ctx, filter, mark) {
  const sel = h('select', {}, h('option', { value: '' }, '모든 직업'), D.classes.map(c => h('option', { value: c.id, selected: c.id === filter }, `${CHAR_NAMES[c.character]} · ${c.name}`)));
  sel.onchange = () => location.hash = `#/system/skills/${sel.value}`;
  const list = D.skills.filter(s => !filter || s.class === filter);
  const cell = (obj, key, type = 'number') => {
    const i = h('input', { type, value: obj[key] ?? '', class: type === 'number' ? 'num' : '' });
    i.oninput = () => { obj[key] = type === 'number' ? Number(i.value) : i.value; mark(); };
    return h('td', {}, i);
  };
  const effSel = s => { const e = h('select', {}, Object.entries(D.effects).map(([v, l]) => h('option', { value: v, selected: v === s.effect }, l))); e.onchange = () => { s.effect = e.value; mark(); }; return h('td', {}, e); };
  return h('div', {},
    h('div', { class: 'card row' }, sel, h('span', { class: 'muted' }, `${list.length}개 · R15 값은 R14를 자동 변환한 초안이에요. 위력은 ×1.5 보정을 포함한 최종값.`)),
    h('div', { class: 'card', style: { overflowX: 'auto' } }, h('table', { class: 'tbl' },
      h('tr', {}, ['직업', '기술 이름', '효과', '사거리', '범위', 'R14 AP', 'R14 위력', 'R15 AP', 'R15 위력', '상태'].map(t => h('th', {}, t))),
      list.map(s => h('tr', {}, h('td', {}, cls(s.class)?.name), cell(s, 'name', 'text'), effSel(s), cell(s, 'range'), cell(s, 'area'),
        h('td', { class: 'muted' }, s.r14.ap), h('td', { class: 'muted' }, s.r14.power ? `${s.r14.power}%${s.r14.multiplier ? '×1.5' : ''}` : '-'),
        cell(s.draft, 'ap'), cell(s.draft, 'power'), h('td', {}, h('span', { class: 'badge info' }, s.status)))))));
}

// ---------- calculator ----------
function calcView() {
  const cOpts = sel => D.classes.map(c => h('option', { value: c.id, selected: c.id === sel }, `${CHAR_NAMES[c.character]} · ${c.name}`));
  const atkC = h('select', {}, cOpts('swordman')), defC = h('select', {}, cOpts('juggernaut'));
  const atkL = h('input', { type: 'number', value: 30, min: 1, max: 60, class: 'num' }), defL = h('input', { type: 'number', value: 30, min: 1, max: 60, class: 'num' });
  const skillSel = h('select');
  const out = h('div');
  const fillSkills = () => {
    const list = D.skills.filter(s => s.class === atkC.value && (s.draft.power || 0) > 0 && s.effect !== 'heal');
    skillSel.replaceChildren(h('option', { value: '' }, '평타 (위력 100%)'), ...list.map(s => h('option', { value: s.id }, s.name)));
  };
  const calc = () => {
    const A = cls(atkC.value), Dd = cls(defC.value);
    const la = Math.max(A.unlockLevel, Number(atkL.value) || 1), ld = Math.max(Dd.unlockLevel, Number(defL.value) || 1);
    const sa = statsAt(A, la), sd = statsAt(Dd, ld);
    const sk = D.skills.find(s => s.id === skillSel.value);
    const magic = sk && ['magic', 'root_magic'].includes(sk.effect);
    const row = (rule, label) => {
      const ap = apOf(rule, sa.agi);
      const power = sk ? (rule === D.rules.current ? sk.r14.power * (sk.r14.multiplier || 1) : sk.draft.power) : 100;
      const cost = sk ? (rule === D.rules.current ? sk.r14.ap : sk.draft.ap) : rule.basicAttackAp;
      const dmg = damageOf(rule, magic ? sa.mag : sa.atk, magic ? sd.res : sd.def, power);
      const uses = Math.floor(ap / cost);
      return h('tr', {}, h('td', {}, h('b', {}, label)), h('td', {}, ap), h('td', {}, cost), h('td', {}, uses), h('td', {}, dmg), h('td', {}, dmg * uses), h('td', {}, `${Math.ceil(sd.hp / dmg)}번`));
    };
    out.replaceChildren(
      h('p', { class: 'muted' }, `${A.name} Lv${la} (공격 ${sa.atk} · 마력 ${sa.mag} · 민첩 ${sa.agi}) → ${Dd.name} Lv${ld} (HP ${sd.hp} · 방어 ${sd.def} · 저항 ${sd.res})`),
      h('table', { class: 'tbl' }, h('tr', {}, ['공식', '한 턴 AP', '1회 AP', '한 턴 사용 횟수', '1회 피해', '한 턴 최대 피해', '쓰러뜨리는 횟수'].map(t => h('th', {}, t))),
        row(D.rules.current, D.rules.current.label), row(D.rules.draft, D.rules.draft.label)));
  };
  atkC.onchange = () => { fillSkills(); calc(); };
  [defC, atkL, defL, skillSel].forEach(el => el.addEventListener('input', calc));
  fillSkills(); calc();
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, '공격'), atkC, h('span', {}, 'Lv'), atkL, skillSel),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('b', {}, '대상'), defC, h('span', {}, 'Lv'), defL)),
    h('div', { class: 'card' }, out),
    h('div', { class: 'card muted', style: { fontSize: '13px' } },
      h('div', {}, `R14: AP = 10 + (민첩−10)÷5, 피해 = 공격×위력 − 방어`),
      h('div', {}, `R15: AP = 8 + 민첩÷10 (최대 20), 피해 = 공격×위력×100÷(100+방어)`)));
}
