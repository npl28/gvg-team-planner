(() => {
  'use strict';

  const STORAGE_KEY = 'gvg-team-planner/v1';
  const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // Tag người dùng gắn cho từng sync pair (lưu theo id catalog); màu để phân biệt
  const PAIR_TAGS = [
    { name: 'Rebuff', color: '#8b5cf6' },
    { name: 'Damage Field', color: '#eab308' },
    { name: 'Special-DPS', color: '#3b82f6' },
    { name: 'Special-Enable', color: '#06b6d4' },
    { name: 'Physical-DPS', color: '#ef4444' },
    { name: 'Physical-Enable', color: '#f97316' },
    { name: 'Bulker', color: '#22c55e' },
  ];
  const BLOCK_DEFS = [
    { id: 'cheer-physical', title: 'Cheer Physical', category: 'PHYSICAL' },
    { id: 'carry-physical', title: 'Carry Physical', category: 'PHYSICAL' },
    { id: 'cheer-special', title: 'Cheer Special', category: 'SPECIAL' },
    { id: 'carry-special', title: 'Carry Special', category: 'SPECIAL' },
  ];

  // ---------------------------------------------------------------- utils

  const POMA_BASE = 'https://pomatools.site';
  const ICON_REMOTE = POMA_BASE + '/assets/';
  const CATALOG_KEY = 'gvg-team-planner/icon-catalog';
  const Match = window.GvgIconMatch;
  let CATALOG = [];
  let catById = new Map();
  let catalogInfo = { fetchedAt: 0, newIds: [] };
  const autoMatchCache = new Map();

  /** Bundled catalog (icons/catalog.js) merged with the one fetched by the "Cập nhật icon" button. */
  function loadCatalog() {
    const merged = new Map((window.GVG_ICON_CATALOG || []).map((e) => [e.id, e]));
    try {
      const saved = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
      if (saved && Array.isArray(saved.items)) {
        for (const e of saved.items) merged.set(e.id, { ...merged.get(e.id), ...e });
        catalogInfo = { fetchedAt: saved.fetchedAt || 0, newIds: saved.newIds || [] };
      }
    } catch (_) { /* dùng catalog đóng gói */ }
    setCatalog([...merged.values()]);
  }

  function setCatalog(items) {
    CATALOG = items.sort((a, b) => a.tr.localeCompare(b.tr) || a.pk.localeCompare(b.pk));
    catById = new Map(CATALOG.map((e) => [e.id, e]));
    autoMatchCache.clear();
  }
  loadCatalog();

  const $ = (sel, root = document) => root.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = (p) => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
  const str = (v) => (v == null ? '' : String(v));
  const fold = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'open') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : String(c));
    }
    return n;
  }

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + kind;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function ic(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  const TYPE_KEYS = new Set(['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
    'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']);

  function typeDot(key, title) {
    return el('span', { class: 'type-dot', title, style: TYPE_KEYS.has(key) ? `background:var(--t-${key})` : null });
  }

  /** Weakness type of a boss tab ("Grass (Roark)" / weakness "Grass" -> "grass"). */
  function bossType(b) {
    for (const s of [b.weakness, b.name]) {
      const w = fold(s).split(/[^a-z]+/)[0];
      if (TYPE_KEYS.has(w)) return w;
    }
    return '';
  }

  function searchBox(props) {
    return el('span', { class: 'search-field' }, ic('search'),
      el('input', { class: 'field', type: 'search', dataset: { search: '1' }, ...props }),
      el('kbd', { title: 'Nhấn / để tìm' }, '/'));
  }

  /** Text input bound to obj[key]; saves on every keystroke. */
  function bound(obj, key, props = {}, onInput) {
    return el('input', {
      class: 'edit', value: str(obj[key]), ...props,
      oninput: (e) => { obj[key] = e.target.value; save(); onInput && onInput(e); },
    });
  }

  /**
   * Ô ghi chú nhiều dòng bound vào obj[key]: tự giãn theo nội dung, cao tối đa maxRows dòng (dài hơn thì cuộn trong ô).
   * Enter xuống dòng; lưu theo từng phím như bound().
   */
  function boundArea(obj, key, props = {}, maxRows = 3) {
    const ta = el('textarea', {
      class: 'edit note-area', rows: 1, ...props,
      oninput: (e) => { obj[key] = e.target.value; save(); fitArea(ta, maxRows); },
      onfocus: () => fitArea(ta, maxRows),
    });
    ta.value = str(obj[key]);
    requestAnimationFrame(() => fitArea(ta, maxRows));
    return ta;
  }

  function fitArea(ta, maxRows) {
    if (!ta.isConnected) return;
    const cs = getComputedStyle(ta);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * maxRows + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border;
    ta.style.height = 'auto';
    const need = ta.scrollHeight + border;
    ta.style.height = Math.min(need, max) + 'px';
    ta.style.overflowY = need > max + 1 ? 'auto' : 'hidden';
  }

  /** Role = text in the last "(...)" of a pair name, like the Excel formula. */
  function roleOf(pairName) {
    const m = /\(([^()]*)\)\s*$/.exec(pairName || '');
    return m ? m[1] : '';
  }

  // ---------------------------------------------------------------- data

  function parseLevel(raw) {
    const s = str(raw).trim().toLowerCase();
    if (!s || s === '-' || s === '0' || s === 'x' || s.startsWith('k')) return { ok: true, v: null };
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n >= 1 && n <= 10) return { ok: true, v: n };
    }
    return { ok: false };
  }

  function cleanLevel(v) {
    const r = parseLevel(v);
    return r.ok ? r.v : null;
  }

  function emptySlot() {
    return { short: '', pair: null, pairName: '', req: null, note: '' };
  }

  function newTeam(label) {
    return { id: uid('t'), label, note: '', links: [], slots: [emptySlot(), emptySlot(), emptySlot()] };
  }

  function newBoss(name) {
    return {
      id: uid('b'), name, boss: '', weakness: '', passives: ['', '', ''], note: '',
      blocks: BLOCK_DEFS.map((b) => ({ ...b, teams: [newTeam('Team A'), newTeam('Team B')] })),
    };
  }

  function normSlot(s = {}) {
    return {
      short: str(s.short), pair: s.pair ? str(s.pair) : null, pairName: str(s.pairName),
      req: cleanLevel(s.req), note: str(s.note),
    };
  }

  function normBoss(b = {}) {
    const blocks = Array.isArray(b.blocks) ? b.blocks : [];
    return {
      id: str(b.id) || uid('b'),
      name: str(b.name) || 'Boss',
      boss: str(b.boss), weakness: str(b.weakness), note: str(b.note),
      passives: [0, 1, 2].map((i) => str((b.passives || [])[i])),
      blocks: blocks.map((bl, i) => ({
        id: str(bl.id) || (BLOCK_DEFS[i] || {}).id || uid('k'),
        title: str(bl.title) || (BLOCK_DEFS[i] || {}).title || 'Block',
        category: str(bl.category) || (BLOCK_DEFS[i] || {}).category || 'PHYSICAL',
        teams: (bl.teams || []).map((t) => ({
          id: str(t.id) || uid('t'), label: str(t.label), note: str(t.note),
          links: (Array.isArray(t.links) ? t.links : []).map(normLink),
          slots: [0, 1, 2].map((k) => normSlot((t.slots || [])[k])),
        })),
      })),
    };
  }

  function normLink(l = {}) {
    return { kind: l.kind === 'video' ? 'video' : 'grid', url: str(l.url).trim(), label: str(l.label) };
  }

  /** Một lần đánh của team OFF-TYPE ở kì GvG trước. */
  function normRecord(r = {}) {
    const pts = Number(r.points);
    return {
      id: str(r.id) || uid('r'), season: str(r.season), round: str(r.round), boss: str(r.boss), member: str(r.member),
      points: r.points !== '' && r.points != null && Number.isFinite(pts) ? pts : null,
      grid: str(r.grid).trim(), video: str(r.video).trim(), note: str(r.note),
    };
  }

  /** Round mà team OFF-TYPE clear được (checkbox trong team). */
  const OFF_ROUNDS = ['R4', 'R5', 'R6'];

  function normOffTeam(t = {}) {
    return {
      id: str(t.id) || uid('o'), name: str(t.name), note: str(t.note),
      category: t.category === 'PHYSICAL' || t.category === 'SPECIAL' ? t.category : '',
      rounds: OFF_ROUNDS.filter((r) => Array.isArray(t.rounds) && t.rounds.includes(r)),
      created: Number(t.created) || Date.now(),
      slots: [0, 1, 2].map((k) => normSlot((t.slots || [])[k])),
      links: (Array.isArray(t.links) ? t.links : []).map(normLink),
      records: (Array.isArray(t.records) ? t.records : []).map(normRecord),
    };
  }

  /** Validates and fills defaults; throws on unusable input. */
  function normalize(d) {
    if (!d || !Array.isArray(d.members) || !Array.isArray(d.groups)) {
      throw new Error('File không đúng định dạng (thiếu "members" hoặc "groups").');
    }
    const out = {
      app: 'gvg-team-planner',
      version: 1,
      updated: str(d.updated),
      members: d.members.map((m) => ({ id: str(m.id) || uid('m'), name: str(m.name), tag: str(m.tag) })),
      groups: d.groups.map((g) => ({
        id: str(g.id) || uid('g'),
        type: str(g.type),
        pairs: (g.pairs || []).map((p) => {
          const levels = {};
          for (const [k, v] of Object.entries(p.levels || {})) levels[k] = cleanLevel(v);
          const pair = { id: str(p.id) || uid('p'), name: str(p.name), note: str(p.note), levels };
          if (typeof p.icon === 'string') pair.icon = p.icon;
          return pair;
        }),
      })),
    };
    out.pairTags = normPairTags(d.pairTags);
    migrateNoteTags(out);
    if (Array.isArray(d.bosses)) out.bosses = d.bosses.map(normBoss);
    out.offTeams = Array.isArray(d.offTeams) ? d.offTeams.map(normOffTeam) : [];
    return out;
  }

  const tagKey = (s) => fold(s).replace(/[^a-z]/g, '');
  const tagByName = (name) => PAIR_TAGS.find((t) => tagKey(t.name) === tagKey(name));

  /** { catalogId: ['Rebuff', …] } – chỉ giữ tag hợp lệ, theo thứ tự PAIR_TAGS. */
  function normPairTags(v) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    for (const [id, list] of Object.entries(v)) {
      const names = Array.isArray(list) ? list.map(tagByName) : [];
      const tags = PAIR_TAGS.filter((t) => names.includes(t)).map((t) => t.name);
      if (tags.length) out[str(id)] = tags;
    }
    return out;
  }

  /** Ghi chú cũ chỉ gồm tên tag (vd "Damage field") -> chuyển thành tag của sync pair đó. */
  function migrateNoteTags(st) {
    for (const g of st.groups) {
      for (const p of g.pairs) {
        const parts = p.note.split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
        if (!parts.length || !parts.every(tagByName)) continue;
        const e = iconFor(p);
        if (!e) continue;
        const have = st.pairTags[e.id] || [];
        st.pairTags[e.id] = PAIR_TAGS
          .filter((t) => have.includes(t.name) || parts.some((x) => tagByName(x) === t)).map((t) => t.name);
        p.note = '';
      }
    }
  }

  function emptyState() {
    return { app: 'gvg-team-planner', version: 1, updated: '', members: [], groups: [], pairTags: {}, bosses: [], offTeams: [] };
  }

  function seedState() {
    try {
      const s = normalize(clone(window.GVG_SEED));
      s.bosses = s.bosses || [];
      return s;
    } catch (_) {
      return emptyState();
    }
  }

  /*
   * Dữ liệu chuẩn (seed.js) có seedVersion. SEED_KEY ghi dữ liệu trong trình duyệt dựa trên bản chuẩn nào và
   * đã sửa chưa: chưa sửa thì tự nạp bản chuẩn mới; đã sửa (hoặc không rõ) thì chỉ báo để người dùng tự chọn.
   */
  const SEED_KEY = 'gvg-team-planner/seed';
  const SEED_VERSION = str(window.GVG_SEED && window.GVG_SEED.seedVersion);
  let seedInfo = null;
  try { seedInfo = JSON.parse(localStorage.getItem(SEED_KEY)); } catch (_) { /* không có */ }
  let seedStatus = ''; // 'auto' = vừa tự nạp bản chuẩn mới, 'notice' = có bản chuẩn mới nhưng dữ liệu đã sửa

  function writeSeedInfo(edited) {
    seedInfo = { v: SEED_VERSION, edited };
    try { localStorage.setItem(SEED_KEY, JSON.stringify(seedInfo)); } catch (_) { /* bỏ qua */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = normalize(JSON.parse(raw));
        s.bosses = s.bosses || [];
        if (!SEED_VERSION || (seedInfo && seedInfo.v === SEED_VERSION)) return s;
        if (!seedInfo || seedInfo.edited) {
          seedStatus = 'notice';
          return s;
        }
        seedStatus = 'auto';
      }
    } catch (_) { /* fall through to seed */ }
    writeSeedInfo(false);
    return seedState();
  }

  let state = load();
  let idx;

  function reindex() {
    idx = { pair: new Map(), member: new Map() };
    for (const g of state.groups) for (const p of g.pairs) idx.pair.set(p.id, p);
    for (const m of state.members) idx.member.set(m.id, m);
  }
  reindex();

  /** `pristine` = vừa nạp dữ liệu chuẩn, chưa phải thay đổi của người dùng. */
  function save(pristine) {
    if (!pristine && seedInfo && !seedInfo.edited) writeSeedInfo(true);
    clearTimeout(save.timer);
    save.timer = setTimeout(() => {
      const status = $('#saveStatus');
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        status.textContent = 'Đã lưu ' + new Date().toLocaleTimeString('vi-VN');
      } catch (_) {
        status.textContent = 'Không lưu được vào trình duyệt – hãy Export JSON';
      }
    }, 250);
  }

  /** Thay dữ liệu đang dùng bằng dữ liệu chuẩn (seed.js). */
  function useSeed() {
    state = seedState();
    reindex();
    writeSeedInfo(false);
    save(true);
    render();
    const n = $('#seedNotice');
    if (n) n.remove();
  }

  /** Báo có dữ liệu chuẩn mới khi dữ liệu trong trình duyệt đã được sửa – không tự ghi đè. */
  function showSeedNotice() {
    const seedUpdated = str(window.GVG_SEED && window.GVG_SEED.updated);
    const box = el('div', { id: 'seedNotice', class: 'seed-notice', role: 'status' },
      el('strong', null, 'Có dữ liệu chuẩn mới' + (seedUpdated ? ` (cập nhật ${seedUpdated})` : '')),
      el('span', null, 'Dữ liệu bạn đang xem là bản đã sửa trên trình duyệt này.'),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            if (!confirm('Thay dữ liệu trên trình duyệt này bằng dữ liệu chuẩn? Thay đổi chưa Export sẽ mất (nên Export trước).')) return;
            useSeed();
            toast('Đã nạp dữ liệu chuẩn', 'ok');
          },
        }, 'Nạp dữ liệu chuẩn'),
        el('button', { class: 'btn', onclick: () => { writeSeedInfo(true); box.remove(); } }, 'Giữ bản của tôi')));
    $('.side-foot').prepend(box);
  }

  function allSlots() {
    const out = [];
    for (const b of state.bosses) for (const bl of b.blocks) for (const t of bl.teams) for (const s of t.slots) out.push(s);
    for (const t of state.offTeams) for (const s of t.slots) out.push(s);
    return out;
  }

  /** Detach team slots from pairs that are about to disappear, keeping the name as "Chưa map". */
  function unlinkPairs(pairs) {
    const ids = new Map(pairs.map((p) => [p.id, p.name]));
    for (const s of allSlots()) {
      if (s.pair && ids.has(s.pair)) {
        s.pairName = ids.get(s.pair);
        s.pair = null;
      }
    }
  }

  /** After replacing the roster, re-attach slots by id first, then by pair name. */
  function relinkSlots(oldGroups) {
    const oldNames = new Map();
    for (const g of oldGroups) for (const p of g.pairs) oldNames.set(p.id, p.name);
    const byName = new Map();
    for (const g of state.groups) for (const p of g.pairs) if (!byName.has(p.name)) byName.set(p.name, p.id);
    let lost = 0;
    for (const s of allSlots()) {
      if (s.pair && idx.pair.has(s.pair)) continue;
      const name = s.pair ? oldNames.get(s.pair) : s.pairName;
      if (!name) { s.pair = null; continue; }
      const id = byName.get(name);
      s.pair = id || null;
      s.pairName = id ? '' : name;
      if (!id) lost++;
    }
    return lost;
  }

  function levelOf(pairId, memberId) {
    const p = idx.pair.get(pairId);
    if (!p) return null;
    const v = p.levels[memberId];
    return typeof v === 'number' ? v : null;
  }

  function pairStats(pairId, req) {
    let owned = 0, reach = 0;
    for (const m of state.members) {
      const v = levelOf(pairId, m.id);
      if (v != null) {
        owned++;
        if (v >= (req || 1)) reach++;
      }
    }
    return { owned, reach };
  }

  /**
   * Team evaluation (mirrors the Excel sheet):
   * - owners: members who own every selected pair of the team
   * - qualified: owners whose level >= required on every selected pair
   */
  function evalTeam(team) {
    const active = team.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.pair && idx.pair.has(s.pair));
    const unmapped = team.slots.some((s) => !s.pair && s.pairName) || team.slots.some((s) => s.pair && !idx.pair.has(s.pair));
    if (!active.length || unmapped) return { active, unmapped, owners: [], qualified: [], partial: [] };
    const owners = [];
    for (const m of state.members) {
      const lv = team.slots.map((s) => (s.pair ? levelOf(s.pair, m.id) : null));
      if (active.every(({ i }) => lv[i] != null)) {
        const ok = active.every(({ s, i }) => lv[i] >= (s.req || 1));
        owners.push({ m, lv, ok });
      }
    }
    return {
      active, unmapped, owners,
      qualified: owners.filter((o) => o.ok),
      partial: owners.filter((o) => !o.ok),
    };
  }

  // ---------------------------------------------------------------- icons

  /** Icon entry of a pair: chosen manually (pair.icon), none (''), or auto-matched by name. */
  function iconFor(pair) {
    if (!pair || !CATALOG.length) return null;
    if (pair.icon === '') return null;
    if (pair.icon && catById.has(pair.icon)) return catById.get(pair.icon);
    return autoIcon(pair.name);
  }

  function autoIcon(name) {
    if (!Match || !name) return null;
    if (!autoMatchCache.has(name)) autoMatchCache.set(name, Match.matchPair(name, CATALOG));
    return autoMatchCache.get(name);
  }

  function iconImg(path, cls) {
    return el('img', {
      class: cls, src: 'icons/' + path, alt: '', loading: 'lazy', draggable: 'false',
      onerror: (e) => {
        const img = e.target;
        if (img.dataset.fallback) { img.style.visibility = 'hidden'; return; }
        img.dataset.fallback = '1';
        img.src = ICON_REMOTE + path;
      },
    });
  }

  // Màu khung icon theo type (1 Normal … 18 Fairy), giống AvatarV2 của pomatools
  const TYPE_COLORS = ['#8a8584', '#e44c4f', '#3eacd8', '#c29e00', '#45924b', '#42b0b8', '#d46d32', '#834da1', '#9a5533',
    '#507af1', '#e36193', '#799438', '#8d7762', '#9c6897', '#0085a7', '#5b5a6b', '#69748b', '#eb85aa'];
  // Huy hiệu góc dưới trái theo exclusivity: 999 Master, 996 Master EX, 998 Arc Suit, 997 Academy
  const EXCL_ICONS = { 999: 'master', 996: 'masterex', 998: 'arcsuit', 997: 'academy' };
  // Căn chỉnh icon role trong tab (scale, x%, y%) theo pomatools
  const ROLE_ICON_FIT = [[1.1, 1.25, 2.5], [1.1, 1.25, 2.5], [1.1, 1.25, 4.5], [1.1, 1.25, -1.25], [1.2, 1.25, 5.5],
    [1.3, 2.5, -3.5], [1.15, 2.5, 1.25]];

  function avatarRoleTab(r, slotX) {
    const [s, x, y] = ROLE_ICON_FIT[r] || [1, 0, 0];
    const img = iconImg(`images/icon_role_${ROLE_ICONS[r]}.png`);
    img.style.transform = `translate(${x + slotX}%, ${y}%) scale(${s})`;
    return el('span', { class: 'av-role', style: `background:${ROLE_COLORS[r]}` }, img);
  }

  /**
   * Sync pair icon theo mẫu pomatools: chân dung trainer trong khung màu type, rarity (★/EX) góc trên trái,
   * tab role (+ EX role) ở cạnh dưới, pokémon trong vòng tròn góc dưới phải, huy hiệu Master / Arc Suit…
   * Icon nhỏ (< 40px) chỉ giữ khung + pokémon cho dễ nhìn.
   */
  function avatar(entry, size = 28) {
    const box = el('span', { class: 'avatar', style: `--size:${size}px`, title: entry ? Match.displayName(entry) : '' });
    if (!entry) {
      box.classList.add('empty');
      box.textContent = '?';
      return box;
    }
    box.style.setProperty('--tc', TYPE_COLORS[entry.type - 1] || TYPE_COLORS[0]);
    const full = size >= 40;
    if (!full) box.classList.add('mini');
    box.append(
      el('span', { class: 'av-frame' }, el('span', { class: 'av-surface' }, iconImg(`trainer/${entry.ta}_128.png`, 'tr')),
        el('i', { class: 'av-overlay' })),
      entry.tera && entry.type >= 1 && entry.type <= 18
        // Tera: pokémon cắt hình lục giác, đặt trên khung tera theo type
        ? el('span', { class: 'av-pk tera' }, iconImg(`images/terastal_base_${String(entry.type).padStart(2, '0')}.png`, 'av-tera'),
          el('span', { class: 'av-tera-clip' }, iconImg(`pokemon/${entry.pa}_128.png`, 'pk')))
        : el('span', { class: 'av-pk' }, el('span', { class: 'av-pk-in' }, el('i', { class: 'av-ball' }),
          iconImg(`pokemon/${entry.pa}_128.png`, 'pk'))),
    );
    if (!full) return box;
    if (hasRole(entry.role)) {
      const dual = hasRole(entry.xr);
      box.append(el('span', { class: 'av-roles' + (dual ? ' dual' : '') },
        avatarRoleTab(entry.role, dual ? 8 : 0), dual ? avatarRoleTab(entry.xr, -8) : null));
    }
    if (EXCL_ICONS[entry.ex]) box.append(iconImg(`images/icon_exclusivity_${EXCL_ICONS[entry.ex]}.png`, 'av-excl'));
    if (entry.rar >= 3 && entry.rar <= 5) box.append(iconImg(`images/rarity${entry.hx ? '_ex' : ''}_${entry.rar}.png`, 'av-rar'));
    return box;
  }

  function roleName(e) {
    return (Match && Match.ROLE_NAMES[e.role]) || '';
  }

  function typeName(e) {
    return (Match && Match.TYPE_NAMES[e.type]) || '';
  }

  // Role theo pomatools: Strike tách Physical (0) / Special (1); hai loại dùng chung icon "strike"
  const ROLE_LABELS = ['Strike Physical', 'Strike Special', 'Support', 'Tech', 'Sprint', 'Field', 'Multi'];
  const ROLE_ICONS = ['strike', 'strike', 'support', 'tech', 'sprint', 'field', 'multi'];
  // Màu nền ô role theo pomatools (icon là nét trắng, cần nền màu mới thấy rõ); riêng Tech đổi sang xanh lá cho khác Support
  const ROLE_COLORS = ['#e63945', '#e63945', '#2193b0', '#2f9e44', '#f37626', '#834d9b', '#e8f347'];
  const EXCLUSIVITY = {
    1: 'Regular', 2: 'Poké Fair', 3: 'Seasonal', 4: 'Special', 5: 'Variety', 6: 'Mix', 7: 'Poké Fair EX', 8: 'Gym',
    996: 'Master EX', 997: 'Academy', 998: 'Arc Suit', 999: 'Master',
  };

  const hasRole = (r) => Number.isInteger(r) && r >= 0 && r < ROLE_LABELS.length;

  /** Role badge: icon + name; `ex` = EX role. */
  function roleChip(r, ex) {
    if (!hasRole(r)) return null;
    const icon = iconImg(`images/icon_role_${ROLE_ICONS[r]}.png`, 'role-ic');
    icon.style.background = ROLE_COLORS[r];
    return el('span', { class: 'role-chip' + (ex ? ' ex' : ''), title: (ex ? 'EX role: ' : 'Role: ') + ROLE_LABELS[r] },
      icon, (ex ? 'EX ' : '') + ROLE_LABELS[r]);
  }

  // Role trong tên pair hiển thị: "(Role gốc/EX role)", Strike ghi rõ Physical / Special
  const ROLE_TAGS = ['Strike-Physical', 'Strike-Special', 'Support', 'Tech', 'Sprint', 'Field', 'Multi'];
  const ROLE_WORDS = new Set([...ROLE_TAGS, ...ROLE_LABELS, 'Strike'].map((r) => fold(r)));

  /** "Strike-Special/Support" from a catalog entry ('' when it has no role). */
  function roleTag(e) {
    return e ? [e.role, e.xr].filter(hasRole).map((r) => ROLE_TAGS[r]).join('/') : '';
  }

  /** Catalog entry name with both roles: "Juliana (Anniversary 2026) & Terapagos (Strike-Special/Support)". */
  function catalogLabel(e) {
    const tag = roleTag(e);
    return `${e.tr} & ${e.pk}` + (tag ? ` (${tag})` : '');
  }

  /**
   * Display name of a Rosters pair: the stored name with its role in brackets replaced by
   * "(role/EX role)" from the matched icon. The stored name is kept as-is (icon / import matching uses it).
   */
  function pairLabel(p) {
    const tag = roleTag(iconFor(p));
    return tag && p.name ? `${pairBaseName(p)} (${tag})` : str(p && p.name);
  }

  /** Name + "(role/EX role)" kept on one line when the name wraps. */
  function pairNameNodes(p) {
    const tag = roleTag(iconFor(p));
    return tag ? [pairBaseName(p) + ' ', el('span', { class: 'nowrap' }, `(${tag})`)] : [str(p.name)];
  }

  /** Stored pair name without its trailing role bracket: "Anni Juliana & Terapagos". */
  function pairBaseName(p) {
    return str(p && p.name).replace(/\s*\(([^()]*)\)\s*$/, (m, inner) =>
      inner.split('/').every((w) => ROLE_WORDS.has(fold(w))) ? '' : m);
  }

  const getTags = (id) => (id && state.pairTags[id]) || [];

  function setTags(id, list) {
    const tags = PAIR_TAGS.map((t) => t.name).filter((n) => list.includes(n));
    if (tags.length) state.pairTags[id] = tags;
    else delete state.pairTags[id];
  }

  function tagChip(name) {
    const t = tagByName(name);
    return el('span', { class: 'ptag', style: t ? `--tag:${t.color}` : null }, name);
  }

  /**
   * Tags of one sync pair (catalog entry): chips + a menu to add / remove tags.
   * Shared by the Rosters table and Kho icon, so both edit the same data.
   */
  function tagEditor(e, onChange) {
    const box = el('div', { class: 'tag-cell' });
    if (!e) {
      box.append(el('span', { class: 'muted', title: 'Pair chưa có icon – bấm icon của pair để chọn trước khi gắn tag' }, '–'));
      return box;
    }
    const btn = el('button', { type: 'button', class: 'tag-edit', title: 'Thêm / bỏ tag', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    const menu = el('div', { class: 'combo-pop tag-pop', role: 'menu', 'aria-label': 'Tag của ' + catalogLabel(e) });
    const float = floatPanel(btn, menu);
    const draw = () => {
      const tags = getTags(e.id);
      btn.replaceChildren(...tags.map(tagChip), el('span', { class: 'tag-add' }, ic('plus'), tags.length ? null : 'Tag'));
      menu.replaceChildren(...PAIR_TAGS.map((t) => {
        const on = tags.includes(t.name);
        return el('button', {
          type: 'button', class: 'tag-opt', role: 'menuitemcheckbox', 'aria-checked': String(on),
          onclick: () => toggle(t.name),
        }, el('span', { class: 'tag-check' }, on ? '✓' : ''), tagChip(t.name));
      }));
    };
    const toggle = (name) => {
      const cur = getTags(e.id);
      setTags(e.id, cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]);
      save();
      draw();
      if (onChange) onChange();
    };
    const outside = (ev) => { if (!btn.isConnected || (!menu.contains(ev.target) && !btn.contains(ev.target))) close(); };
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      close();
      btn.focus();
    };
    function open() {
      draw();
      float.open();
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }
    function close() {
      float.close();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey, true);
    }
    btn.addEventListener('click', () => (menu.isConnected ? close() : open()));
    draw();
    box.append(btn);
    return box;
  }

  function fmtDate(ms, withTime) {
    if (!ms) return '–';
    const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
    return new Date(ms).toLocaleString('vi-VN', o);
  }

  function searchCatalog(q, type) {
    const words = (Match ? Match.fold(q) : q.toLowerCase()).split(' ').filter(Boolean);
    return CATALOG.filter((e) => {
      if (type && typeName(e) !== type) return false;
      if (!words.length) return true;
      const hay = Match.fold(`${e.tr} ${e.pk} ${roleName(e)} ${typeName(e)} ${ROLE_LABELS[e.role] || ''} `
        + (hasRole(e.xr) ? `ex ${ROLE_LABELS[e.xr]} ` : '') + (EXCLUSIVITY[e.ex] || ''));
      return words.every((w) => hay.includes(w));
    });
  }

  /** Pairs in Rosters that currently use each catalog entry. */
  function rosterUsage() {
    const used = new Map();
    for (const g of state.groups) {
      for (const p of g.pairs) {
        const e = iconFor(p);
        if (!e) continue;
        if (!used.has(e.id)) used.set(e.id, []);
        used.get(e.id).push(p);
      }
    }
    return used;
  }

  function catalogCard(e, extra) {
    const weak = (Match && Match.TYPE_NAMES[e.wk]) || '';
    const upcoming = e.d > Date.now();
    return el('div', { class: 'cat-card' },
      avatar(e, 80),
      el('div', { class: 'cat-text' },
        el('div', { class: 'cat-name' }, e.tr),
        el('div', { class: 'cat-sub' }, e.pk, ' ·', typeDot(fold(typeName(e))), typeName(e)),
        weak ? el('div', { class: 'cat-sub', title: 'Weakness' }, 'Weak', typeDot(fold(weak)), weak) : null,
        el('div', { class: 'cat-roles' }, roleChip(e.role), roleChip(e.xr, true)),
        e.d ? el('div', { class: 'cat-date' + (upcoming ? ' upcoming' : ''), title: dateInfo(e) },
          (upcoming ? 'Sắp ra ' : 'Ra mắt ') + fmtDate(e.d) + (EXCLUSIVITY[e.ex] ? ' · ' + EXCLUSIVITY[e.ex] : '')) : null,
        extra,
      ),
    );
  }

  function dateInfo(e) {
    return [['Release', e.d], ['Grid', e.dg], ['EX', e.dx], ['EX Role', e.dxr]]
      .map(([k, v]) => `${k}: ${fmtDate(v, true)}`).join('\n');
  }

  /** Modal to choose the icon of a roster pair. */
  function openIconPicker(pair, onDone) {
    const dlg = $('#iconDialog');
    const auto = autoIcon(pair.name);
    const current = iconFor(pair);
    let q = '';
    const list = el('div', { class: 'cat-grid' });
    const choose = (val) => {
      if (val === undefined) delete pair.icon;
      else pair.icon = val;
      save();
      dlg.close();
      onDone();
    };
    const fill = () => {
      const hits = q ? searchCatalog(q) : (auto ? [auto] : []).concat(searchCatalog(Match ? Match.parseName(pair.name).pokemon : ''));
      const seen = new Set();
      list.replaceChildren(...hits.filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, 120).map((e) => {
        const card = catalogCard(e, e === auto ? el('span', { class: 'pill ok' }, 'khớp theo tên') : null);
        card.classList.add('pickable');
        if (current === e) card.classList.add('selected');
        card.addEventListener('click', () => choose(e === auto ? undefined : e.id));
        return card;
      }));
      if (!list.children.length) list.append(el('div', { class: 'empty' }, 'Không tìm thấy pair nào.'));
    };
    const search = el('input', {
      class: 'field', type: 'search', placeholder: 'Tìm theo trainer / pokémon / role / type…', style: 'flex:1',
      oninput: (e) => { q = e.target.value; fill(); },
    });
    dlg.replaceChildren(
      el('div', { class: 'dlg-head' },
        el('strong', null, 'Chọn icon cho: ', pairLabel(pair) || '(chưa đặt tên)'),
        el('button', { class: 'icon-btn plain', onclick: () => dlg.close(), title: 'Đóng', 'aria-label': 'Đóng' }, ic('x'))),
      el('div', { class: 'toolbar' }, search,
        el('button', { class: 'btn', onclick: () => choose(undefined) }, 'Tự động theo tên'),
        el('button', { class: 'btn', onclick: () => choose('') }, 'Không dùng icon')),
      list,
    );
    fill();
    dlg.showModal();
    search.focus();
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  }

  // Pair terastal (variationTypes có 7) – giống tools/fetch_pair_icons.py:is_tera
  const NO_TERA_FRAME = new Set(['10286400000', '10287400000']); // Florian & Ogerpon, Juliana & Terapagos
  function isTera(m) {
    if (NO_TERA_FRAME.has(String(m.id))) return false;
    return (m.variationTypes || []).some((v) => (typeof v === 'number' ? v : v && v.variationType) === 7);
  }

  /** One pair of sync_meta_list.json -> catalog entry (same as tools/fetch_pair_icons.py:catalog_entry). */
  function catalogEntry(key, m, names) {
    const tr = names['trainer_name_' + m.trainerName];
    const pk = names['pokemon_name_' + m.pokemonName];
    if (!tr || !pk || !m.actorId || !m.pokemonActorId) return null;
    return {
      id: String(m.id || key), tr, pk,
      role: m.role, xr: Number.isInteger(m.exRole) && m.exRole >= 0 ? m.exRole : null,
      ex: m.exclusivity, type: m.type, wk: m.weakness, rar: m.rarity, hx: m.hasEX ? 1 : 0, tera: isTera(m) ? 1 : 0,
      d: m._startDate || 0, dg: m._gridDate || 0, dx: m._exStartDate || 0, dxr: m._exRoleDate || 0,
      ta: m.actorId, pa: m.pokemonActorId,
    };
  }

  async function fetchRemoteCatalog() {
    const [meta, names] = await Promise.all([
      fetchJson(POMA_BASE + '/data/sync_meta_list.json'),
      fetchJson(POMA_BASE + '/locales/en.json'),
    ]);
    const out = [];
    for (const [key, v] of Object.entries(meta)) {
      const e = catalogEntry(key, (v && v.meta) || {}, names);
      if (e) out.push(e);
    }
    return out;
  }

  async function updateCatalog(btn) {
    const label = [...btn.childNodes];
    btn.disabled = true;
    btn.textContent = 'Đang cập nhật…';
    try {
      const items = await fetchRemoteCatalog();
      if (!items.length) throw new Error('dữ liệu trống');
      const before = new Set(CATALOG.map((e) => e.id));
      const newIds = items.filter((e) => !before.has(e.id)).map((e) => e.id);
      const keepNew = newIds.length ? newIds : catalogInfo.newIds.filter((id) => items.some((e) => e.id === id));
      catalogInfo = { fetchedAt: Date.now(), newIds: keepNew };
      try {
        localStorage.setItem(CATALOG_KEY, JSON.stringify({ ...catalogInfo, items }));
      } catch (_) {
        toast('Không lưu được kho icon vào trình duyệt – chỉ dùng được đến khi tải lại trang');
      }
      setCatalog(items);
      updateCatalogButton();
      if (newIds.length) {
        libFilter = { ...LIB_FILTER, only: 'new' };
        toast(`Đã cập nhật: thêm ${newIds.length} pair mới (tổng ${items.length})`, 'ok');
        if (location.hash === '#icons') render();
        else location.hash = 'icons';
      } else {
        toast(`Kho icon đã mới nhất (${items.length} pair)`);
        render();
      }
    } catch (err) {
      toast('Cập nhật thất bại: ' + err.message + ' – kiểm tra kết nối mạng', 'error');
    } finally {
      btn.disabled = false;
      btn.replaceChildren(...label);
    }
  }

  function updateCatalogButton() {
    const btn = $('#btnIcons');
    if (!btn) return;
    btn.title = 'Tải danh sách pair mới nhất từ pomatools.site'
      + (catalogInfo.fetchedAt ? `\nLần cập nhật gần nhất: ${new Date(catalogInfo.fetchedAt).toLocaleString('vi-VN')}` : '')
      + `\nHiện có ${CATALOG.length} pair`;
  }

  // ---------------------------------------------------------------- routing

  function currentRoute() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('boss/')) {
      const b = state.bosses.find((x) => x.id === h.slice(5));
      if (b) return { view: 'boss', boss: b };
    }
    if (h.startsWith('season/')) {
      const [, id, sub, arg] = h.split('/');
      const season = SEASONS.find((x) => x.id === id);
      if (season) return { view: 'season', season, sub, arg };
    }
    if (h === 'summary') return { view: 'summary' };
    if (h === 'offtype') return { view: 'offtype' };
    if (h === 'icons') return { view: 'icons' };
    return { view: 'rosters' };
  }

  function render() {
    reindex();
    vizTip.remove();
    const r = currentRoute();
    renderTabs(r);
    const view = $('#view');
    if (r.view === 'boss') {
      view.replaceChildren(renderBoss(r.boss));
      syncBossNav();
    } else if (r.view === 'season') view.replaceChildren(renderSeason(r));
    else if (r.view === 'summary') view.replaceChildren(renderSummary());
    else if (r.view === 'offtype') view.replaceChildren(renderOffType());
    else if (r.view === 'icons') view.replaceChildren(renderIconLibrary());
    else {
      view.replaceChildren(renderRosters());
      fixStickyHeader();
    }
  }

  /** Teams of one block that have pairs selected: how many have someone qualified vs nobody. */
  function blockHealth(bl) {
    let zero = 0, ok = 0;
    for (const t of bl.teams) {
      const r = evalTeam(t);
      if (!r.active.length && !r.unmapped) continue;
      if (r.qualified.length) ok++;
      else zero++;
    }
    return { zero, ok, total: zero + ok };
  }

  /** Teams that have pairs selected but nobody qualifies. */
  function bossHealth(b) {
    let zero = 0, ok = 0;
    for (const bl of b.blocks) {
      const h = blockHealth(bl);
      zero += h.zero;
      ok += h.ok;
    }
    return { zero, ok, total: zero + ok };
  }

  function closeNav() {
    document.body.classList.remove('nav-open');
  }

  function addBoss() {
    const b = newBoss('Boss mới');
    state.bosses.push(b);
    save();
    location.hash = 'boss/' + b.id;
  }

  function renderTabs(r) {
    const item = (href, lead, label, active, extra) =>
      el('a', { class: 'nav-item' + (active ? ' active' : ''), href, onclick: closeNav, 'aria-current': active ? 'page' : null },
        lead, el('span', { class: 'label' }, label), extra);
    const nPairs = state.groups.reduce((n, g) => n + g.pairs.length, 0);
    const bosses = state.bosses.map((b) => {
      const { zero } = bossHealth(b);
      return item('#boss/' + b.id, typeDot(bossType(b), b.weakness), b.name || '(chưa đặt tên)',
        r.view === 'boss' && r.boss === b,
        zero ? el('span', { class: 'nav-alert', title: `${zero} team chưa có member đạt chuẩn` }, zero) : null);
    });
    $('#tabs').replaceChildren(
      item('#rosters', ic('grid'), 'Rosters', r.view === 'rosters', el('span', { class: 'nav-count' }, nPairs)),
      item('#summary', ic('chart'), 'Tổng quan', r.view === 'summary'),
      item('#offtype', ic('layers'), 'OFF-TYPE builder', r.view === 'offtype',
        el('span', { class: 'nav-count' }, state.offTeams.length)),
      ...(CATALOG.length
        ? [item('#icons', ic('image'), 'Kho icon', r.view === 'icons', el('span', { class: 'nav-count' }, CATALOG.length))]
        : []),
      ...(SEASONS.length ? [el('div', { class: 'nav-section' }, 'Mùa giải'),
        ...SEASONS.map((x) => item(`#season/${x.id}`, ic('trophy'), x.name, r.view === 'season' && r.season === x))] : []),
      el('div', { class: 'nav-section' }, `Boss · ${state.bosses.length}`,
        el('button', { class: 'icon-btn plain', title: 'Thêm boss / sheet team mới', 'aria-label': 'Thêm boss', onclick: addBoss }, ic('plus'))),
      ...bosses,
    );
  }

  // ---------------------------------------------------------------- theme

  const THEME_KEY = 'gvg-team-planner/theme';

  function getTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch (_) {
      return 'system';
    }
  }

  function setTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
    else delete root.dataset.theme;
    try { localStorage.setItem(THEME_KEY, mode); } catch (_) { /* chỉ áp dụng phiên này */ }
    for (const b of document.querySelectorAll('[data-theme-mode]')) {
      b.setAttribute('aria-checked', String(b.dataset.themeMode === mode));
    }
  }

  // ---------------------------------------------------------------- per-viewer UI state

  const UI_KEY = 'gvg-team-planner/ui';
  const ui = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      return {
        collapsed: new Set(Array.isArray(v.collapsed) ? v.collapsed : []),
        offOpen: new Set(Array.isArray(v.offOpen) ? v.offOpen : []),
        colW: v.colW && typeof v.colW === 'object' ? v.colW : {},
        teamOpen: v.teamOpen && typeof v.teamOpen === 'object' ? v.teamOpen : {},
      };
    } catch (_) {
      return { collapsed: new Set(), offOpen: new Set(), colW: {}, teamOpen: {} };
    }
  })();

  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        collapsed: [...ui.collapsed], offOpen: [...ui.offOpen], colW: ui.colW, teamOpen: ui.teamOpen,
      }));
    } catch (_) { /* bỏ qua */ }
  }

  // ---------------------------------------------------------------- Rosters view

  let rosterFilter = { q: '', group: '' };

  function renderRosters() {
    const nPairs = state.groups.reduce((n, g) => n + g.pairs.length, 0);
    const head = el('div', { class: 'page-head' },
      el('h1', null, 'Rosters'),
      el('span', { class: 'page-sub' }, `${state.members.length} member · ${nPairs} pair · cập nhật `,
        bound(state, 'updated', { class: 'edit', style: 'width:64px;display:inline-block', placeholder: 'dd/mm', title: 'Ngày cập nhật' })),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', title: 'Nạp file roster của từng member (chọn được nhiều file)', onclick: () => $('#fileInput').click() }, ic('upload'), 'Import member'),
      el('button', { class: 'btn', title: 'Tải roster của từng member ra file riêng', onclick: openMemberExport }, ic('download'), 'Export member'),
      el('button', { class: 'btn', onclick: addMember }, ic('plus'), 'Member'),
      el('button', { class: 'btn', onclick: addGroup }, ic('plus'), 'Type'),
      el('button', {
        class: 'btn btn-ghost btn-danger', title: 'Bỏ mọi thay đổi, nạp lại dữ liệu chuẩn',
        onclick: () => {
          if (!confirm('Khôi phục dữ liệu chuẩn? Mọi thay đổi chưa Export sẽ mất.')) return;
          useSeed();
          toast('Đã khôi phục dữ liệu chuẩn', 'ok');
        },
      }, 'Reset'),
    );

    const groupSel = el('select', {
      class: 'field',
      onchange: (e) => { rosterFilter.group = e.target.value; applyRosterFilter(); },
    },
      el('option', { value: '' }, 'Tất cả type'),
      state.groups.map((g) => el('option', { value: g.id, selected: rosterFilter.group === g.id }, g.type || '(chưa đặt tên)')),
    );
    const allCollapsed = state.groups.length > 0 && state.groups.every((g) => ui.collapsed.has(g.id));
    const toolbar = el('div', { class: 'toolbar' },
      searchBox({
        placeholder: 'Tìm pair hoặc type…', value: rosterFilter.q, style: 'width:250px',
        oninput: (e) => { rosterFilter.q = e.target.value; applyRosterFilter(); },
      }),
      groupSel,
      el('button', {
        class: 'btn btn-ghost',
        onclick: () => {
          if (allCollapsed) ui.collapsed.clear();
          else for (const g of state.groups) ui.collapsed.add(g.id);
          saveUi();
          render();
        },
      }, allCollapsed ? 'Mở tất cả' : 'Thu gọn tất cả'),
      el('span', { class: 'legend', title: 'Màu theo move level' }, 'Level',
        el('span', { class: 'l1' }, '1'), el('span', { class: 'l3' }, '3'), el('span', { class: 'l5' }, '5'),
        el('span', { class: 'l7' }, '7'), el('span', { class: 'l10' }, '10')),
    );

    const wrap = el('div', { class: 'grid-wrap', id: 'rosterWrap', onscroll: queueTypeNavSync }, buildRosterTable());
    setTimeout(applyRosterFilter);
    return el('div', null, head, toolbar,
      el('p', { class: 'hint' }, 'Gõ move level 1–10 (để trống, 0, - hoặc k = "Không có"). Dùng phím mũi tên / Enter để đi giữa các ô; bấm icon để đổi ảnh pair. "+ Pair" mở danh sách pair cùng hệ để chọn (gõ để tìm).'),
      renderTypeNav(), wrap);
  }

  // ---------------------------------------------------------------- Rosters: điều hướng theo hệ

  function renderTypeNav() {
    return el('nav', { class: 'type-nav', id: 'typeNav', 'aria-label': 'Nhảy tới hệ' },
      el('div', { class: 'jump-strip' }, state.groups.map((g) => el('button', {
        class: 'jump-link', dataset: { target: g.id }, title: `${g.type || '(chưa đặt tên)'} · ${g.pairs.length} pair`,
        onclick: () => jumpToGroup(g),
      }, typeDot(fold(g.type).split(' ')[0]), el('span', null, g.type || '(chưa đặt tên)')))),
    );
  }

  function refreshTypeNav() {
    const nav = $('#typeNav');
    if (!nav) return;
    nav.replaceWith(renderTypeNav());
    syncTypeNav();
    fitRosterGrid();
  }

  /** Scrolls the roster grid so the type's header row sits right under the sticky table header. */
  function jumpToGroup(g) {
    const wrap = $('#rosterWrap');
    if (!wrap) return;
    let row = wrap.querySelector(`tr.group-row[data-group="${CSS.escape(g.id)}"]`);
    if (!row) return;
    let changed = false;
    if (row.classList.contains('hidden')) {
      // Nhóm đang bị bộ lọc ẩn: bỏ lọc để thấy được nhóm
      rosterFilter = { q: '', group: '' };
      const box = $('#view [data-search]');
      if (box) box.value = '';
      const sel = $('#view .toolbar select');
      if (sel) sel.value = '';
      changed = true;
    }
    if (ui.collapsed.has(g.id)) {
      ui.collapsed.delete(g.id);
      saveUi();
      changed = true;
    }
    if (changed) applyRosterFilter();
    row = wrap.querySelector(`tr.group-row[data-group="${CSS.escape(g.id)}"]`);
    const headH = wrap.querySelector('thead').offsetHeight;
    const top = wrap.scrollTop + row.getBoundingClientRect().top - wrap.getBoundingClientRect().top - headH;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    wrap.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    // Nếu khung bảng nằm khuất dưới trang thì kéo trang xuống cho thấy
    const r = wrap.getBoundingClientRect();
    if (r.bottom > window.innerHeight) window.scrollBy({ top: r.bottom - window.innerHeight + 16, behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Highlights the type whose rows are at the top of the grid; dims types hidden by the filter. */
  function syncTypeNav() {
    const nav = $('#typeNav');
    const wrap = $('#rosterWrap');
    if (!nav || !wrap) return;
    const rows = [...wrap.querySelectorAll('tr.group-row')];
    const line = wrap.getBoundingClientRect().top + wrap.querySelector('thead').offsetHeight + 4;
    let current = '';
    for (const tr of rows) {
      if (tr.classList.contains('hidden')) continue;
      if (!current || tr.getBoundingClientRect().top <= line) current = tr.dataset.group;
    }
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2) {
      const last = rows.filter((tr) => !tr.classList.contains('hidden')).pop();
      if (last && wrap.scrollTop > 0) current = last.dataset.group;
    }
    const hidden = new Set(rows.filter((tr) => tr.classList.contains('hidden')).map((tr) => tr.dataset.group));
    for (const a of nav.querySelectorAll('[data-target]')) a.classList.toggle('off', hidden.has(a.dataset.target));
    markJumpLink(nav.querySelector('.jump-strip'), current);
  }

  let typeNavFrame = 0;
  function queueTypeNavSync() {
    if (typeNavFrame) return;
    typeNavFrame = requestAnimationFrame(() => { typeNavFrame = 0; syncTypeNav(); });
  }

  function buildRosterTable() {
    const members = state.members;
    const head1 = el('tr', null,
      el('th', { class: 'sticky-col pair-col' }, el('span', { class: 'th-label' }, 'Pair: Trainer & Pokémon (Role/EX role)')),
      el('th', { class: 'tag-col', title: 'Tag của sync pair – bấm vào ô để thêm / bỏ (dùng chung với Kho icon)' },
        el('span', { class: 'th-label' }, 'Tags')),
      el('th', { class: 'num-col', title: 'Số member sở hữu pair' }, el('span', { class: 'th-label', style: 'text-align:center;padding:8px 2px' }, 'Sở hữu')),
      members.map((m) => el('th', { class: 'member-head' },
        bound(m, 'name', { title: m.name, placeholder: 'Tên' }),
        bound(m, 'tag', { class: 'edit tag', placeholder: 'tag', title: 'Tag (vd: OFF-TYPE, STALL…)' }),
        el('div', { class: 'member-actions' },
          el('button', { class: 'icon-btn plain', title: `Export roster của ${m.name}`, 'aria-label': `Export roster của ${m.name}`, onclick: () => exportMember(m) }, ic('download')),
          el('button', { class: 'icon-btn', title: `Xóa member ${m.name}`, 'aria-label': `Xóa member ${m.name}`, onclick: () => deleteMember(m) }, ic('x'))),
      )),
    );
    const head2 = el('tr', { class: 'count-row' },
      el('th', { class: 'sticky-col pair-col' }, el('span', { class: 'th-label', style: 'padding:5px 10px' }, 'Số pair đang có')),
      el('th', { class: 'tag-col' }),
      el('th', { class: 'num-col', id: 'cnt-total' }),
      members.map((m) => el('th', { class: 'num-col', id: 'cnt-m-' + m.id })),
    );

    const colCount = 3 + members.length;
    const body = el('tbody');
    for (const g of state.groups) {
      body.append(el('tr', { class: 'group-row', dataset: { group: g.id } },
        el('td', { colspan: colCount },
          el('div', { class: 'group-cell' },
            el('button', {
              class: 'icon-btn plain group-toggle', title: 'Thu gọn / mở nhóm', 'aria-label': 'Thu gọn hoặc mở nhóm',
              onclick: () => toggleGroup(g),
            }, ic('chevron')),
            typeDot(fold(g.type).split(' ')[0]),
            bound(g, 'type', { placeholder: 'Tên type' }, refreshTypeNav),
            el('span', { class: 'group-count' }, `${g.pairs.length} pair`),
            el('button', { class: 'btn btn-sm', onclick: () => addPair(g) }, ic('plus'), 'Pair'),
            el('button', { class: 'icon-btn', title: `Xóa type ${g.type} và toàn bộ pair`, 'aria-label': `Xóa type ${g.type}`, onclick: () => deleteGroup(g) }, ic('x')),
          ),
        ),
      ));
      for (const p of g.pairs) body.append(buildPairRow(g, p));
    }

    const table = el('table', { class: 'roster' }, el('thead', null, head1, head2), body);
    table.addEventListener('keydown', onGridKey);
    table.addEventListener('focusin', (e) => {
      if (e.target.classList && e.target.classList.contains('lv')) crosshair(e.target);
    });
    table.addEventListener('focusout', () => crosshair(null));
    setTimeout(updateRosterCounts);
    return table;
  }

  let crossCells = [];

  /** Highlight the row and column of the focused level cell. */
  function crosshair(input) {
    for (const c of crossCells) c.classList.remove('row-on', 'col-on');
    crossCells = [];
    if (!input) return;
    const td = input.parentElement;
    const tr = td.parentElement;
    const ci = Array.prototype.indexOf.call(tr.children, td);
    const table = tr.closest('table');
    tr.classList.add('row-on');
    crossCells.push(tr);
    for (const row of table.querySelectorAll('thead tr, tbody tr:not(.group-row):not(.pair-new):not(.hidden)')) {
      const cell = row.children[ci];
      if (cell && cell !== td) { cell.classList.add('col-on'); crossCells.push(cell); }
    }
  }

  function toggleGroup(g) {
    if (ui.collapsed.has(g.id)) ui.collapsed.delete(g.id);
    else ui.collapsed.add(g.id);
    saveUi();
    applyRosterFilter();
  }

  /** Clickable pair icon that opens the icon picker. */
  function pairIconButton(p, size, onChange) {
    if (!CATALOG.length) return null;
    const btn = el('button', {
      class: 'avatar-btn', title: 'Đổi icon',
      onclick: () => openIconPicker(p, () => { refresh(); onChange && onChange(); }),
    });
    const refresh = () => {
      const e = iconFor(p);
      const a = avatar(e, size);
      if (p.icon) a.classList.add('manual');
      btn.replaceChildren(a);
      btn.title = (e ? Match.displayName(e) : 'Chưa có icon') + ' – bấm để đổi';
    };
    refresh();
    btn.refresh = refresh;
    return btn;
  }

  /** Catalog type name of a roster group ("Fire" -> "Fire"); '' when the group isn't a known type. */
  function groupCatalogType(g) {
    const key = fold(g.type).split(' ')[0];
    return TYPE_KEYS.has(key) ? key[0].toUpperCase() + key.slice(1) : '';
  }

  /**
   * Floats `panel` under `anchor` (above it when there's no room below). position: fixed, so scrolling
   * containers like the roster grid don't clip it; it follows the anchor on scroll / resize.
   */
  function floatPanel(anchor, panel) {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const up = below < 240 && r.top > below;
      panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
      panel.style.top = up ? '' : r.bottom + 2 + 'px';
      panel.style.bottom = up ? window.innerHeight - r.top + 2 + 'px' : '';
      panel.style.maxHeight = Math.min(360, up ? r.top - 8 : below) + 'px';
    };
    let closing = false;
    return {
      open() {
        if (panel.isConnected) return;
        // Trong popup (dialog modal) phải gắn vào dialog, nếu không sẽ nằm dưới lớp modal và không bấm được
        (anchor.closest('dialog[open]') || document.body).append(panel);
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
      },
      close() {
        // remove() làm ô đang focus trong panel blur -> close() bị gọi lồng, bỏ qua lần đó
        if (closing || !panel.isConnected) return;
        closing = true;
        panel.remove();
        closing = false;
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      },
    };
  }

  /**
   * Searchable select of the catalog pairs of a group's type, floating over the page.
   * onCancel runs on Esc, or when focus leaves without a choice.
   */
  function pairCombo(g, onPick, onCancel) {
    const type = groupCatalogType(g);
    const used = rosterUsage();
    let hits = [];
    let active = -1;
    let picked = false;
    const list = el('ul', { class: 'combo-pop combo-list', role: 'listbox', id: uid('cl'), onmousedown: (e) => e.preventDefault() });
    const input = el('input', {
      class: 'edit combo-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: type ? `Chọn pair hệ ${type}… (gõ để tìm)` : 'Chọn pair… (gõ để tìm)',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': list.id,
      oninput: () => { active = -1; fill(); },
      onfocus: open,
      onblur: () => { close(); if (!picked && onCancel) onCancel(); },
      onkeydown: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!list.isConnected) open();
          move(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const e2 = hits[active] || hits.find((x) => !used.has(x.id));
          if (e2 && !used.has(e2.id)) pick(e2);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          input.blur();
        }
      },
    });

    function fill() {
      hits = searchCatalog(input.value, type);
      const shown = hits.slice(0, 150);
      list.replaceChildren(...shown.map((e, i) => {
        const taken = used.has(e.id);
        const sub = [e.rar ? '★'.repeat(e.rar) + (e.hx ? ' EX' : '') : '', hasRole(e.xr) ? 'EX role ' + ROLE_LABELS[e.xr] : '',
          !type ? typeName(e) : ''].filter(Boolean).join(' · ');
        return el('li', {
          class: 'combo-item' + (taken ? ' taken' : '') + (i === active ? ' active' : ''),
          role: 'option', id: list.id + '-' + i, 'aria-selected': i === active ? 'true' : 'false', 'aria-disabled': taken ? 'true' : null,
          title: taken ? 'Đã có trong Rosters' : '',
          onclick: () => { if (!taken) pick(e); },
          onmousemove: () => { if (active !== i && !taken) setActive(i); },
        }, avatar(e, 26),
        el('span', { class: 'combo-text' }, el('span', { class: 'combo-name' }, catalogLabel(e)), sub ? el('span', { class: 'combo-sub' }, sub) : null),
        taken ? el('span', { class: 'pill neutral' }, 'Đã có') : null);
      }));
      if (hits.length > shown.length) list.append(el('li', { class: 'combo-empty' }, `Còn ${hits.length - shown.length} pair – gõ thêm để lọc.`));
      if (!hits.length) list.append(el('li', { class: 'combo-empty' }, 'Không tìm thấy pair nào.'));
    }

    function setActive(i) {
      active = i;
      list.querySelectorAll('.combo-item').forEach((li, k) => {
        li.classList.toggle('active', k === i);
        li.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      const li = list.children[i];
      if (li) { li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id); }
    }

    function move(step) {
      const n = Math.min(hits.length, 150);
      for (let k = 1; k <= n; k++) {
        const i = (active + step * k + n * 2) % n;
        if (!used.has(hits[i].id)) { setActive(i); return; }
      }
    }

    const float = floatPanel(input, list);

    function open() {
      if (list.isConnected) return;
      fill();
      float.open();
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      float.close();
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function pick(e) {
      picked = true;
      close();
      onPick(e);
    }

    return input;
  }

  function buildPairRow(g, p) {
    const tagCell = () => [tagEditor(iconFor(p)),
      p.note ? el('div', { class: 'tag-note', title: 'Ghi chú cũ: ' + p.note }, p.note) : null];
    const tags = el('td', { class: 'tag-col' }, tagCell());
    // Đổi icon thì role trong tên hiển thị và tag (theo sync pair) đổi theo
    const icon = pairIconButton(p, 26, () => {
      tags.replaceChildren(...tagCell().filter(Boolean));
      if (!name.classList.contains('pair-name')) return;
      name.replaceChildren(...pairNameNodes(p));
      name.title = pairLabel(p);
    });
    // Tên pair không sửa tay: chỉ chọn từ danh sách theo hệ (dòng cũ chưa có tên thì hiện ô chọn)
    const name = p.name
      ? el('span', { class: 'pair-name', title: pairLabel(p) }, pairNameNodes(p))
      : pairCombo(g, (e) => {
        p.name = Match.displayName(e);
        p.icon = e.id;
        save();
        render();
      });
    return el('tr', { dataset: { group: g.id, pair: p.id } },
      el('td', { class: 'sticky-col pair-col' },
        el('div', { class: 'pair-cell' },
          el('button', { class: 'icon-btn row-del', title: 'Xóa dòng', 'aria-label': 'Xóa dòng', onclick: () => deletePair(g, p) }, ic('x')),
          icon,
          name,
        ),
      ),
      tags,
      el('td', { class: 'num-col', dataset: { owners: p.id } }),
      state.members.map((m) => {
        const v = p.levels[m.id];
        const td = el('td', { class: v ? 'l' + v : '' });
        td.append(el('input', {
          class: 'lv', value: v ?? '', placeholder: '·', inputmode: 'numeric', maxlength: 2,
          title: `${m.name} – ${pairLabel(p)}`,
          'aria-label': `${m.name} – ${pairLabel(p)}`,
          dataset: { pair: p.id, member: m.id },
          onfocus: (e) => e.target.select(),
          onchange: (e) => commitLevel(e.target, p, m),
        }));
        return td;
      }),
    );
  }

  function commitLevel(input, p, m) {
    const r = parseLevel(input.value);
    if (!r.ok) {
      input.classList.add('invalid');
      toast('Move level phải là 1–10 (hoặc để trống = Không có)', 'error');
      input.value = p.levels[m.id] ?? '';
      setTimeout(() => input.classList.remove('invalid'), 1200);
      return;
    }
    p.levels[m.id] = r.v;
    input.value = r.v ?? '';
    input.parentElement.className = r.v ? 'l' + r.v : '';
    save();
    updateRosterCounts();
  }

  function updateRosterCounts() {
    let total = 0;
    const perMember = new Map(state.members.map((m) => [m.id, 0]));
    for (const g of state.groups) {
      for (const p of g.pairs) {
        let owners = 0;
        for (const m of state.members) {
          if (typeof p.levels[m.id] === 'number') {
            owners++;
            perMember.set(m.id, perMember.get(m.id) + 1);
          }
        }
        total += owners;
        const cell = document.querySelector(`td[data-owners="${p.id}"]`);
        if (cell) cell.textContent = owners;
      }
    }
    for (const [id, n] of perMember) {
      const cell = document.getElementById('cnt-m-' + id);
      if (cell) cell.textContent = n;
    }
    const t = document.getElementById('cnt-total');
    if (t) t.textContent = total;
  }

  function applyRosterFilter() {
    const q = fold(rosterFilter.q.trim());
    const rows = document.querySelectorAll('table.roster tbody tr');
    const visibleByGroup = new Map();
    for (const tr of rows) {
      if (tr.classList.contains('group-row') || tr.classList.contains('pair-new')) continue;
      const gid = tr.dataset.group;
      const g = state.groups.find((x) => x.id === gid);
      const p = idx.pair.get(tr.dataset.pair);
      const match = (!rosterFilter.group || rosterFilter.group === gid)
        && (!q || fold(p ? `${pairLabel(p)} ${getTags((iconFor(p) || {}).id).join(' ')}` : '').includes(q)
          || fold(g ? g.type : '').includes(q));
      if (match) visibleByGroup.set(gid, true);
      // Đang tìm kiếm thì luôn mở nhóm để thấy kết quả
      tr.classList.toggle('hidden', !match || (!q && ui.collapsed.has(gid)));
    }
    for (const tr of rows) {
      if (!tr.classList.contains('group-row')) continue;
      const gid = tr.dataset.group;
      const show = visibleByGroup.has(gid) || (!q && (!rosterFilter.group || rosterFilter.group === gid));
      tr.classList.toggle('hidden', !show);
      tr.classList.toggle('collapsed', !q && ui.collapsed.has(gid));
    }
    syncTypeNav();
  }

  function fixStickyHeader() {
    const first = $('table.roster thead tr');
    if (first) $('table.roster').style.setProperty('--head1-h', first.offsetHeight + 'px');
    fitRosterGrid();
  }

  /** Lets the roster grid fill the rest of the screen below the toolbar / type nav. */
  function fitRosterGrid() {
    const wrap = $('#rosterWrap');
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const padBottom = parseFloat(getComputedStyle($('#view')).paddingBottom) || 0;
    wrap.style.maxHeight = Math.max(320, window.innerHeight - top - padBottom) + 'px';
  }

  function onGridKey(e) {
    const input = e.target;
    if (!input.classList || !input.classList.contains('lv')) return;
    const keys = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [e.shiftKey ? -1 : 1, 0] };
    const d = keys[e.key];
    if (!d) return;
    e.preventDefault();
    const td = input.parentElement;
    const tr = td.parentElement;
    const ci = Array.prototype.indexOf.call(tr.children, td);
    let target = null;
    if (d[1]) {
      target = tr.children[ci + d[1]];
    } else {
      let r = tr;
      do { r = d[0] > 0 ? r.nextElementSibling : r.previousElementSibling; }
      while (r && (r.classList.contains('group-row') || r.classList.contains('pair-new') || r.classList.contains('hidden')));
      target = r && r.children[ci];
    }
    const next = target && target.querySelector('input.lv');
    if (next) next.focus();
  }

  function addMember() {
    const m = { id: uid('m'), name: `Member ${state.members.length + 1}`, tag: '' };
    state.members.push(m);
    save();
    render();
    const inputs = document.querySelectorAll('.member-head input.edit:not(.tag)');
    const last = inputs[inputs.length - 1];
    if (last) { last.scrollIntoView({ inline: 'end', block: 'nearest' }); last.focus(); last.select(); }
  }

  function deleteMember(m) {
    if (!confirm(`Xóa member "${m.name}"? Toàn bộ move level của member này sẽ bị xóa.`)) return;
    state.members = state.members.filter((x) => x !== m);
    for (const g of state.groups) for (const p of g.pairs) delete p.levels[m.id];
    save();
    render();
  }

  function addGroup() {
    const g = { id: uid('g'), type: '', pairs: [] };
    state.groups.push(g);
    save();
    rosterFilter = { q: '', group: '' };
    render();
    const input = $(`tr.group-row[data-group="${g.id}"] input`);
    if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); }
  }

  function deleteGroup(g) {
    if (!confirm(`Xóa type "${g.type}" cùng ${g.pairs.length} pair bên trong?`)) return;
    unlinkPairs(g.pairs);
    state.groups = state.groups.filter((x) => x !== g);
    save();
    render();
  }

  /** Adds a temporary row with the pair select; the pair is only created once one is chosen. */
  function addPair(g) {
    for (const old of document.querySelectorAll('tr.pair-new')) old.remove();
    if (ui.collapsed.has(g.id)) {
      ui.collapsed.delete(g.id);
      saveUi();
      applyRosterFilter();
    }
    const rows = document.querySelectorAll(`table.roster tbody tr[data-group="${CSS.escape(g.id)}"]`);
    const after = rows[rows.length - 1];
    if (!after) return;
    const row = el('tr', { class: 'pair-new', dataset: { group: g.id } });
    const cancel = () => row.remove();
    const combo = pairCombo(g, (e) => {
      const p = { id: uid('p'), name: Match.displayName(e), note: '', levels: {}, icon: e.id };
      g.pairs.push(p);
      save();
      render();
      toast(`Đã thêm "${p.name}" vào nhóm ${g.type}`, 'ok');
      const input = $(`tr[data-pair="${p.id}"] input.lv`);
      if (input) { input.scrollIntoView({ block: 'nearest' }); input.focus(); }
    }, cancel);
    row.append(
      el('td', { class: 'sticky-col pair-col' },
        el('div', { class: 'pair-cell' },
          el('button', { class: 'icon-btn plain', title: 'Hủy', 'aria-label': 'Hủy thêm pair', onmousedown: (e) => e.preventDefault(), onclick: cancel }, ic('x')),
          avatar(null, 26),
          combo)),
      el('td', { colspan: 2 + state.members.length }),
    );
    after.after(row);
    row.scrollIntoView({ block: 'nearest' });
    combo.focus();
  }

  function deletePair(g, p) {
    const used = allSlots().filter((s) => s.pair === p.id).length;
    const msg = `Xóa pair "${p.name || '(trống)'}"?` + (used ? `\nPair đang được dùng trong ${used} slot team – các slot đó sẽ chuyển sang "Chưa map".` : '');
    if (!confirm(msg)) return;
    unlinkPairs([p]);
    g.pairs = g.pairs.filter((x) => x !== p);
    save();
    render();
  }

  // ---------------------------------------------------------------- Boss view

  function renderBoss(boss) {
    const health = bossHealth(boss);
    const type = bossType(boss);
    const head = el('div', { class: 'page-head' },
      el('div', { class: 'boss-title' },
        bound(boss, 'name', { title: 'Tên tab boss' }, () => renderTabs(currentRoute()))),
      boss.weakness ? el('span', { class: 'type-chip', title: 'Weakness' }, typeDot(type), 'Weak: ' + boss.weakness) : null,
      el('span', { class: 'spacer' }),
      health.total
        ? el('span', { class: 'stat-chip', title: 'Số team có ít nhất 1 member đạt chuẩn' },
          el('strong', null, `${health.ok}/${health.total}`), 'team có member đạt')
        : null,
      el('button', {
        class: 'btn btn-ghost btn-danger',
        onclick: () => {
          if (!confirm(`Xóa boss "${boss.name}" cùng toàn bộ team?`)) return;
          state.bosses = state.bosses.filter((b) => b !== boss);
          save();
          location.hash = 'rosters';
        },
      }, 'Xóa boss'),
    );

    const info = el('div', { class: 'card boss-info', dataset: { nav: 'info' } },
      el('label', null, 'Boss', bound(boss, 'boss')),
      el('label', null, 'Weakness', bound(boss, 'weakness', {}, () => renderTabs(currentRoute()))),
      [0, 1, 2].map((i) => el('label', null, `Passive ${i + 1}`, bound(boss.passives, i))),
      el('label', { class: 'wide' }, 'Ghi chú trận / điểm then chốt', bound(boss, 'note', { placeholder: 'Chiến thuật, lưu ý…' })),
    );

    // Mỗi category (PHYSICAL / SPECIAL) chia 2 cột: Cheer bên trái, Carry bên phải
    const cats = [...new Set(boss.blocks.map((b) => b.category))];
    const kindRank = (bl) => ({ cheer: 0, carry: 1 })[blockKind(bl)] ?? 2;
    const sections = cats.map((cat) => el('section', { class: 'category' },
      el('h2', null, cat),
      el('div', { class: 'block-cols' }, boss.blocks.filter((b) => b.category === cat)
        .sort((a, b) => kindRank(a) - kindRank(b))
        .map((block) => renderBlock(boss, block))),
    ));

    return el('div', null,
      el('div', { class: 'boss-sticky', id: 'bossSticky' }, head, renderBossNav(boss)),
      info,
      el('p', { class: 'hint' },
        'Bấm đầu thẻ phương án để mở / thu gọn. Chọn pair từ Rosters và move level required cho từng slot. ' +
        'Bảng kết quả tự lấy member có đủ pair và level ≥ required (xanh = đạt, đỏ = thiếu level).'),
      sections);
  }

  /** Sticky bar of the boss page: jump to each block, step to the previous/next boss. */
  function renderBossNav(boss) {
    const i = state.bosses.indexOf(boss);
    const step = (b, dir) => b
      ? el('a', {
        class: 'btn btn-ghost btn-sm boss-nav-step', href: '#boss/' + b.id,
        title: `${dir < 0 ? 'Boss trước' : 'Boss sau'}: ${b.name || '(chưa đặt tên)'} (phím ${dir < 0 ? '[' : ']'})`,
        'aria-label': dir < 0 ? 'Boss trước' : 'Boss sau',
      }, ic('chevron'))
      : el('span', { class: 'btn btn-ghost btn-sm boss-nav-step', 'aria-disabled': 'true' }, ic('chevron'));

    const link = (target, label, badge) => el('button', {
      class: 'jump-link', dataset: { target }, onclick: () => scrollToSection(target),
    }, label, badge);

    const links = [link('info', 'Thông tin')];
    let lastCat = null;
    for (const bl of boss.blocks) {
      if (lastCat !== null && bl.category !== lastCat) links.push(el('span', { class: 'boss-nav-sep', 'aria-hidden': 'true' }));
      lastCat = bl.category;
      const h = blockHealth(bl);
      const badge = h.total
        ? el('span', {
          class: 'pill ' + (h.zero ? 'bad' : 'ok'),
          title: `${h.ok}/${h.total} team có member đạt` + (h.zero ? ` · ${h.zero} team chưa có ai đạt` : ''),
        }, `${h.ok}/${h.total}`)
        : null;
      const kind = blockKind(bl);
      links.push(link(bl.id, [kind ? el('span', { class: 'kind-dot kind-' + kind, 'aria-hidden': 'true' }) : null, bl.title], badge));
    }

    return el('nav', { class: 'boss-nav', id: 'bossNav', 'aria-label': 'Điều hướng trong trang boss' },
      step(state.bosses[i - 1], -1),
      el('div', { class: 'jump-strip' }, links),
      el('span', { class: 'boss-nav-pos', title: 'Vị trí boss trong danh sách' }, `${i + 1}/${state.bosses.length}`),
      step(state.bosses[i + 1], 1),
    );
  }

  /** Re-draws the nav badges after a team changes, keeping the highlighted link. */
  function refreshBossNav(boss) {
    const nav = $('#bossNav');
    if (!nav) return;
    nav.replaceWith(renderBossNav(boss));
    syncBossNav();
  }

  function stickyTop() {
    const bar = $('.mobile-bar');
    return bar ? bar.offsetHeight : 0;
  }

  function scrollToSection(target) {
    const sec = document.querySelector(`#view [data-nav="${CSS.escape(target)}"]`);
    const nav = $('#bossNav');
    if (!sec || !nav) return;
    const top = target === 'info' ? 0 : sec.getBoundingClientRect().top + window.scrollY - stickyTop() - $('#bossSticky').offsetHeight - 12;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Highlights the link of the section currently under the sticky bar. */
  function syncBossNav() {
    const nav = $('#bossNav');
    if (!nav) return;
    document.documentElement.style.setProperty('--bar-h', stickyTop() + 'px');
    const secs = [...document.querySelectorAll('#view [data-nav]')];
    const line = stickyTop() + $('#bossSticky').offsetHeight + 40;
    let current = 'info';
    for (const s of secs) if (s.getBoundingClientRect().top <= line) current = s.dataset.nav;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom && secs.length) current = secs[secs.length - 1].dataset.nav;
    markJumpLink(nav.querySelector('.jump-strip'), current);
  }

  /** Highlights the link whose data-target is `current` inside a .jump-strip. */
  function markJumpLink(strip, current) {
    for (const a of strip.querySelectorAll('[data-target]')) {
      const on = a.dataset.target === current;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
      // Dải nút tràn ngang: cuộn để link đang chọn luôn hiện (không dùng scrollIntoView vì nó cắt ngang smooth scroll)
      if (on && strip.scrollWidth > strip.clientWidth
        && (a.offsetLeft < strip.scrollLeft || a.offsetLeft + a.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
        strip.scrollLeft = a.offsetLeft - (strip.clientWidth - a.offsetWidth) / 2;
      }
    }
  }

  /** 'cheer' | 'carry' | '' – để tô màu block theo loại. */
  function blockKind(block) {
    const f = fold(`${block.id} ${block.title}`);
    return f.includes('cheer') ? 'cheer' : f.includes('carry') ? 'carry' : '';
  }

  function renderBlock(boss, block) {
    const teams = el('div', { class: 'teams' }, block.teams.map((t) => renderTeam(boss, block, t)));
    const kind = blockKind(block);
    return el('div', { class: 'block' + (kind ? ' kind-' + kind : ''), dataset: { nav: block.id } },
      el('div', { class: 'block-head' },
        el('h3', null, block.title),
        el('span', { class: 'muted', style: 'font-size:12px' }, `${block.teams.length} phương án`),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => {
            const letter = String.fromCharCode(65 + block.teams.length);
            const t = newTeam('Team ' + letter);
            block.teams.push(t);
            ui.teamOpen[t.id] = true;
            saveUi();
            save();
            render();
          },
        }, ic('plus'), 'Phương án'),
      ),
      teams,
    );
  }

  /** Tên trong nút chọn pair, tối đa 2 dòng: "Trainer &" / "Pokémon…" (dài thì "…"). */
  function pairPickName(label) {
    const amp = label.indexOf('&');
    if (amp < 0) return el('span', { class: 'pair-pick-name' }, el('span', { class: 'pick-line' }, el('span', { class: 'pick-cut' }, label)));
    return el('span', { class: 'pair-pick-name' },
      el('span', { class: 'pick-line' }, el('span', { class: 'pick-cut' }, label.slice(0, amp).trim()), el('span', { class: 'pick-amp' }, '&')),
      el('span', { class: 'pick-line' }, el('span', { class: 'pick-cut' }, label.slice(amp + 1).trim())));
  }

  /**
   * Pair choice of a team slot: a button showing the full pair name (wraps instead of being cut off)
   * that opens a searchable list of the Rosters pairs, grouped by type. onChange(pairId | '').
   * `taken`: pair ids used by the other slots of the team – shown but not selectable.
   */
  function slotPairPicker(slot, onChange, taken = new Set()) {
    const current = slot.pair && idx.pair.get(slot.pair);
    const label = current ? (roleTag(iconFor(current)) ? pairBaseName(current) : current.name) || '(trống)'
      : slot.pairName ? '⚠ ' + slot.pairName
        : slot.pair ? '⚠ Pair đã bị xóa' : '— Chọn pair —';
    let hits = [];
    let opts = [];
    let active = -1;
    const list = el('ul', { class: 'combo-list', role: 'listbox', id: uid('cl') });
    const search = el('input', {
      class: 'field', type: 'search', placeholder: 'Tìm pair hoặc type…', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': list.id,
      oninput: () => { active = -1; fill(); },
      onblur: close,
      onkeydown: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const h = hits[active] || hits.find((x) => x.p && !x.taken);
          if (h) choose(h.id);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
          btn.focus();
        }
      },
    });
    const panel = el('div', {
      class: 'combo-pop combo-panel',
      onmousedown: (e) => { if (e.target !== search) e.preventDefault(); },
    }, search, list);
    const btn = el('button', {
      type: 'button', class: 'pair-pick' + (current ? '' : ' empty'), title: label,
      'aria-haspopup': 'listbox', 'aria-expanded': 'false',
      onmousedown: (e) => { if (panel.isConnected) e.preventDefault(); },
      onclick: () => (panel.isConnected ? close() : open()),
    }, pairPickName(label), ic('chevron'));
    const float = floatPanel(btn, panel);

    function fill() {
      const words = Match.fold(search.value).split(' ').filter(Boolean);
      hits = [];
      opts = [];
      const rows = [];
      const option = (h, ...content) => {
        const i = hits.length;
        h.taken = taken.has(h.id);
        const li = el('li', {
          class: 'combo-item' + (h.id === (slot.pair || null) ? ' selected' : '') + (h.taken ? ' taken' : ''),
          role: 'option', id: `${list.id}-${i}`, 'aria-selected': 'false', 'aria-disabled': h.taken ? 'true' : null,
          title: h.taken ? 'Đã chọn ở slot khác của team này' : null,
          onclick: () => { if (!h.taken) choose(h.id); },
          onmousemove: () => { if (active !== i && !h.taken) setActive(i); },
        }, ...content, h.taken ? el('span', { class: 'pill neutral' }, 'Đã chọn') : null);
        hits.push(h);
        opts.push(li);
        rows.push(li);
      };
      if (slot.pair && !words.length) option({ id: '' }, el('span', { class: 'combo-text combo-sub' }, '— Bỏ chọn pair —'));
      for (const g of state.groups) {
        const ps = g.pairs.filter((p) => words.every((w) => Match.fold(`${pairLabel(p)} ${g.type}`).includes(w)));
        if (!ps.length) continue;
        rows.push(el('li', { class: 'combo-group', role: 'presentation' }, typeDot(fold(g.type).split(' ')[0]), g.type || '(chưa đặt tên)'));
        for (const p of ps) {
          option({ id: p.id, p }, CATALOG.length ? avatar(iconFor(p), 26) : null,
            el('span', { class: 'combo-text' }, el('span', { class: 'combo-name' }, pairLabel(p) || '(trống)')));
        }
      }
      list.replaceChildren(...rows);
      if (!hits.length) list.append(el('li', { class: 'combo-empty' }, 'Không tìm thấy pair nào.'));
    }

    function setActive(i) {
      active = i;
      opts.forEach((li, k) => {
        li.classList.toggle('active', k === i);
        li.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      if (opts[i]) { opts[i].scrollIntoView({ block: 'nearest' }); search.setAttribute('aria-activedescendant', opts[i].id); }
    }

    function move(step) {
      const n = hits.length;
      const from = active < 0 && step < 0 ? 0 : active;
      for (let k = 1; k <= n; k++) {
        const i = (from + step * k + n * 2) % n;
        if (!hits[i].taken) { setActive(i); return; }
      }
    }

    function open() {
      search.value = '';
      active = -1;
      fill();
      float.open();
      btn.setAttribute('aria-expanded', 'true');
      search.focus();
      const cur = hits.findIndex((h) => h.p && h.id === slot.pair);
      if (cur >= 0) setActive(cur);
    }

    function close() {
      float.close();
      btn.setAttribute('aria-expanded', 'false');
    }

    function choose(id) {
      close();
      btn.focus();
      onChange(id);
    }

    return btn;
  }

  /** Role gốc / EX role của pair: icon màu + "Strike-Physical/Support". */
  function roleLine(p) {
    const e = iconFor(p);
    const tag = roleTag(e);
    if (!tag) return roleOf(p.name) ? el('div', { class: 'role-line' }, roleOf(p.name)) : null;
    const mini = (r, ex) => {
      if (!hasRole(r)) return null;
      const img = iconImg(`images/icon_role_${ROLE_ICONS[r]}.png`, 'role-ic' + (ex ? ' ex' : ''));
      img.style.background = ROLE_COLORS[r];
      return img;
    };
    return el('div', { class: 'role-line', title: `Role: ${ROLE_LABELS[e.role] || '?'}` + (hasRole(e.xr) ? ` · EX role: ${ROLE_LABELS[e.xr]}` : '') },
      mini(e.role), mini(e.xr, true),
      // Mỗi role không bị ngắt giữa chữ, chỉ xuống dòng sau dấu "/"
      el('span', null, tag.split('/').flatMap((r, k) => [k ? '/' : null, k ? el('wbr') : null, el('span', { class: 'nowrap' }, r)])));
  }

  /** Tag của sync pair (chỉ xem; thêm / bỏ ở Rosters hoặc Kho icon). */
  function slotTags(p) {
    const tags = getTags((iconFor(p) || {}).id);
    return tags.length ? el('div', { class: 'slot-tags', title: 'Tag của sync pair – sửa ở Rosters hoặc Kho icon' }, tags.map(tagChip)) : null;
  }

  /** Thẻ phương án đang mở? Người dùng đã bấm thì theo đó, chưa thì chỉ mở thẻ đầu tiên của block. */
  function teamIsOpen(block, team) {
    const v = ui.teamOpen[team.id];
    return typeof v === 'boolean' ? v : block.teams[0] === team;
  }

  /** Icon các pair đã chọn + move level "x-y-z" – hiện ở đầu thẻ khi thu gọn. */
  function teamMinis(team) {
    const ps = team.slots.map((s) => s.pair && idx.pair.get(s.pair)).filter(Boolean);
    if (!ps.length) return el('span', { class: 'team-minis muted small' }, 'chưa chọn pair');
    return el('span', { class: 'team-minis', title: ps.map(pairLabel).join('\n') },
      CATALOG.length ? ps.map((p) => avatar(iconFor(p), 28)) : ps.map(shortPair).join(' · '),
      el('span', { class: 'off-req', title: 'Move level required' }, offReqText(team)));
  }

  /** Thẻ phương án: đầu thẻ (tên, số đạt, pair, ghi chú) luôn hiện; bấm để mở slot + bảng member. */
  function renderTeam(boss, block, team) {
    const open = teamIsOpen(block, team);
    const card = el('div', { class: 'card team' + (open ? ' open' : ' collapsed') });
    const rerender = (focusKey) => {
      const a = document.activeElement;
      const fk = focusKey || (a && card.contains(a) && a.dataset ? a.dataset.fk : null);
      const fresh = renderTeam(boss, block, team);
      card.replaceWith(fresh);
      if (fk) { const f = fresh.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (f) f.focus(); }
      save();
      renderTabs(currentRoute());
      refreshBossNav(boss);
    };
    const toggle = () => {
      ui.teamOpen[team.id] = !open;
      saveUi();
      rerender('toggle');
    };
    const result = evalTeam(team);
    const links = team.links.filter((l) => safeHref(l.url));

    const head = el('div', {
      class: 'team-head',
      onclick: (e) => { if (!e.target.closest('a, button, input, select, textarea')) toggle(); },
    },
      el('button', {
        type: 'button', class: 'team-toggle', 'aria-expanded': String(open), dataset: { fk: 'toggle' },
        title: open ? 'Thu gọn' : 'Mở chi tiết', 'aria-label': `${open ? 'Thu gọn' : 'Mở'} ${team.label || 'phương án'}`, onclick: toggle,
      }, ic('chevron')),
      bound(team, 'label', { class: 'edit label' }),
      teamPill(result),
      open ? null : teamMinis(team),
      // Thu gọn: luôn hiện Grid / Video thay cho ghi chú; loại nào chưa có link thì là nút "+" mở thẻ để thêm
      open
        ? bound(team, 'note', { class: 'edit note', placeholder: 'Ghi chú team…' })
        : el('div', { class: 'off-links team-links', title: team.note ? 'Ghi chú: ' + team.note : null },
          ['grid', 'video'].map((kind) => {
            const have = links.filter((l) => l.kind === kind);
            if (have.length) return have.map(linkChip);
            return el('button', {
              type: 'button', class: 'off-link empty' + (kind === 'video' ? ' video' : ''),
              title: kind === 'video' ? 'Thêm link video' : 'Thêm link grid',
              onclick: () => {
                team.links.push(normLink({ kind }));
                ui.teamOpen[team.id] = true;
                saveUi();
                rerender(`link${team.links.length - 1}`);
              },
            }, ic('plus'), kind === 'video' ? 'Video' : 'Grid');
          })),
      el('button', {
        class: 'icon-btn', title: 'Xóa phương án này', 'aria-label': 'Xóa phương án này',
        onclick: () => {
          if (!confirm(`Xóa ${team.label || 'phương án'} của ${block.title}?`)) return;
          block.teams = block.teams.filter((t) => t !== team);
          delete ui.teamOpen[team.id];
          saveUi();
          save();
          render();
        },
      }, ic('x')),
    );

    card.append(head);
    if (open) {
      card.append(el('div', { class: 'slots' }, team.slots.map((s, i) => renderSlot(team, s, i, rerender))),
        offLinkEditor(team, rerender),
        renderResult(team, result));
    }
    return card;
  }

  /** "n đạt" / "chưa map" / "trống" của một team. */
  function teamPill(result) {
    return result.unmapped
      ? el('span', { class: 'pill bad' }, 'chưa map')
      : result.active.length
        ? el('span', { class: 'pill ' + (result.qualified.length ? 'ok' : 'bad') }, `${result.qualified.length} đạt`)
        : el('span', { class: 'pill neutral' }, 'trống');
  }

  /**
   * Nút kéo của slot: kéo thả lên slot khác trong cùng team để đổi chỗ 2 slot (chuột hoặc cảm ứng);
   * khi nút đang focus, phím ← / → cũng đổi chỗ với slot bên cạnh.
   */
  function slotGrip(team, i, rerender) {
    const swap = (to) => {
      if (to < 0 || to >= team.slots.length || to === i) return;
      [team.slots[i], team.slots[to]] = [team.slots[to], team.slots[i]];
      rerender(`grip${to}`);
    };
    const btn = el('button', {
      type: 'button', class: 'slot-grip', dataset: { fk: `grip${i}` },
      title: 'Kéo thả lên slot khác để đổi vị trí (hoặc phím ← →)', 'aria-label': `Đổi vị trí slot ${i + 1}`,
      onkeydown: (e) => {
        const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
        if (!step) return;
        e.preventDefault();
        swap(i + step);
      },
      onpointerdown: (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const box = btn.closest('.slots');
        const src = btn.closest('.slot');
        if (!box || !src) return;
        let target = -1;
        btn.setPointerCapture(e.pointerId);
        src.classList.add('dragging');
        document.body.classList.add('slot-dragging');
        const onMove = (ev) => {
          // Slot đang kéo đi theo con trỏ; pointer-events: none nên elementFromPoint thấy slot nằm dưới
          src.style.transform = `translate(${ev.clientX - e.clientX}px, ${ev.clientY - e.clientY}px)`;
          const hit = document.elementFromPoint(ev.clientX, ev.clientY);
          const over = hit && hit.closest('.slot');
          target = over && over.parentElement === box && over !== src ? [...box.children].indexOf(over) : -1;
          for (const c of box.children) c.classList.toggle('drop-target', target >= 0 && c === over);
        };
        const end = (ev) => {
          btn.removeEventListener('pointermove', onMove);
          btn.removeEventListener('pointerup', end);
          btn.removeEventListener('pointercancel', end);
          src.classList.remove('dragging');
          src.style.transform = '';
          document.body.classList.remove('slot-dragging');
          for (const c of box.children) c.classList.remove('drop-target');
          if (ev.type === 'pointerup' && target >= 0) swap(target);
          else btn.focus();
        };
        btn.addEventListener('pointermove', onMove);
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointercancel', end);
      },
    }, ic('grip'));
    return btn;
  }

  /**
   * Một slot của team (boss hoặc OFF-TYPE): icon, số member sở hữu / đạt, chọn pair, role, tag, Required.
   * sortable: thêm nút kéo để đổi vị trí slot (rerender nhận data-fk cần focus lại).
   */
  function renderSlot(team, s, i, rerender, sortable) {
    const p = s.pair ? idx.pair.get(s.pair) : null;
    const unmapped = (!s.pair && s.pairName) || (s.pair && !p);
    const st = p ? pairStats(p.id, s.req) : null;
    const reqSel = el('select', {
      dataset: { fk: `req${i}` },
      onchange: (e) => { s.req = e.target.value ? Number(e.target.value) : null; rerender(); },
    },
      el('option', { value: '' }, '–'),
      LEVELS.map((n) => el('option', { value: n, selected: s.req === n }, n)),
    );
    // Một pair chỉ được dùng một lần trong team
    const taken = new Set(team.slots.filter((x) => x !== s && x.pair).map((x) => x.pair));
    const ps = slotPairPicker(s, (v) => {
      s.pair = v || null;
      s.pairName = '';
      rerender();
    }, taken);
    ps.dataset.fk = `pair${i}`;
    const dup = p && taken.has(p.id);
    // Hàng trên: icon + số member sở hữu / đạt; dưới: ô chọn pair rộng hết slot, role ngay dưới tên
    const stat = (n, label, cls, title) => el('div', { class: 'slot-stat ' + cls, title }, el('b', null, n), label);
    return el('div', { class: 'slot' + (unmapped || dup ? ' unmapped' : '') },
      el('div', { class: 'slot-top' },
        CATALOG.length ? avatar(p ? iconFor(p) : null, 44) : null,
        st
          ? el('div', { class: 'slot-stats' },
            stat(st.owned, 'sở hữu', '', 'Số member có pair này'),
            stat(st.reach, 'đạt', st.reach ? 'ok' : 'bad', s.req ? `Số member có move level ≥ ${s.req}` : 'Số member có pair này (chưa đặt Required)'))
          : el('span', { class: 'slot-empty' }, unmapped ? '' : `Slot ${i + 1}`),
        sortable ? slotGrip(team, i, rerender) : null),
      ps,
      p ? roleLine(p) : null,
      p ? slotTags(p) : null,
      el('div', { class: 'row' }, 'Required', reqSel),
      boundArea(s, 'note', { placeholder: 'Ghi chú pair…', style: 'font-size:12px', 'aria-label': 'Ghi chú pair' }),
      unmapped ? el('div', { class: 'warn' }, 'Chưa map – chọn lại pair từ Rosters') : null,
      dup ? el('div', { class: 'warn' }, 'Trùng pair với slot khác trong team – chọn pair khác') : null,
    );
  }

  function renderResult(team, r) {
    if (r.unmapped) return el('div', { class: 'empty' }, 'Có pair chưa map nên chưa tính được.');
    if (!r.active.length) return el('div', { class: 'empty' }, 'Chọn ít nhất 1 pair để xem member phù hợp.');

    const cols = r.active.map(({ s, i }) => ({ s, i, label: s.short || `Pair ${i + 1}` }));
    const table = (rows, showState) => el('table', { class: 'result' },
      el('thead', null, el('tr', null,
        el('th', null, 'Member'),
        cols.map((c) => {
          const p = idx.pair.get(c.s.pair);
          return el('th', { class: 'n', title: `${c.label} – ${pairLabel(p)}` },
            CATALOG.length ? avatar(iconFor(p), 24) : c.label,
            el('div', { class: 'req' }, c.s.req ? `≥${c.s.req}` : ''));
        }),
      )),
      el('tbody', null, rows.map((o) => el('tr', { class: o.ok ? 'qualified' : '' },
        el('td', null, o.m.name, o.m.tag ? el('span', { class: 'chip', style: 'margin-left:6px' }, o.m.tag) : null),
        cols.map((c) => {
          const v = o.lv[c.i];
          const ok = v >= (c.s.req || 1);
          return el('td', { class: 'n ' + (showState ? (ok ? 'ok' : 'bad') : '') }, v);
        }),
      ))),
    );

    return el('div', null,
      el('div', { class: 'result-title' },
        'Member đạt chuẩn',
        el('span', { class: 'muted', style: 'font-weight:400;font-size:12px;margin-left:auto' },
          `${r.owners.length} member có đủ ${cols.length} pair`),
      ),
      r.qualified.length ? table(r.qualified, true) : el('div', { class: 'empty' }, '(chưa có member)'),
      r.partial.length ? el('details', { class: 'others' },
        el('summary', null, `Có đủ pair nhưng chưa đạt level (${r.partial.length})`),
        table(r.partial, true),
      ) : null,
    );
  }

  // ---------------------------------------------------------------- Summary view

  function renderSummary() {
    const qualifiedBy = new Map(state.members.map((m) => [m.id, []]));
    const blockIds = [];
    for (const b of state.bosses) for (const bl of b.blocks) if (!blockIds.find((x) => x.id === bl.id)) blockIds.push(bl);

    const matrixRows = state.bosses.map((b) => {
      const cells = blockIds.map((def) => {
        const bl = b.blocks.find((x) => x.id === def.id);
        if (!bl) return el('td');
        return el('td', null, bl.teams.map((t) => {
          const r = evalTeam(t);
          for (const o of r.qualified) qualifiedBy.get(o.m.id).push({ b, bl, t });
          if (!r.active.length) return el('span', { class: 'chip' }, `${t.label}: –`);
          if (r.unmapped) return el('span', { class: 'chip zero' }, `${t.label}: chưa map`);
          return el('span', { class: 'chip ' + (r.qualified.length ? 'ok' : 'zero'), title: r.qualified.map((o) => o.m.name).join(', ') },
            `${t.label}: ${r.qualified.length}`);
        }));
      });
      return el('tr', null, el('td', null, el('a', { class: 'boss-link', href: '#boss/' + b.id }, typeDot(bossType(b)), b.name)), cells);
    });

    const matrix = el('div', { class: 'card' },
      el('h2', { class: 'section-title' }, 'Số member đạt chuẩn theo team'),
      el('div', { class: 'scroll' }, el('table', { class: 'matrix' },
        el('thead', null, el('tr', null, el('th', null, 'Boss'), blockIds.map((d) => el('th', null, d.title)))),
        el('tbody', null, matrixRows),
      )),
    );

    // Team OFF-TYPE: member đạt chuẩn của từng team (Physical -> Special -> Chưa rõ)
    const offBy = new Map(state.members.map((m) => [m.id, []]));
    const offRank = (t) => ({ PHYSICAL: 0, SPECIAL: 1 })[offCategory(t)] ?? 2;
    const offTeams = [...state.offTeams].sort((a, b) => offRank(a) - offRank(b) || offName(a).localeCompare(offName(b)));
    const offChip = (t, cls = '') => {
      const c = offCatInfo(offCategory(t));
      return el('button', { type: 'button', class: 'chip off-chip ' + cls, title: `Mở team OFF-TYPE · ${catLabel(offCategory(t))}`, onclick: () => gotoOffTeam(t) },
        el('i', { class: 'off-dot', style: c ? `background:${c.color}` : null }), offName(t));
    };
    const offRows = offTeams.map((t) => {
      const r = evalTeam(t);
      for (const o of r.qualified) offBy.get(o.m.id).push(t);
      return el('tr', null,
        el('td', null, offChip(t)),
        el('td', null, catChip(offCategory(t), !t.category)),
        el('td', null, el('div', { class: 'off-minis' }, offPairs(t).map((p) => el('span', { class: 'off-mini', title: pairLabel(p) },
          CATALOG.length ? avatar(iconFor(p), 26) : null, el('span', { class: 'off-mini-name' }, shortPair(p)))))),
        el('td', { class: 'num off-req' }, offReqText(t)),
        el('td', { class: 'num' }, teamPill(r)),
        el('td', null, r.qualified.length
          ? r.qualified.map((o) => el('span', { class: 'chip ok' }, o.m.name))
          : el('span', { class: 'muted small' }, r.partial.length ? `${r.partial.length} member có đủ pair nhưng thiếu level` : '–')));
    });
    const offCard = el('div', { class: 'card' },
      el('h2', { class: 'section-title' }, 'Số member đạt chuẩn – team OFF-TYPE',
        el('a', { class: 'section-link', href: '#offtype' }, 'Mở OFF-TYPE builder')),
      offRows.length
        ? el('div', { class: 'scroll' }, el('table', { class: 'matrix off-table' },
          el('thead', null, el('tr', null,
            el('th', null, 'Team'), el('th', null, 'Loại'), el('th', null, 'Pair'),
            el('th', { class: 'num' }, 'Move level'), el('th', { class: 'num' }, 'Số đạt'), el('th', null, 'Member đạt chuẩn'))),
          el('tbody', null, offRows)))
        : el('div', { class: 'empty off-empty' }, 'Chưa có team OFF-TYPE nào.'));

    const pairCount = (m) => state.groups.reduce((n, g) => n + g.pairs.filter((p) => typeof p.levels[m.id] === 'number').length, 0);
    const members = el('div', { class: 'card' },
      el('h2', { class: 'section-title' }, 'Member có thể vào team nào'),
      el('div', { class: 'scroll' }, el('table', { class: 'matrix' },
        el('thead', null, el('tr', null,
          el('th', null, 'Member'), el('th', null, 'Tag'), el('th', null, 'Số pair'),
          el('th', null, 'Số team đạt'), el('th', null, 'Team đạt chuẩn'),
          state.offTeams.length ? el('th', null, 'Team OFF-TYPE đạt chuẩn') : null)),
        el('tbody', null, state.members.map((m) => {
          const list = qualifiedBy.get(m.id);
          const offList = offBy.get(m.id);
          return el('tr', null,
            el('td', null, el('strong', null, m.name)),
            el('td', { class: 'muted' }, m.tag),
            el('td', null, pairCount(m)),
            el('td', null, el('span', { class: 'pill ' + (list.length ? 'ok' : 'neutral') }, list.length)),
            el('td', null, groupByBoss(list).map(([b, items]) => el('div', null,
              el('a', { class: 'boss-link', href: '#boss/' + b.id }, typeDot(bossType(b)), b.name), ' ',
              items.map(({ bl, t }) => el('span', { class: 'chip ok' }, `${bl.title} ${t.label.replace(/^Team\s*/i, '')}`)),
            ))),
            state.offTeams.length
              ? el('td', null, offList.length ? offList.map((t) => offChip(t, 'ok')) : el('span', { class: 'muted' }, '–'))
              : null,
          );
        })),
      )),
    );

    return el('div', null,
      el('div', { class: 'page-head' }, el('h1', null, 'Tổng quan')),
      el('div', { class: 'summary-grid' }, matrix, offCard, members));
  }

  /** Từ trang khác: mở tab OFF-TYPE, mở panel của team và cuộn tới. */
  function gotoOffTeam(t) {
    if (location.hash === '#offtype') { openOffTeam(t); return; }
    ui.offOpen.add(t.id);
    saveUi();
    offView.by = 'team';
    if (!offMatches(t)) offView = { ...offView, cat: '', q: '', pair: '' };
    // Trình xử lý hashchange của app vẽ trang và cuộn lên đầu trước, rồi mới cuộn tới team
    window.addEventListener('hashchange', () => setTimeout(() => {
      const node = document.getElementById('off-' + t.id);
      if (node) node.scrollIntoView({ block: 'start' });
    }), { once: true });
    location.hash = 'offtype';
  }

  function groupByBoss(list) {
    const m = new Map();
    for (const it of list) {
      if (!m.has(it.b)) m.set(it.b, []);
      m.get(it.b).push(it);
    }
    return [...m];
  }

  // ---------------------------------------------------------------- Cột bảng kéo đổi độ rộng

  // Độ rộng mặc định (đo từ bảng đầu tiên của mỗi key, giữ trong phiên) – độ rộng đã kéo lưu ở ui.colW[key][cột]
  const colDefaults = new Map();

  /**
   * Kéo mép phải tiêu đề cột để đổi độ rộng; bấm đúp để về mặc định; focus mép rồi ← / → cũng chỉnh được.
   * Mọi bảng cùng `key` dùng chung độ rộng (vd bảng record của các team). fixedCols: cột không cho kéo.
   */
  function resizableTable(table, key, fixedCols = []) {
    table.dataset.cols = key;
    table.classList.add('col-resizable');
    const ths = [...table.tHead.rows[0].cells];
    ths.forEach((th, i) => {
      if (fixedCols.includes(i)) return;
      const label = th.textContent || `cột ${i + 1}`;
      th.append(el('span', {
        class: 'col-grip', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical',
        'aria-label': `Độ rộng cột ${label}`, title: 'Kéo để đổi độ rộng cột · bấm đúp để về mặc định',
        onpointerdown: (e) => dragCol(e, table, key, i),
        ondblclick: () => resetCol(key, i),
        onkeydown: (e) => {
          const step = { ArrowLeft: -10, ArrowRight: 10 }[e.key];
          if (!step) return;
          e.preventDefault();
          measureCols(table, key);
          setColWidth(key, i, colWidths(key)[i] + step);
        },
      }));
    });
    if (colDefaults.has(key)) applyCols(table, key);
    else requestAnimationFrame(() => { if (measureCols(table, key)) applyColsAll(key); });
    return table;
  }

  /** Đo độ rộng tự nhiên (table-layout auto) của các cột làm mặc định cho key. */
  function measureCols(table, key) {
    if (colDefaults.has(key)) return true;
    if (!table.isConnected || !table.offsetWidth) return false;
    colDefaults.set(key, [...table.tHead.rows[0].cells].map((th) => th.offsetWidth));
    return true;
  }

  function colWidths(key) {
    const saved = ui.colW[key] || {};
    return (colDefaults.get(key) || []).map((w, i) => saved[i] ?? w);
  }

  function applyCols(table, key) {
    const ws = colWidths(key);
    if (!ws.length) return;
    const ths = table.tHead.rows[0].cells;
    ws.forEach((w, i) => { if (ths[i]) ths[i].style.width = w + 'px'; });
    table.style.width = ws.reduce((a, b) => a + b, 0) + 'px';
    table.classList.add('cols-fixed');
  }

  function applyColsAll(key) {
    for (const t of document.querySelectorAll(`table[data-cols="${CSS.escape(key)}"]`)) applyCols(t, key);
  }

  function setColWidth(key, i, w, persist = true) {
    ui.colW[key] = { ...(ui.colW[key] || {}), [i]: Math.max(40, Math.round(w)) };
    applyColsAll(key);
    if (persist) saveUi();
  }

  function resetCol(key, i) {
    if (ui.colW[key]) {
      delete ui.colW[key][i];
      saveUi();
    }
    applyColsAll(key);
  }

  function dragCol(e, table, key, i) {
    if (e.button !== 0 || !measureCols(table, key)) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const start = colWidths(key)[i];
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('col-resizing');
    const move = (ev) => setColWidth(key, i, start + ev.clientX - e.clientX, false);
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      document.body.classList.remove('col-resizing');
      saveUi();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- OFF-TYPE builder

  // Màu trùng tag Physical-DPS / Special-DPS cho dễ nhận
  const OFF_CATS = [
    { key: 'PHYSICAL', label: 'Physical', color: '#ef4444' },
    { key: 'SPECIAL', label: 'Special', color: '#3b82f6' },
  ];
  const OFF_SORTS = [
    { key: 'cat', label: 'Physical → Special' },
    { key: 'new', label: 'Mới tạo trước' },
    { key: 'round', label: 'Theo round (R4 → R6)' },
    { key: 'name', label: 'Tên A–Z' },
    { key: 'records', label: 'Nhiều record nhất' },
    { key: 'best', label: 'Điểm cao nhất' },
  ];
  let offView = { cat: '', by: 'team', sort: 'cat', q: '', pair: '' };
  let offDraft = null;
  let offRefs = null;

  const offCatInfo = (cat) => OFF_CATS.find((c) => c.key === cat);
  const catLabel = (cat) => (offCatInfo(cat) || { label: 'Chưa rõ' }).label;

  /** Physical / Special đoán theo role Strike (gốc + EX) và tag Physical-… / Special-… của các pair. */
  function offAutoCategory(t) {
    let ph = 0, sp = 0;
    for (const s of t.slots) {
      const e = s.pair ? iconFor(idx.pair.get(s.pair)) : null;
      if (!e) continue;
      for (const r of [e.role, e.xr]) {
        if (r === 0) ph += 2;
        if (r === 1) sp += 2;
      }
      for (const tag of getTags(e.id)) {
        if (tag.startsWith('Physical')) ph++;
        if (tag.startsWith('Special')) sp++;
      }
    }
    return ph > sp ? 'PHYSICAL' : sp > ph ? 'SPECIAL' : '';
  }

  const offCategory = (t) => t.category || offAutoCategory(t);
  const offPairs = (t) => t.slots.map((s) => s.pair && idx.pair.get(s.pair)).filter(Boolean);

  /** Tên ngắn của pair (tên trainer theo icon). */
  function shortPair(p) {
    const e = iconFor(p);
    return e ? e.tr : pairBaseName(p) || '(trống)';
  }

  function offName(t) {
    return t.name.trim() || offPairs(t).map(shortPair).join(' · ') || 'Team chưa đặt tên';
  }

  /** Move level required của các slot có pair, cùng thứ tự với cột Pair: "5-3-5" ("–" = chưa đặt). */
  function offReqText(t) {
    const reqs = t.slots.filter((s) => s.pair && idx.pair.has(s.pair)).map((s) => (s.req ? s.req : '–'));
    return reqs.length ? reqs.join('-') : '–';
  }

  function offBest(t) {
    const pts = t.records.map((r) => r.points).filter((v) => v != null);
    return pts.length ? Math.max(...pts) : null;
  }

  /** Chỉ mở link http(s); link không có giao thức thì coi là https. */
  function safeHref(url) {
    const u = str(url).trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
    return 'https://' + u;
  }

  const linkIcon = (kind) => ic(kind === 'video' ? 'play' : 'hex');

  function linkChip(l) {
    return el('a', {
      class: 'off-link' + (l.kind === 'video' ? ' video' : ''), href: safeHref(l.url), target: '_blank', rel: 'noopener noreferrer',
      title: l.url,
    }, linkIcon(l.kind), l.label || (l.kind === 'video' ? 'Video' : 'Grid'));
  }

  /** Ô nhập link + nút mở link (mờ khi chưa có link hợp lệ). */
  function linkField(obj, key, kind, props = {}, onInput) {
    const open = el('a', {
      class: 'icon-btn plain link-open', target: '_blank', rel: 'noopener noreferrer',
      title: kind === 'video' ? 'Mở video' : 'Mở grid', 'aria-label': kind === 'video' ? 'Mở video' : 'Mở grid',
    }, linkIcon(kind));
    const sync = () => {
      const h = safeHref(obj[key]);
      if (h) open.href = h;
      else open.removeAttribute('href');
      open.classList.toggle('off', !h);
    };
    const input = el('input', {
      class: 'edit', type: 'text', inputmode: 'url', spellcheck: 'false', value: str(obj[key]),
      placeholder: kind === 'video' ? 'Link video…' : 'Link grid…', ...props,
      oninput: (e) => { obj[key] = e.target.value.trim(); sync(); if (onInput) onInput(); },
    });
    sync();
    return el('span', { class: 'link-field' }, open, input);
  }

  function catChip(cat, auto) {
    const c = offCatInfo(cat);
    return el('span', {
      class: 'ptag off-cat' + (auto ? ' auto' : ''), style: c ? `--tag:${c.color}` : null,
      title: auto ? 'Tự động theo role Strike / tag của các pair – đổi ở mục Loại trong team' : null,
    }, c ? c.label : 'Chưa rõ');
  }

  /** Nút lọc nhanh theo một pair: icon + tên trainer. */
  function pairFilterBtn(p, size, extra) {
    return el('button', {
      type: 'button', class: 'off-mini' + (offView.pair === p.id ? ' on' : ''), title: `${pairLabel(p)} – bấm để lọc theo pair này`,
      onclick: () => setPairFilter(p.id),
    }, CATALOG.length ? avatar(iconFor(p), size) : null, el('span', { class: 'off-mini-name' }, shortPair(p)), extra);
  }

  function setPairFilter(id) {
    offView.pair = offView.pair === id ? '' : id;
    refreshOff();
  }

  /** Dùng cho cả panel Tổng hợp và danh sách team. ignorePair: bỏ qua lọc theo pair (bảng "Theo pair"). */
  function offMatches(t, ignorePair) {
    const f = offView;
    if (f.cat && (offCategory(t) || 'NONE') !== f.cat) return false;
    if (f.pair && !ignorePair && !t.slots.some((s) => s.pair === f.pair)) return false;
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = fold([offName(t), t.note, ...t.rounds, ...offPairs(t).map(pairLabel),
      ...t.records.flatMap((r) => [r.season, r.round, r.boss, r.member, r.note])].join(' '));
    return words.every((w) => hay.includes(w));
  }

  function offSorted(list) {
    const rank = (t) => ({ PHYSICAL: 0, SPECIAL: 1 })[offCategory(t)] ?? 2;
    const best = (t) => offBest(t) ?? -1;
    const byName = (a, b) => offName(a).localeCompare(offName(b));
    // Round thấp nhất clear được trước (chưa chọn round thì xuống cuối), cùng round đầu thì team clear nhiều round hơn trước
    const firstRound = (t) => (t.rounds.length ? OFF_ROUNDS.indexOf(t.rounds[0]) : OFF_ROUNDS.length);
    const cmp = {
      cat: (a, b) => rank(a) - rank(b) || byName(a, b),
      round: (a, b) => firstRound(a) - firstRound(b) || b.rounds.length - a.rounds.length || rank(a) - rank(b) || byName(a, b),
      new: (a, b) => b.created - a.created,
      name: byName,
      records: (a, b) => b.records.length - a.records.length || best(b) - best(a),
      best: (a, b) => best(b) - best(a) || byName(a, b),
    }[offView.sort] || byName;
    return [...list].sort(cmp);
  }

  /** Pair -> các team dùng pair đó + các pair hay đi cùng. */
  function offPairIndex(teams) {
    const map = new Map();
    for (const t of teams) {
      const ids = [...new Set(t.slots.map((s) => s.pair).filter((id) => id && idx.pair.has(id)))];
      for (const id of ids) {
        if (!map.has(id)) map.set(id, { p: idx.pair.get(id), teams: [], with: new Map(), records: 0 });
        const row = map.get(id);
        row.teams.push(t);
        row.records += t.records.length;
        for (const o of ids) if (o !== id) row.with.set(o, (row.with.get(o) || 0) + 1);
      }
    }
    return [...map.values()].sort((a, b) => b.teams.length - a.teams.length || shortPair(a.p).localeCompare(shortPair(b.p)));
  }

  /** Nhóm nút bật/tắt (aria-pressed); options: [{ key, label, extra }]. */
  function segmented(label, options, get, set) {
    const btns = options.map((o) => el('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(get() === o.key),
      onclick: () => {
        set(o.key);
        btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].key === o.key)));
      },
    }, o.label, o.extra));
    return el('div', { class: 'seg', role: 'group', 'aria-label': label }, btns);
  }

  function renderOffType() {
    const counts = {};
    const catOpts = [{ key: '', label: 'Tất cả' }, ...OFF_CATS, { key: 'NONE', label: 'Chưa rõ' }]
      .map((o) => ({ ...o, extra: (counts[o.key] = el('span', { class: 'seg-n' })) }));
    offRefs = {
      counts,
      sub: el('span', { class: 'page-sub' }),
      sum: el('div', { class: 'off-sum-body' }),
      openAll: el('button', { type: 'button', class: 'btn btn-sm btn-ghost off-open-all', onclick: toggleAllOff }),
    };
    const toolbar = el('div', { class: 'toolbar off-toolbar' },
      segmented('Lọc theo loại', catOpts, () => offView.cat, (v) => { offView.cat = v; fillOffSummary(); }),
      segmented('Xem theo', [{ key: 'team', label: 'Theo team' }, { key: 'pair', label: 'Theo pair' }],
        () => offView.by, (v) => { offView.by = v; fillOffSummary(); }),
      el('label', { class: 'sort-field', title: 'Sắp xếp' }, ic('sort'),
        el('select', { class: 'field', 'aria-label': 'Sắp xếp team', onchange: (e) => { offView.sort = e.target.value; fillOffSummary(); } },
          OFF_SORTS.map((o) => el('option', { value: o.key, selected: offView.sort === o.key }, o.label)))),
      searchBox({
        placeholder: 'Tìm team, pair, member, boss…', value: offView.q, style: 'width:240px',
        oninput: (e) => { offView.q = e.target.value; fillOffSummary(); },
      }),
    );
    fillOffSummary();
    return el('div', { class: 'off-page' },
      el('div', { class: 'page-head' },
        el('h1', null, 'OFF-TYPE builder'), offRefs.sub,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', title: 'Nạp file team OFF-TYPE (chọn được nhiều file)', onclick: () => $('#fileInput').click() },
          ic('upload'), 'Import team'),
        el('button', { class: 'btn', title: 'Tải toàn bộ team OFF-TYPE (kèm record, link) ra file JSON', onclick: exportOffTeams },
          ic('download'), 'Export team'),
        el('button', { class: 'btn btn-primary', onclick: () => openOffBuilder() }, ic('plus'), 'Tạo team')),
      el('section', { class: 'card off-sum', 'aria-label': 'Danh sách team OFF-TYPE' },
        el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, 'Tổng hợp'), offRefs.openAll, toolbar),
        offRefs.sum));
  }

  const refreshOff = () => fillOffSummary();

  /** Team đang hiện trong bảng "Theo team" (sau lọc + sắp xếp). */
  function visibleOffTeams() {
    return offSorted(state.offTeams.filter((t) => offMatches(t)));
  }

  /** Số đếm trên nút lọc, dòng phụ dưới tiêu đề và nút Mở / Thu gọn tất cả – không vẽ lại bảng. */
  function updateOffCounts() {
    if (!offRefs) return;
    const all = state.offTeams;
    const n = { '': all.length, PHYSICAL: 0, SPECIAL: 0, NONE: 0 };
    for (const t of all) n[offCategory(t) || 'NONE']++;
    for (const [k, node] of Object.entries(offRefs.counts)) node.textContent = n[k];
    offRefs.sub.textContent = `${all.length} team · ${all.reduce((x, t) => x + t.records.length, 0)} record`;
    const teams = offView.by === 'team' ? visibleOffTeams() : [];
    const allOpen = teams.length > 0 && teams.every((t) => ui.offOpen.has(t.id));
    offRefs.openAll.textContent = allOpen ? 'Thu gọn tất cả' : 'Mở tất cả';
    offRefs.openAll.hidden = !teams.length;
  }

  function toggleAllOff() {
    const teams = visibleOffTeams();
    const allOpen = teams.length > 0 && teams.every((t) => ui.offOpen.has(t.id));
    for (const t of teams) {
      if (allOpen) ui.offOpen.delete(t.id);
      else ui.offOpen.add(t.id);
    }
    saveUi();
    fillOffSummary();
  }

  function fillOffSummary() {
    if (!offRefs) return;
    if (offView.pair && !idx.pair.has(offView.pair)) offView.pair = '';
    updateOffCounts();
    const p = offView.pair && idx.pair.get(offView.pair);
    const filter = p ? el('div', { class: 'off-filter' },
      'Đang lọc team có pair', CATALOG.length ? avatar(iconFor(p), 24) : null, el('strong', null, pairLabel(p)),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => setPairFilter('') }, ic('x'), 'Bỏ lọc')) : null;
    offRefs.sum.replaceChildren(...[filter, offView.by === 'pair' ? offPairTable() : offTeamTable()].filter(Boolean));
  }

  const offHasRounds = () => state.offTeams.some((t) => t.rounds.length);

  /** Cột của bảng team; cột Round chỉ hiện khi có team đã tick round. */
  function offColumns(showRound) {
    return [
      { label: 'Team', props: { class: 'off-sticky' } },
      { label: 'Loại' },
      showRound ? { label: 'Round', props: { title: 'Round team clear được' } } : null,
      { label: 'Pair', props: { title: 'Bấm icon để lọc theo pair đó' } },
      { label: 'Đạt', props: { class: 'num', title: 'Số member có đủ pair và đạt Required' } },
      { label: 'Move level', props: { class: 'num', title: 'Move level required theo thứ tự pair' } },
      { label: 'Record', props: { class: 'num' } },
      { label: 'Điểm max', props: { class: 'num', title: 'Điểm cao nhất trong các record' } },
      { label: 'Link' },
    ].filter(Boolean);
  }

  /** Bảng team dạng accordion: mỗi team một hàng, bấm hàng để mở chi tiết (slot, link, record) ngay dưới. */
  function offTeamTable() {
    if (!state.offTeams.length) {
      return el('div', { class: 'empty off-empty' }, 'Chưa có team nào. ',
        el('button', { class: 'btn btn-sm btn-primary', onclick: () => openOffBuilder() }, ic('plus'), 'Tạo team đầu tiên'));
    }
    const teams = visibleOffTeams();
    if (!teams.length) return el('div', { class: 'empty off-empty' }, 'Không có team nào khớp bộ lọc.');
    const showRound = offHasRounds();
    const cols = offColumns(showRound);
    const rows = [];
    let lastCat = null;
    for (const t of teams) {
      const cat = offCategory(t);
      if (offView.sort === 'cat' && cat !== lastCat) {
        lastCat = cat;
        rows.push(el('tr', { class: 'off-group' }, el('td', { colspan: cols.length }, catChip(cat),
          el('span', { class: 'muted small' }, ` ${teams.filter((x) => offCategory(x) === cat).length} team`))));
      }
      rows.push(...renderOffRows(t, showRound));
    }
    const scroll = el('div', { class: 'scroll off-scroll' }, resizableTable(el('table', { class: 'matrix off-table off-accordion' },
      el('thead', null, el('tr', null, cols.map((c) => el('th', c.props, c.label)))),
      el('tbody', null, rows)), showRound ? 'off-team2r' : 'off-team2'));
    trackScrollWidth(scroll);
    return scroll;
  }

  /**
   * Ghi độ rộng khung cuộn vào --sw để thân chi tiết (hàng colspan) dính mép trái và rộng đúng bằng khung,
   * thay vì rộng bằng cả bảng rồi cuộn ngang theo (màn hình hẹp).
   */
  function trackScrollWidth(scroll) {
    const set = () => scroll.style.setProperty('--sw', scroll.clientWidth + 'px');
    if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(scroll);
    else requestAnimationFrame(set);
  }

  /** Icon các pair của team; bấm để lọc theo pair (tên đầy đủ trong tooltip). */
  function offPairIcons(t) {
    return t.slots.map((s) => {
      const p = s.pair && idx.pair.get(s.pair);
      if (!p) return s.pairName ? el('span', { class: 'off-ico warn', title: 'Chưa map: ' + s.pairName }, '⚠') : null;
      return el('button', {
        type: 'button', class: 'off-ico' + (offView.pair === p.id ? ' on' : ''),
        title: `${pairLabel(p)}\nBấm để lọc theo pair này`, 'aria-label': `Lọc theo ${pairLabel(p)}`, 'aria-pressed': String(offView.pair === p.id),
        onclick: () => setPairFilter(p.id),
      }, CATALOG.length ? avatar(iconFor(p), 30) : el('span', { class: 'off-ico-txt' }, shortPair(p)));
    });
  }

  /**
   * Một team trong bảng: hàng tóm tắt (luôn hiện) + hàng chi tiết (khi mở). Trả về [tr] hoặc [tr, trChiTiết].
   * Sửa trong chi tiết xong (blur) thì hàng tóm tắt tự cập nhật, giữ nguyên nút mở / thu gọn.
   */
  function renderOffRows(t, showRound) {
    const open = ui.offOpen.has(t.id);
    const cat = offCategory(t) || 'NONE';
    const tr = el('tr', { class: 'off-row' + (open ? ' open' : ''), id: 'off-' + t.id, dataset: { cat } });
    let detail = null;
    const rerender = (focusKey) => {
      if (offHasRounds() !== showRound) { fillOffSummary(); save(); return; } // thêm / bỏ cột Round -> vẽ lại cả bảng
      const fk = focusKey || activeFk(tr) || (detail && activeFk(detail));
      const fresh = renderOffRows(t, showRound);
      if (detail) detail.remove();
      tr.replaceWith(...fresh);
      for (const row of fresh) {
        const f = fk && row.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
        if (f) { f.focus(); break; }
      }
      save();
      updateOffCounts();
    };
    const toggle = () => {
      if (open) ui.offOpen.delete(t.id);
      else ui.offOpen.add(t.id);
      saveUi();
      rerender('toggle');
    };
    const best = offBest(t);
    // append(null) sẽ chèn chữ "null" nên phải lọc trước (cột Round có thể không có)
    tr.append(...[
      el('td', { class: 'off-sticky' },
        el('button', {
          type: 'button', class: 'off-toggle', 'aria-expanded': String(open), dataset: { fk: 'toggle' },
          title: open ? 'Thu gọn' : 'Mở chi tiết', onclick: toggle,
        }, ic('chevron'), el('span', { class: 'off-name' }, offName(t)))),
      el('td', null, catChip(cat === 'NONE' ? '' : cat, !t.category)),
      showRound ? el('td', null, roundChips(t) || el('span', { class: 'muted' }, '–')) : null,
      el('td', null, el('div', { class: 'off-icos' }, offPairIcons(t))),
      el('td', { class: 'num' }, teamPill(evalTeam(t))),
      el('td', { class: 'num off-req', title: 'Move level required của từng pair (– = chưa đặt)' }, offReqText(t)),
      el('td', { class: 'num' }, t.records.length || '–'),
      el('td', { class: 'num' }, best != null ? fmtNum(best) : '–'),
      el('td', null, el('div', { class: 'off-links' }, t.links.filter((l) => safeHref(l.url)).map(linkChip))),
    ].filter(Boolean));
    tr.addEventListener('click', (e) => { if (!e.target.closest('a, button, input, select, textarea')) toggle(); });
    if (!open) return [tr];
    detail = el('tr', { class: 'off-detail', dataset: { cat } },
      el('td', { colspan: offColumns(showRound).length }, offPanelBody(t, rerender)));
    detail.addEventListener('change', () => afterPointer(() => {
      if (!detail.isConnected) return;
      if (offHasRounds() !== showRound) { // tick round đầu tiên / bỏ round cuối -> thêm / bỏ cột Round, vẽ lại cả bảng
        const fk = activeFk(detail);
        fillOffSummary();
        refocus(offRefs.sum, fk);
        return;
      }
      // Chụp mảng ô trước khi chuyển: fresh.children là collection động, chuyển ô đi là nó co lại
      const cells = [...renderOffRows(t, showRound)[0].children];
      tr.querySelector('.off-name').textContent = offName(t);
      [...tr.children].slice(1).forEach((c, i) => c.replaceWith(cells[i + 1]));
      tr.dataset.cat = detail.dataset.cat = offCategory(t) || 'NONE';
      updateOffCounts();
    }));
    return [tr, detail];
  }

  function offPairTable() {
    const rows = offPairIndex(state.offTeams.filter((t) => offMatches(t, true)));
    if (!rows.length) {
      return el('div', { class: 'empty off-empty' }, state.offTeams.length ? 'Không có pair nào khớp bộ lọc.' : 'Chưa có team nào.');
    }
    return el('div', { class: 'scroll' }, resizableTable(el('table', { class: 'matrix off-table' },
      el('thead', null, el('tr', null,
        el('th', null, 'Pair'), el('th', { class: 'num' }, 'Số team'), el('th', null, 'Team dùng pair'),
        el('th', { title: 'Pair xuất hiện cùng team, ×n = số team chung' }, 'Đi cùng'), el('th', { class: 'num' }, 'Record'))),
      el('tbody', null, rows.map((row) => el('tr', { class: offView.pair === row.p.id ? 'on' : null },
        el('td', null, pairFilterBtn(row.p, 30), roleLine(row.p)),
        el('td', { class: 'num strong' }, row.teams.length),
        el('td', null, el('div', { class: 'chips' }, offSorted(row.teams).map((t) => {
          const c = offCatInfo(offCategory(t));
          return el('button', { type: 'button', class: 'chip off-chip', title: `Mở team · ${catLabel(offCategory(t))}`, onclick: () => openOffTeam(t) },
            el('i', { class: 'off-dot', style: c ? `background:${c.color}` : null }), offName(t));
        }))),
        el('td', null, el('div', { class: 'off-minis' }, [...row.with]
          .sort((a, b) => b[1] - a[1])
          .map(([id, k]) => pairFilterBtn(idx.pair.get(id), 24, k > 1 ? el('span', { class: 'muted' }, `×${k}`) : null)))),
        el('td', { class: 'num' }, row.records || '–'),
      )))), 'off-pair'));
  }

  /** Chuyển sang "Theo team", mở chi tiết của team và cuộn tới (bỏ lọc nếu team đang bị ẩn). */
  function openOffTeam(t) {
    ui.offOpen.add(t.id);
    saveUi();
    offView.by = 'team';
    if (!offMatches(t)) offView = { ...offView, cat: '', q: '', pair: '' };
    render();
    const node = document.getElementById('off-' + t.id);
    if (!node) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    const btn = node.querySelector('.off-toggle');
    if (btn) btn.focus({ preventScroll: true });
  }

  let pointerIsDown = false;
  document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerIsDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerIsDown = false; }, true);

  /** Chạy fn ngay, hoặc (nếu đang giữ chuột) sau khi thả chuột và click xong. */
  function afterPointer(fn) {
    if (!pointerIsDown) { fn(); return; }
    const done = () => {
      document.removeEventListener('pointerup', done, true);
      document.removeEventListener('pointercancel', done, true);
      setTimeout(fn);
    };
    document.addEventListener('pointerup', done, true);
    document.addEventListener('pointercancel', done, true);
  }

  /** data-fk của ô đang focus trong `root` (để focus lại sau khi vẽ lại). */
  function activeFk(root) {
    const a = document.activeElement;
    return a && root.contains(a) && a.dataset ? a.dataset.fk : null;
  }

  function refocus(root, fk) {
    const f = fk && root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (f) f.focus();
  }

  const samePairs = (a, b) => {
    const ka = a.slots.map((s) => s.pair).filter(Boolean).sort().join('|');
    return ka !== '' && ka === b.slots.map((s) => s.pair).filter(Boolean).sort().join('|');
  };

  function catSelect(obj, auto, onChange, props = {}) {
    return el('select', { class: 'field', ...props, onchange: (e) => { obj.category = e.target.value; onChange(); } },
      el('option', { value: '' }, `Tự động (${catLabel(auto)})`),
      OFF_CATS.map((c) => el('option', { value: c.key, selected: obj.category === c.key }, c.label)));
  }

  /** Chip R4 / R5 / R6 của các round team clear được. */
  function roundChips(t) {
    return t.rounds.length
      ? el('span', { class: 'off-rounds' }, t.rounds.map((r) => el('span', { class: 'off-round' }, r)))
      : null;
  }

  /** Nhóm checkbox chọn round team clear được. */
  function roundPicker(obj, onChange) {
    return el('div', { class: 'off-round-field', role: 'group', 'aria-label': 'Round clear được' },
      el('span', { class: 'off-field-label' }, 'Round clear được'),
      el('div', { class: 'off-round-checks' }, OFF_ROUNDS.map((r) => el('label', { class: 'off-round-check' },
        el('input', {
          type: 'checkbox', checked: obj.rounds.includes(r), dataset: { fk: `round-${r}` },
          onchange: (e) => {
            const on = new Set(obj.rounds);
            if (e.target.checked) on.add(r); else on.delete(r);
            obj.rounds = OFF_ROUNDS.filter((x) => on.has(x));
            if (onChange) onChange();
          },
        }), r))));
  }

  /**
   * Popup tạo team: tên, loại, link grid / video, 3 pair. Tạo xong team thành một panel trong danh sách.
   * Đóng popup không mất nháp; "Làm lại" mới xóa.
   */
  function openOffBuilder() {
    const dlg = $('#offDialog');
    const draw = (focusKey) => {
      const fk = focusKey || activeFk(dlg);
      const d = offDraft || (offDraft = { name: '', category: '', rounds: [], note: '', grid: '', video: '', slots: [emptySlot(), emptySlot(), emptySlot()] });
      const hasPair = d.slots.some((s) => s.pair);
      const dup = hasPair && state.offTeams.find((t) => samePairs(t, d));
      const create = () => {
        const links = [['grid', d.grid], ['video', d.video]].filter(([, u]) => u).map(([kind, url]) => ({ kind, url }));
        const t = normOffTeam({ ...d, name: d.name.trim(), links, records: [], created: Date.now() });
        state.offTeams.push(t);
        offDraft = null;
        save();
        dlg.close();
        toast(`Đã tạo team "${offName(t)}"`, 'ok');
        openOffTeam(t);
      };
      dlg.replaceChildren(
        dialogHead('Tạo team mới', () => dlg),
        el('p', { class: 'hint' }, 'Chọn tối đa 3 pair từ Rosters và move level required (kéo nút ⠿ để đổi vị trí). '
          + 'Tạo xong, team hiện trong bảng và tự mở để thêm record, grid, video.'),
        el('div', { class: 'off-settings' },
          el('label', null, 'Tên team',
            el('input', { class: 'edit', value: d.name, placeholder: 'vd Mega Ray nuke', dataset: { fk: 'name' }, oninput: (e) => { d.name = e.target.value; } })),
          el('label', null, 'Loại', catSelect(d, offAutoCategory(d), draw, { dataset: { fk: 'cat' } })),
          roundPicker(d),
          el('label', { class: 'span3' }, 'Link grid', linkField(d, 'grid', 'grid', { dataset: { fk: 'grid' } })),
          el('label', { class: 'span3' }, 'Link video', linkField(d, 'video', 'video', { dataset: { fk: 'video' } }))),
        el('div', { class: 'slots' }, d.slots.map((s, i) => renderSlot(d, s, i, draw, true))),
        dup ? el('div', { class: 'warn off-dup' }, `Đã có team cùng bộ pair: "${offName(dup)}". Vẫn tạo được nếu bạn muốn tách phương án.`) : '',
        el('div', { class: 'dlg-foot' },
          el('button', { class: 'btn btn-ghost', style: 'margin-right:auto', onclick: () => { offDraft = null; draw('name'); } }, 'Làm lại'),
          el('button', { class: 'btn', onclick: () => dlg.close() }, 'Đóng'),
          el('button', { class: 'btn btn-primary', disabled: !hasPair, title: hasPair ? null : 'Chọn ít nhất 1 pair', onclick: create },
            ic('plus'), 'Tạo team')),
      );
      refocus(dlg, fk);
    };
    draw();
    dlg.showModal();
    refocus(dlg, 'name');
  }

  function offPanelBody(t, rerender) {
    const result = evalTeam(t);
    const settings = el('div', { class: 'off-settings' },
      el('label', null, 'Tên team', bound(t, 'name', { placeholder: offName(t), dataset: { fk: 'name' } })),
      el('label', null, 'Loại', catSelect(t, offAutoCategory(t), () => rerender(), { dataset: { fk: 'cat' } })),
      roundPicker(t, save),
      el('label', { class: 'wide' }, 'Ghi chú', boundArea(t, 'note', { placeholder: 'Cách xoay, thứ tự skill, lưu ý… (Enter để xuống dòng)' })),
    );
    return el('div', { class: 'off-body' },
      settings,
      el('div', { class: 'slots' }, t.slots.map((s, i) => renderSlot(t, s, i, rerender, true))),
      el('details', { class: 'others off-qual' },
        el('summary', null, `Member có thể dùng team (${result.qualified.length} đạt)`),
        renderResult(t, result)),
      offLinkEditor(t, rerender),
      offRecordTable(t, rerender),
      el('div', { class: 'off-foot' },
        el('button', {
          class: 'btn btn-sm btn-ghost btn-danger',
          onclick: () => {
            const extra = t.records.length ? ` cùng ${t.records.length} record` : '';
            if (!confirm(`Xóa team "${offName(t)}"${extra}?`)) return;
            state.offTeams = state.offTeams.filter((x) => x !== t);
            ui.offOpen.delete(t.id);
            saveUi();
            save();
            renderTabs(currentRoute());
            fillOffSummary();
          },
        }, 'Xóa team')),
    );
  }

  /** Danh sách link grid / video của team. */
  function offLinkEditor(t, rerender) {
    const add = (kind) => {
      t.links.push(normLink({ kind }));
      rerender(`link${t.links.length - 1}`);
    };
    const rows = t.links.map((l, k) => el('div', { class: 'off-link-row' },
      el('select', {
        class: 'field', 'aria-label': 'Loại link', dataset: { fk: `kind${k}` },
        onchange: (e) => { l.kind = e.target.value; rerender(); },
      }, el('option', { value: 'grid', selected: l.kind === 'grid' }, 'Grid'), el('option', { value: 'video', selected: l.kind === 'video' }, 'Video')),
      bound(l, 'label', { class: 'edit off-input', placeholder: l.kind === 'video' ? 'Tên (vd Clear 1.2M)…' : 'Tên (vd Grid lv 5)…', 'aria-label': 'Tên link' }),
      linkField(l, 'url', l.kind, { dataset: { fk: `link${k}` }, 'aria-label': 'Link' }, save),
      el('button', {
        class: 'icon-btn', title: 'Xóa link', 'aria-label': 'Xóa link',
        onclick: () => { t.links.splice(k, 1); rerender(); },
      }, ic('x'))));
    return el('div', { class: 'off-sec' },
      el('div', { class: 'off-sec-head' },
        el('h3', null, 'Grid & video của team'),
        el('button', { class: 'btn btn-sm', onclick: () => add('grid') }, ic('hex'), 'Grid'),
        el('button', { class: 'btn btn-sm', onclick: () => add('video') }, ic('play'), 'Video')),
      rows.length ? rows : el('div', { class: 'empty' }, 'Chưa có link nào.'));
  }

  /** Bảng record team đã dùng ở các kì GvG trước; mỗi record có link grid / video riêng. */
  function offRecordTable(t, rerender) {
    const uniq = (arr) => [...new Set(arr.map((x) => str(x).trim()).filter(Boolean))];
    const recs = state.offTeams.flatMap((x) => x.records);
    const lists = {
      season: uniq([...SEASONS.map((s) => s.name), ...recs.map((r) => r.season)]),
      boss: uniq([...SEASONS.flatMap((s) => s.gyms.map((g) => g.name)), ...state.bosses.map((b) => b.name), ...recs.map((r) => r.boss)]),
      member: uniq([...state.members.map((m) => m.name), ...recs.map((r) => r.member)]),
    };
    const ids = {};
    const datalists = Object.entries(lists).map(([k, vals]) => el('datalist', { id: (ids[k] = uid('dl')) }, vals.map((v) => el('option', { value: v }))));

    const add = () => {
      const last = t.records[0];
      const r = normRecord({ season: last ? last.season : SEASONS.length ? SEASONS[SEASONS.length - 1].name : '' });
      t.records.unshift(r);
      rerender(`${r.id}-round`);
    };
    const cell = (r, key, label, props = {}) => el('td', null,
      bound(r, key, { 'aria-label': label, placeholder: label + '…', dataset: { fk: `${r.id}-${key}` }, ...props }));
    const rows = t.records.map((r) => el('tr', null,
      cell(r, 'season', 'Mùa', { list: ids.season }),
      cell(r, 'round', 'Round / ngày'),
      cell(r, 'boss', 'Boss / gym', { list: ids.boss }),
      cell(r, 'member', 'Member', { list: ids.member }),
      el('td', null, el('input', {
        class: 'edit num', value: r.points != null ? fmtNum(r.points) : '', inputmode: 'numeric', placeholder: 'điểm…',
        'aria-label': 'Điểm', dataset: { fk: `${r.id}-points` },
        onchange: (e) => {
          const digits = e.target.value.replace(/\D/g, '');
          r.points = digits ? Number(digits) : null;
          e.target.value = digits ? fmtNum(r.points) : '';
          save();
        },
      })),
      el('td', null, linkField(r, 'grid', 'grid', { 'aria-label': 'Link grid', dataset: { fk: `${r.id}-grid` } }, save)),
      el('td', null, linkField(r, 'video', 'video', { 'aria-label': 'Link video', dataset: { fk: `${r.id}-video` } }, save)),
      el('td', null, boundArea(r, 'note', { 'aria-label': 'Ghi chú', placeholder: 'Ghi chú…', dataset: { fk: `${r.id}-note` } })),
      el('td', null, el('button', {
        class: 'icon-btn', title: 'Xóa record', 'aria-label': 'Xóa record',
        onclick: () => {
          const filled = [r.round, r.boss, r.member, r.grid, r.video, r.note].some(Boolean) || r.points != null;
          if (filled && !confirm('Xóa record này?')) return;
          t.records = t.records.filter((x) => x !== r);
          rerender();
        },
      }, ic('x'))),
    ));
    return el('div', { class: 'off-sec' },
      el('div', { class: 'off-sec-head' },
        el('h3', null, `Record các kì GvG trước (${t.records.length})`),
        el('button', { class: 'btn btn-sm', onclick: add }, ic('plus'), 'Record')),
      datalists,
      rows.length
        ? el('div', { class: 'scroll' }, resizableTable(el('table', { class: 'matrix off-records' },
          el('thead', null, el('tr', null, ['Mùa', 'Round', 'Boss / gym', 'Member', 'Điểm', 'Grid', 'Video', 'Ghi chú', '']
            .map((h, i) => el('th', { class: i === 4 ? 'num' : null }, h)))),
          el('tbody', null, rows)), 'off-records', [8]))
        : el('div', { class: 'empty' }, 'Chưa có record – bấm "+ Record" để ghi lại lần team được dùng (mùa, boss, member, điểm, grid, video).'));
  }

  // ---------------------------------------------------------------- Icon library view

  const LIB_FILTER = { q: '', type: '', role: '', withEx: true, tag: '', sort: '', only: '' };
  let libFilter = { ...LIB_FILTER };

  function renderIconLibrary() {
    const used = rosterUsage();
    const grid = el('div', { class: 'cat-grid' });
    const count = el('span', { class: 'muted' });

    const addToRoster = (e) => {
      const tname = typeName(e) || 'Khác';
      let g = state.groups.find((x) => Match.fold(x.type) === Match.fold(tname));
      if (!g) {
        g = { id: uid('g'), type: tname, pairs: [] };
        state.groups.push(g);
      }
      g.pairs.push({ id: uid('p'), name: Match.displayName(e), note: '', levels: {}, icon: e.id });
      reindex();
      save();
      toast(`Đã thêm "${Match.displayName(e)}" vào nhóm ${g.type}`, 'ok');
      fill();
    };

    const fill = () => {
      const u = rosterUsage();
      let hits = searchCatalog(libFilter.q, libFilter.type);
      if (libFilter.role !== '') {
        const r = Number(libFilter.role);
        hits = hits.filter((e) => e.role === r || (libFilter.withEx && e.xr === r));
      }
      if (libFilter.tag === '__none') hits = hits.filter((e) => !getTags(e.id).length);
      else if (libFilter.tag) hits = hits.filter((e) => getTags(e.id).includes(libFilter.tag));
      if (libFilter.sort === 'new') hits = [...hits].sort((a, b) => (b.d || 0) - (a.d || 0));
      if (libFilter.only === 'in') hits = hits.filter((e) => u.has(e.id));
      if (libFilter.only === 'out') hits = hits.filter((e) => !u.has(e.id));
      if (libFilter.only === 'new') hits = hits.filter((e) => catalogInfo.newIds.includes(e.id));
      count.textContent = `${hits.length} / ${CATALOG.length} pair`;
      grid.replaceChildren(...hits.slice(0, 300).map((e) => {
        const pairs = u.get(e.id);
        const extra = pairs
          ? el('div', { class: 'cat-used' }, '✓ Rosters: ', pairs.map(pairLabel).join(', '))
          : el('button', { class: 'btn btn-sm', style: 'margin-top:6px', onclick: () => addToRoster(e) }, ic('plus'), 'Thêm vào Rosters');
        return catalogCard(e, [tagEditor(e), extra]);
      }));
      if (hits.length > 300) grid.append(el('div', { class: 'empty' }, `Còn ${hits.length - 300} kết quả – gõ thêm để lọc.`));
      if (!hits.length) grid.append(el('div', { class: 'empty' }, 'Không tìm thấy pair nào.'));
    };

    const types = [...new Set(CATALOG.map(typeName).filter(Boolean))];
    const toolbar = el('div', { class: 'toolbar' },
      searchBox({
        placeholder: 'Tìm trainer / pokémon / role…', value: libFilter.q, style: 'width:280px',
        oninput: (ev) => { libFilter.q = ev.target.value; fill(); },
      }),
      el('select', { class: 'field', onchange: (ev) => { libFilter.type = ev.target.value; fill(); } },
        el('option', { value: '' }, 'Tất cả type'),
        types.map((t) => el('option', { value: t, selected: libFilter.type === t }, t))),
      el('select', { class: 'field', onchange: (ev) => { libFilter.role = ev.target.value; fill(); } },
        el('option', { value: '' }, 'Tất cả role'),
        ROLE_LABELS.map((r, i) => el('option', { value: i, selected: libFilter.role === String(i) }, r))),
      el('label', { class: 'check', title: 'Lọc role tính cả EX role (vd Field gồm cả pair có EX role Field)' },
        el('input', { type: 'checkbox', checked: libFilter.withEx, onchange: (ev) => { libFilter.withEx = ev.target.checked; fill(); } }),
        'Tính cả EX role'),
      el('select', { class: 'field', onchange: (ev) => { libFilter.tag = ev.target.value; fill(); } },
        el('option', { value: '' }, 'Tất cả tag'),
        PAIR_TAGS.map((t) => el('option', { value: t.name, selected: libFilter.tag === t.name }, t.name)),
        el('option', { value: '__none', selected: libFilter.tag === '__none' }, 'Chưa gắn tag')),
      el('select', { class: 'field', title: 'Sắp xếp', onchange: (ev) => { libFilter.sort = ev.target.value; fill(); } },
        el('option', { value: '' }, 'Tên A–Z'),
        el('option', { value: 'new', selected: libFilter.sort === 'new' }, 'Mới ra trước')),
      el('select', { class: 'field', onchange: (ev) => { libFilter.only = ev.target.value; fill(); } },
        el('option', { value: '' }, 'Tất cả'),
        el('option', { value: 'in', selected: libFilter.only === 'in' }, 'Đã có trong Rosters'),
        el('option', { value: 'out', selected: libFilter.only === 'out' }, 'Chưa có trong Rosters'),
        catalogInfo.newIds.length
          ? el('option', { value: 'new', selected: libFilter.only === 'new' }, `Mới cập nhật (${catalogInfo.newIds.length})`)
          : null),
      count,
    );
    fill();
    return el('div', null,
      el('div', { class: 'page-head' }, el('h1', null, 'Kho icon'),
        el('span', { class: 'page-sub' }, `${used.size} pair trong Rosters đã có icon · nguồn: pomatools.site`)),
      el('p', { class: 'hint' },
        'Pair trong Rosters tự nhận icon theo tên. Bấm vào icon ở bảng Rosters để chọn tay nếu khớp sai. ' +
        '"+ Thêm vào Rosters" sẽ tạo dòng mới trong nhóm type tương ứng. Mỗi pair có role gốc và EX role (nếu có); ' +
        'rê chuột lên ngày ra mắt để xem ngày Grid / EX / EX Role.'),
      toolbar, grid);
  }

  // ---------------------------------------------------------------- Mùa giải (record từ Excel – chỉ xem)

  const SEASONS = Array.isArray(window.GVG_SEASONS) ? window.GVG_SEASONS : [];
  // Màu theo role (palette đã kiểm tra mù màu, xem styles.css --s1..--s4); "Khác" gồm Conga…
  const ROLE_SERIES = [
    { key: 'carry', label: 'Carry', cls: 's1' },
    { key: 'cheer', label: 'Cheer', cls: 's2' },
    { key: 'stall', label: 'Stall', cls: 's3' },
    { key: '', label: 'Khác', cls: 's4' },
  ];
  const SEASON_TABS = [
    { key: 'rank', label: 'Xếp hạng' },
    { key: 'rounds', label: 'Theo round' },
    { key: 'gyms', label: 'Gym Leader' },
    { key: 'battles', label: 'Lịch sử đánh' },
  ];
  const roleSeries = (role) => ROLE_SERIES.find((r) => r.key && r.key === fold(role)) || ROLE_SERIES[3];
  const fmtNum = (n) => Math.round(n || 0).toLocaleString('vi-VN');
  const fmtDay = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
  const fmtShort = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}M`
    : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  let seasonFilter = { round: '', gym: '', member: '', role: '', q: '' };

  /** Tổng hợp từ danh sách trận (tính một lần cho mỗi mùa). */
  function seasonStats(s) {
    if (s._stats) return s._stats;
    const member = (name) => {
      if (!members.has(name)) members.set(name, { name, fb: '', group: '' });
      return members.get(name);
    };
    const members = new Map(s.members.map((m) => [m.name, { ...m }]));
    for (const m of members.values()) Object.assign(m, { points: 0, tickets: 0, battles: 0, byRole: {} });
    const rounds = new Map(s.rounds.map((r) => [r.n, { ...r, points: 0, tickets: 0, list: [] }]));
    const gyms = new Map(s.gyms.map((g) => [g.key, { ...g, points: 0, tickets: 0, battles: 0, byMember: new Map() }]));
    let points = 0, tickets = 0;
    for (const b of s.battles) {
      const m = member(b.member);
      if (m.points === undefined) Object.assign(m, { points: 0, tickets: 0, battles: 0, byRole: {} });
      const rk = roleSeries(b.role).cls;
      m.points += b.points; m.tickets += b.tickets; m.battles++;
      m.byRole[rk] = (m.byRole[rk] || 0) + b.points;
      const r = rounds.get(b.round);
      if (r) { r.points += b.points; r.tickets += b.tickets; r.list.push(b); }
      const g = gyms.get(b.gym);
      if (g) {
        g.points += b.points; g.tickets += b.tickets; g.battles++;
        g.byMember.set(b.member, (g.byMember.get(b.member) || 0) + b.points);
      }
      points += b.points; tickets += b.tickets;
    }
    s._stats = { members, rounds, gyms, points, tickets };
    return s._stats;
  }

  // Tooltip dùng chung cho biểu đồ (hover / focus bằng bàn phím)
  const vizTip = el('div', { class: 'viz-tip', role: 'tooltip' });
  function withTip(node, content) {
    const show = (e) => {
      vizTip.replaceChildren(...[].concat(content()));
      if (!vizTip.isConnected) document.body.append(vizTip);
      const rect = node.getBoundingClientRect();
      const x = e && e.clientX !== undefined ? e.clientX : rect.left + rect.width / 2;
      const y = e && e.clientY !== undefined ? e.clientY : rect.top;
      const w = vizTip.offsetWidth, h = vizTip.offsetHeight;
      vizTip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 12)) + 'px';
      vizTip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
    };
    const hide = () => vizTip.remove();
    node.addEventListener('mouseenter', show);
    node.addEventListener('mousemove', show);
    node.addEventListener('mouseleave', hide);
    node.addEventListener('focus', () => show());
    node.addEventListener('blur', hide);
    return node;
  }
  const tipLines = (title, ...rows) => [el('strong', null, title), ...rows.filter(Boolean).map((r) => el('div', null, r))];

  function roleTagEl(role) {
    const r = roleSeries(role);
    return el('span', { class: 'role-dot-tag' }, el('i', { class: 'sw ' + r.cls }), role || r.label);
  }

  function gymName(s, key) {
    const g = s.gyms.find((x) => x.key === key);
    return g ? el('span', { class: 'boss-link' }, typeDot(fold(g.weakness)), g.name) : key;
  }

  function renderSeason(route) {
    const s = route.season;
    const st = seasonStats(s);
    const tab = SEASON_TABS.some((t) => t.key === route.sub) ? route.sub : 'rank';
    const sched = s.schedule.map((x) => `${x.label} ${fmtDay(x.from)}${x.to ? '–' + fmtDay(x.to) : ''}`).join(' · ');
    const totalTickets = s.ticketsPerMember * s.members.length;
    const kpi = (label, value, sub) => el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, label),
      el('span', { class: 'kpi-value' }, value), sub ? el('span', { class: 'kpi-sub' }, sub) : null);

    const head = el('div', { class: 'page-head' },
      el('h1', null, s.name),
      el('span', { class: 'page-sub' }, `${sched} · nguồn: ${s.source}`));
    const kpis = el('div', { class: 'kpis' },
      kpi('Tổng điểm', fmtNum(st.points), `${s.guild}`),
      kpi('Số trận', fmtNum(s.battles.length), `${s.rounds.length} round · ${new Set(s.rounds.map((r) => r.day)).size} ngày`),
      kpi('Vé đã dùng', `${fmtNum(st.tickets)} / ${fmtNum(totalTickets)}`, `${s.ticketsPerMember} vé mỗi member`),
      kpi('Điểm trung bình / vé', fmtNum(st.tickets ? st.points / st.tickets : 0)),
    );
    const tabs = el('nav', { class: 'season-tabs jump-strip', 'aria-label': 'Mục của mùa giải' },
      SEASON_TABS.map((t) => el('a', {
        class: 'jump-link' + (t.key === tab ? ' active' : ''), href: `#season/${s.id}/${t.key}`,
        'aria-current': t.key === tab ? 'page' : null,
      }, t.label)));

    const body = tab === 'rounds' ? seasonRounds(s, st, route.arg)
      : tab === 'gyms' ? seasonGyms(s, st)
        : tab === 'battles' ? seasonBattles(s, st)
          : seasonRanking(s, st);
    return el('div', { class: 'season' }, head, kpis, tabs, body);
  }

  function roleLegend() {
    return el('div', { class: 'legend-row', 'aria-label': 'Chú thích role' },
      ROLE_SERIES.map((r) => el('span', { class: 'lg' }, el('i', { class: 'sw ' + r.cls }), r.label)));
  }

  function seasonRanking(s, st) {
    const rows = [...st.members.values()].filter((m) => m.battles).sort((a, b) => b.points - a.points);
    const max = rows.length ? rows[0].points : 1;
    const body = rows.map((m, i) => {
      const segs = ROLE_SERIES.filter((r) => m.byRole[r.cls]).map((r) => withTip(el('span', {
        class: 'seg ' + r.cls, tabindex: '0', style: `flex-grow:${m.byRole[r.cls]}`,
        'aria-label': `${m.name} – ${r.label}: ${fmtNum(m.byRole[r.cls])} điểm`,
      }), () => tipLines(`${m.name} · ${r.label}`,
        `${fmtNum(m.byRole[r.cls])} điểm (${Math.round((m.byRole[r.cls] / m.points) * 100)}% của member)`)));
      return el('tr', null,
        el('td', { class: 'num rank' }, i + 1),
        el('td', null, el('div', { class: 'who' }, el('strong', null, m.name),
          m.group ? el('span', { class: 'chip' }, m.group) : null),
        m.fb ? el('div', { class: 'muted small' }, m.fb) : null),
        el('td', { class: 'bar-cell' }, el('div', { class: 'stack', style: `width:${Math.max(2, (m.points / max) * 100)}%` }, segs)),
        el('td', { class: 'num strong' }, fmtNum(m.points)),
        el('td', { class: 'num' }, m.tickets),
        el('td', { class: 'num' }, fmtNum(m.tickets ? m.points / m.tickets : 0)),
        el('td', { class: 'num' }, m.battles),
        ROLE_SERIES.map((r) => el('td', { class: 'num muted' }, m.byRole[r.cls] ? fmtNum(m.byRole[r.cls]) : '–')),
      );
    });
    return el('div', { class: 'card' },
      el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, 'Xếp hạng điểm'), roleLegend()),
      el('div', { class: 'scroll' }, el('table', { class: 'matrix season-table' },
        el('thead', null, el('tr', null,
          el('th', { class: 'num' }, '#'), el('th', null, 'Member'), el('th', null, 'Điểm theo role'),
          el('th', { class: 'num' }, 'Tổng điểm'), el('th', { class: 'num' }, 'Vé'), el('th', { class: 'num' }, 'Điểm / vé'),
          el('th', { class: 'num' }, 'Trận'), ROLE_SERIES.map((r) => el('th', { class: 'num' }, r.label)))),
        el('tbody', null, body))));
  }

  function seasonRounds(s, st, arg) {
    const list = [...st.rounds.values()];
    const sel = st.rounds.get(Number(arg)) || list.filter((r) => r.list.length).pop() || list[0];
    const max = Math.max(1, ...list.map((r) => r.points));
    const go = (n) => { location.hash = `season/${s.id}/rounds/${n}`; };

    // Biểu đồ cột: điểm mỗi round (một chuỗi số liệu nên không cần chú thích)
    const ticks = [0, 0.5, 1].map((f) => el('div', { class: 'tick', style: `bottom:${f * 100}%` },
      el('span', null, fmtShort(max * f))));
    const cols = list.map((r) => {
      const on = r === sel;
      const bar = withTip(el('button', {
        type: 'button', class: 'col' + (on ? ' on' : ''), onclick: () => go(r.n),
        'aria-label': `Round ${r.n}: ${fmtNum(r.points)} điểm`, 'aria-pressed': String(on),
      }, el('span', { class: 'col-bar', style: `height:${(r.points / max) * 100}%` },
        on ? el('span', { class: 'col-val' }, fmtShort(r.points)) : null)),
      () => tipLines(`Round ${r.n} · Ngày ${r.day} (${fmtDay(r.date)})`,
        `${fmtNum(r.points)} điểm · ${r.tickets} vé · ${r.list.length} trận`,
        r.maxPoints ? `Tối đa ${fmtNum(r.maxPoints)} điểm / trận` : null));
      return el('div', { class: 'col-wrap' }, bar, el('span', { class: 'col-x' }, 'R' + r.n));
    });
    const days = [];
    for (const r of list) {
      const d = days[days.length - 1];
      if (d && d.day === r.day) d.count++;
      else days.push({ day: r.day, date: r.date, count: 1 });
    }
    const chart = el('div', { class: 'card chart-card' },
      el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, 'Điểm mỗi round'),
        el('span', { class: 'muted small' }, 'Bấm cột để xem chi tiết round')),
      el('div', { class: 'round-chart' },
        el('div', { class: 'plot' }, ticks, el('div', { class: 'cols' }, cols)),
        el('div', { class: 'days', style: `grid-template-columns:${days.map((d) => d.count + 'fr').join(' ')}` },
          days.map((d) => el('span', null, `Ngày ${d.day} · ${fmtDay(d.date)}`)))));

    // Chi tiết round đang chọn
    const topTickets = Object.values(sel.pattern).reduce((n, p) => n + (typeof p.topN === 'number' ? p.topN : 0), 0);
    const fact = (label, value) => el('div', { class: 'fact' }, el('span', null, label), el('strong', null, value));
    const sets = [...new Set(s.gyms.map((g) => g.set))];
    const gymCard = (g) => {
      const battles = sel.list.filter((b) => b.gym === g.key);
      const p = sel.pattern[g.key];
      const diff = sel.difficulty[g.key];
      const pts = battles.reduce((n, b) => n + b.points, 0);
      const tix = battles.reduce((n, b) => n + b.tickets, 0);
      return el('div', { class: 'gym-card card' },
        el('div', { class: 'gym-card-head' }, typeDot(fold(g.weakness)), el('strong', null, g.name),
          el('span', { class: 'muted small' }, g.weakness),
          diff ? el('span', { class: 'pill ' + (diff === 'Khó' ? 'bad' : 'warn') }, diff) : null),
        p ? el('div', { class: 'pattern' },
          el('span', { title: 'Chuỗi vé từng trận của guild mình' }, `${s.guild}: `, el('b', null, p.us || '?'),
            typeof p.usN === 'number' ? ` (${p.usN} vé)` : ''),
          el('span', { title: 'Chuỗi vé của gym top' }, 'Top gym: ', el('b', null, p.top || '?'),
            typeof p.topN === 'number' ? ` (${p.topN} vé)` : '')) : null,
        battles.length
          ? el('table', { class: 'result' },
            el('tbody', null, battles.map((b) => el('tr', { class: b.note ? 'has-note' : '' },
              el('td', null, b.member, b.note ? el('div', { class: 'note-line' }, b.note) : null),
              el('td', null, roleTagEl(b.role)),
              el('td', { class: 'num' }, `${b.tickets} vé`),
              el('td', { class: 'num strong' }, fmtNum(b.points))))),
            el('tfoot', null, el('tr', null, el('td', { colspan: 2 }, `${battles.length} trận`),
              el('td', { class: 'num' }, `${tix} vé`), el('td', { class: 'num strong' }, fmtNum(pts)))))
          : el('div', { class: 'empty' }, 'Không có trận nào.'),
      );
    };
    const detail = el('div', { class: 'card round-detail' },
      el('div', { class: 'section-head' },
        el('h2', { class: 'section-title' }, `Round ${sel.n} · Ngày ${sel.day} (${fmtDay(sel.date)})`),
        el('div', { class: 'round-steps' },
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: sel.n <= list[0].n, onclick: () => go(sel.n - 1), 'aria-label': 'Round trước' }, '‹'),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: sel.n >= list[list.length - 1].n, onclick: () => go(sel.n + 1), 'aria-label': 'Round sau' }, '›'))),
      el('div', { class: 'facts' },
        fact('Boss HP', fmtNum(sel.hp)),
        sel.maxPoints ? fact('Điểm tối đa / trận', fmtNum(sel.maxPoints)) : null,
        fact('Điểm đạt', fmtNum(sel.points)),
        fact('Vé guild dùng', `${sel.tickets}` + (topTickets ? ` · Top gym ${topTickets}` : '')),
        sel.ticketsIn ? fact('Vé nhận thêm', `+${sel.ticketsIn}`) : null),
      sets.map((n) => el('section', { class: 'set-block' },
        el('h3', null, `Set ${n}`, sel.params[n] ? el('span', { class: 'chip' }, sel.params[n]) : null),
        el('div', { class: 'gym-grid' }, s.gyms.filter((g) => g.set === n).map(gymCard)))));
    return el('div', { class: 'season-stack' }, chart, detail);
  }

  function seasonGyms(s, st) {
    const card = (g) => {
      const top = [...g.byMember.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      let us = 0, them = 0;
      for (const r of s.rounds) {
        const p = r.pattern[g.key];
        if (p && typeof p.usN === 'number') us += p.usN;
        if (p && typeof p.topN === 'number') them += p.topN;
      }
      const hard = s.rounds.filter((r) => r.difficulty[g.key]).map((r) => `R${r.n} ${r.difficulty[g.key].toLowerCase()}`);
      return el('div', { class: 'gym-card card' },
        el('div', { class: 'gym-card-head' }, typeDot(fold(g.weakness)), el('strong', null, g.name),
          el('span', { class: 'muted small' }, `Weak: ${g.weakness} · Set ${g.set}`)),
        el('div', { class: 'facts' },
          el('div', { class: 'fact' }, el('span', null, 'Điểm'), el('strong', null, fmtNum(g.points))),
          el('div', { class: 'fact' }, el('span', null, 'Vé · trận'), el('strong', null, `${g.tickets} · ${g.battles}`)),
          el('div', { class: 'fact' }, el('span', null, 'Điểm / vé'), el('strong', null, fmtNum(g.tickets ? g.points / g.tickets : 0)))),
        g.passives.length ? el('div', { class: 'gym-sec' }, el('span', { class: 'gym-label' }, 'Passive'),
          el('div', { class: 'chips' }, g.passives.map((p) => el('span', { class: 'chip' }, p)))) : null,
        g.notes.length ? el('div', { class: 'gym-sec' }, el('span', { class: 'gym-label' }, 'Ghi chú'),
          g.notes.map((n) => el('div', { class: 'small' }, n))) : null,
        us || them ? el('div', { class: 'gym-sec small' }, el('span', { class: 'gym-label' }, 'Tổng vé (theo bảng thống kê)'),
          `${s.guild}: `, el('b', null, us), ' · Top gym: ', el('b', null, them)) : null,
        hard.length ? el('div', { class: 'gym-sec small muted' }, el('span', { class: 'gym-label' }, 'Round khó'), hard.join(', ')) : null,
        top.length ? el('div', { class: 'gym-sec' }, el('span', { class: 'gym-label' }, 'Top member'),
          el('ol', { class: 'top-list' }, top.map(([name, pts]) => el('li', null, name, el('span', { class: 'muted' }, fmtNum(pts)))))) : null,
      );
    };
    const gyms = [...st.gyms.values()];
    return el('div', { class: 'gym-grid wide' }, gyms.map(card));
  }

  function seasonBattles(s, st) {
    const f = seasonFilter;
    const sel = (key, label, options) => el('select', { class: 'field', 'aria-label': label, onchange: (e) => { f[key] = e.target.value; fill(); } },
      el('option', { value: '' }, label), options.map(([v, t]) => el('option', { value: v, selected: f[key] === String(v) }, t)));
    const tbody = el('tbody');
    const total = el('span', { class: 'muted' });
    const fill = () => {
      const q = fold(f.q.trim());
      const rows = s.battles.filter((b) => (!f.round || b.round === Number(f.round)) && (!f.gym || b.gym === f.gym)
        && (!f.member || b.member === f.member) && (!f.role || roleSeries(b.role).cls === f.role)
        && (!q || fold(`${b.member} ${b.note} ${b.role}`).includes(q)));
      total.textContent = `${rows.length} trận · ${rows.reduce((n, b) => n + b.tickets, 0)} vé · `
        + `${fmtNum(rows.reduce((n, b) => n + b.points, 0))} điểm`;
      tbody.replaceChildren(...rows.map((b) => el('tr', { class: b.note ? 'has-note' : '' },
        el('td', { class: 'num muted' }, b.i),
        el('td', null, `Ngày ${b.day}`),
        el('td', null, el('a', { href: `#season/${s.id}/rounds/${b.round}` }, `R${b.round}`)),
        el('td', null, el('strong', null, b.member)),
        el('td', null, gymName(s, b.gym)),
        el('td', null, roleTagEl(b.role)),
        el('td', { class: 'num' }, b.tickets),
        el('td', { class: 'num strong' }, fmtNum(b.points)),
        el('td', { class: 'note-cell' }, b.note))));
      if (!rows.length) tbody.append(el('tr', null, el('td', { colspan: 9, class: 'empty' }, 'Không có trận nào khớp bộ lọc.')));
    };
    const members = [...st.members.values()].filter((m) => m.battles).map((m) => m.name).sort((a, b) => a.localeCompare(b));
    const toolbar = el('div', { class: 'toolbar' },
      searchBox({ placeholder: 'Tìm member / ghi chú…', value: f.q, style: 'width:220px', oninput: (e) => { f.q = e.target.value; fill(); } }),
      sel('round', 'Tất cả round', s.rounds.map((r) => [r.n, `Round ${r.n} (ngày ${r.day})`])),
      sel('gym', 'Tất cả gym', s.gyms.map((g) => [g.key, `${g.name} (${g.weakness})`])),
      sel('member', 'Tất cả member', members.map((m) => [m, m])),
      sel('role', 'Tất cả role', ROLE_SERIES.map((r) => [r.cls, r.label])),
      total);
    fill();
    return el('div', { class: 'card' },
      el('div', { class: 'section-head' }, toolbar),
      el('div', { class: 'scroll' }, el('table', { class: 'matrix season-table battles' },
        el('thead', null, el('tr', null, ['#', 'Ngày', 'Round', 'Member', 'Gym', 'Role', 'Vé', 'Điểm', 'Ghi chú']
          .map((t, i) => el('th', { class: [0, 6, 7].includes(i) ? 'num' : null }, t)))),
        tbody)));
  }

  // ---------------------------------------------------------------- Import / Export

  /** yyyy-mm-dd theo giờ máy (toISOString dùng UTC nên có thể lệch ngày). */
  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportData(kind) {
    const date = localDate();
    if (kind === 'rosters') {
      const { app, version, updated, members, groups, pairTags } = state;
      download(`gvg-rosters-${date}.json`, { app, version, updated, members, groups, pairTags });
    } else {
      download(`gvg-team-planner-${date}.json`, state);
    }
    toast('Đã export JSON', 'ok');
  }

  async function importFile(file) {
    let data;
    try {
      data = normalize(JSON.parse(await file.text()));
    } catch (err) {
      alert('Không đọc được file: ' + err.message);
      return;
    }
    if (data.bosses) {
      if (!confirm(`Import "${file.name}" sẽ thay TOÀN BỘ dữ liệu hiện tại (Rosters + Teams). Tiếp tục?`)) return;
      state = data;
      reindex();
      toast('Đã import toàn bộ dữ liệu');
    } else {
      if (!confirm(`File "${file.name}" chỉ chứa Rosters. Thay Rosters hiện tại và giữ nguyên các team?`)) return;
      const oldGroups = state.groups;
      state.members = data.members;
      state.groups = data.groups;
      state.updated = data.updated || state.updated;
      state.pairTags = { ...state.pairTags, ...data.pairTags };
      reindex();
      const lost = relinkSlots(oldGroups);
      toast(lost ? `Đã import Rosters – ${lost} slot team không tìm thấy pair (Chưa map)` : 'Đã import Rosters');
    }
    save();
    render();
  }

  // ---------------------------------------------------------------- Per-member roster files

  const MEMBER_KIND = 'member-roster';

  function slug(s) {
    return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member';
  }

  function memberFile(m) {
    const pairs = [];
    for (const g of state.groups) {
      for (const p of g.pairs) {
        const v = p.levels[m.id];
        pairs.push({ id: p.id, name: p.name, type: g.type, level: typeof v === 'number' ? v : null });
      }
    }
    return {
      app: 'gvg-team-planner', kind: MEMBER_KIND, version: 1, exportedAt: new Date().toISOString(),
      member: { name: m.name, tag: m.tag }, pairs,
    };
  }

  function exportMember(m) {
    const date = localDate();
    download(`gvg-roster-${slug(m.name)}-${date}.json`, memberFile(m));
  }

  function openDialog(...children) {
    const dlg = $('#appDialog') || $('#iconDialog');
    dlg.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
    dlg.showModal();
    return dlg;
  }

  function dialogHead(title, dlg) {
    return el('div', { class: 'dlg-head' },
      el('strong', { style: 'font-size:16px' }, title),
      el('button', { class: 'icon-btn plain', title: 'Đóng', 'aria-label': 'Đóng', onclick: () => dlg().close() }, ic('x')));
  }

  /** Choose members, download one JSON file per member. */
  function openMemberExport() {
    const checks = state.members.map((m) => ({
      m, box: el('input', { type: 'checkbox', checked: true }),
      owned: state.groups.reduce((n, g) => n + g.pairs.filter((p) => typeof p.levels[m.id] === 'number').length, 0),
    }));
    const getDlg = () => $('#appDialog') || $('#iconDialog');
    const setAll = (v) => { for (const c of checks) c.box.checked = v; };
    openDialog(
      dialogHead('Export roster từng member', getDlg),
      el('p', { class: 'hint' }, 'Mỗi member được tải về 1 file JSON riêng, chỉ chứa move level của người đó. ' +
        'Gửi file cho từng người tự cập nhật, rồi dùng "Import member" để nạp lại.'),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => setAll(true) }, 'Chọn tất cả'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => setAll(false) }, 'Bỏ chọn')),
      el('div', { class: 'member-pick' }, checks.map((c) => el('label', { class: 'member-opt' },
        c.box, el('span', { class: 'label' }, c.m.name),
        c.m.tag ? el('span', { class: 'chip' }, c.m.tag) : null,
        el('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' }, `${c.owned} pair`)))),
      el('div', { class: 'dlg-foot' },
        el('button', { class: 'btn', onclick: () => getDlg().close() }, 'Hủy'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            const picked = checks.filter((c) => c.box.checked).map((c) => c.m);
            if (!picked.length) { toast('Chưa chọn member nào', 'error'); return; }
            // Tải lần lượt để trình duyệt không chặn nhiều file cùng lúc
            picked.forEach((m, i) => setTimeout(() => exportMember(m), i * 250));
            getDlg().close();
            toast(`Đang tải ${picked.length} file roster`, 'ok');
          },
        }, ic('download'), 'Export'),
      ),
    );
  }

  function isMemberFile(obj) {
    return obj && obj.kind === MEMBER_KIND && obj.member && Array.isArray(obj.pairs);
  }

  /** Find the roster pair for an exported row: same id+name, then same name, then same icon. */
  function resolvePair(row, byName, byIcon) {
    const p = row.id && idx.pair.get(row.id);
    if (p && fold(p.name) === fold(row.name)) return p;
    const n = byName.get(fold(row.name));
    if (n) return n;
    const e = autoIcon(row.name);
    return e ? byIcon.get(e.id) || null : null;
  }

  /** Pair trong Rosters theo tên (fold) và theo icon – để khớp pair từ file của máy khác. */
  function rosterLookup() {
    const byName = new Map();
    const byIcon = new Map();
    for (const g of state.groups) {
      for (const p of g.pairs) {
        if (!byName.has(fold(p.name))) byName.set(fold(p.name), p);
        const e = iconFor(p);
        if (e && !byIcon.has(e.id)) byIcon.set(e.id, p);
      }
    }
    return { byName, byIcon };
  }

  function planMemberImport(file, data) {
    const { byName, byIcon } = rosterLookup();
    const name = str(data.member.name).trim();
    const member = state.members.find((m) => fold(m.name).trim() === fold(name));
    const changes = [];
    const unknown = [];
    for (const row of data.pairs) {
      const lv = cleanLevel(row.level);
      const p = resolvePair(row, byName, byIcon);
      if (!p) {
        if (lv != null) unknown.push({ name: str(row.name), type: str(row.type), level: lv });
        continue;
      }
      const old = member && typeof p.levels[member.id] === 'number' ? p.levels[member.id] : null;
      if (old !== lv) changes.push({ p, old, lv });
    }
    return { file, name, tag: str(data.member.tag), member, changes, unknown, apply: true };
  }

  function addUnknownPair(u) {
    const e = autoIcon(u.name);
    const tname = (e && typeName(e)) || u.type || 'Khác';
    let g = state.groups.find((x) => fold(x.type) === fold(tname));
    if (!g) {
      g = { id: uid('g'), type: tname, pairs: [] };
      state.groups.push(g);
    }
    const p = { id: uid('p'), name: u.name, note: '', levels: {} };
    g.pairs.push(p);
    idx.pair.set(p.id, p);
    return p;
  }

  function applyMemberPlans(plans, addUnknown) {
    let members = 0, cells = 0, added = 0;
    for (const plan of plans) {
      if (!plan.apply) continue;
      let m = plan.member || state.members.find((x) => fold(x.name).trim() === fold(plan.name));
      if (!m) {
        m = { id: uid('m'), name: plan.name, tag: plan.tag };
        state.members.push(m);
      } else if (plan.tag && !m.tag) {
        m.tag = plan.tag;
      }
      for (const c of plan.changes) { c.p.levels[m.id] = c.lv; cells++; }
      if (addUnknown) {
        for (const u of plan.unknown) { addUnknownPair(u).levels[m.id] = u.level; added++; cells++; }
      }
      members++;
    }
    save();
    render();
    toast(`Đã import ${members} member · ${cells} ô thay đổi` + (added ? ` · thêm ${added} pair mới` : ''), 'ok');
  }

  function levelText(v) {
    return v == null ? 'Không có' : String(v);
  }

  function openMemberImportPreview(plans, errors) {
    const getDlg = () => $('#appDialog') || $('#iconDialog');
    const addBox = el('input', { type: 'checkbox' });
    const anyUnknown = plans.some((p) => p.unknown.length);
    const cards = plans.map((plan) => {
      const box = el('input', { type: 'checkbox', checked: true, onchange: (e) => { plan.apply = e.target.checked; } });
      const up = plan.changes.filter((c) => c.old != null && c.lv != null).length;
      const add = plan.changes.filter((c) => c.old == null).length;
      const del = plan.changes.filter((c) => c.lv == null).length;
      return el('div', { class: 'card import-card' },
        el('label', { class: 'import-head' }, box,
          el('strong', null, plan.name || '(không tên)'),
          plan.member ? null : el('span', { class: 'pill ok' }, 'member mới'),
          el('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' }, plan.file.name)),
        el('div', { class: 'import-stats' },
          el('span', { class: 'chip' }, `${plan.changes.length} thay đổi`),
          add ? el('span', { class: 'chip ok' }, `+${add} có thêm`) : null,
          up ? el('span', { class: 'chip' }, `${up} đổi level`) : null,
          del ? el('span', { class: 'chip zero' }, `${del} → Không có`) : null,
          plan.unknown.length ? el('span', { class: 'chip zero' }, `${plan.unknown.length} pair không tìm thấy`) : null),
        plan.changes.length || plan.unknown.length
          ? el('details', { class: 'others' },
            el('summary', null, 'Xem chi tiết'),
            el('table', { class: 'result' }, el('tbody', null,
              plan.changes.map((c) => el('tr', null,
                el('td', null, c.p.name),
                el('td', { class: 'n muted' }, levelText(c.old)),
                el('td', { class: 'n', style: 'width:24px' }, '→'),
                el('td', { class: 'n ' + (c.lv == null ? 'bad' : 'ok') }, levelText(c.lv)))),
              plan.unknown.map((u) => el('tr', null,
                el('td', null, u.name, el('span', { class: 'chip zero', style: 'margin-left:6px' }, 'không có trong Rosters')),
                el('td', { class: 'n muted' }, '–'),
                el('td', { class: 'n' }, '→'),
                el('td', { class: 'n' }, u.level))),
            )))
          : el('div', { class: 'empty' }, 'Không có gì thay đổi.'),
      );
    });
    openDialog(
      dialogHead(`Import roster member (${plans.length} file)`, getDlg),
      errors.length ? el('div', { class: 'import-errors' }, errors.map((e) => el('div', null, '⚠ ', e))) : null,
      el('div', { class: 'import-list' }, cards),
      el('div', { class: 'dlg-foot' },
        anyUnknown ? el('label', { class: 'muted', style: 'margin-right:auto;display:flex;gap:6px;align-items:center;font-size:13px' },
          addBox, 'Thêm các pair không tìm thấy vào Rosters') : null,
        el('button', { class: 'btn', onclick: () => getDlg().close() }, 'Hủy'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { getDlg().close(); applyMemberPlans(plans, addBox.checked); },
        }, 'Áp dụng'),
      ),
    );
  }

  /** Entry point for any picked JSON files: member files get a preview, others use importFile. */
  async function handleFiles(files) {
    const plans = [];
    const errors = [];
    const others = [];
    const offFiles = [];
    for (const f of files) {
      let obj;
      try {
        obj = JSON.parse(await f.text());
      } catch (err) {
        errors.push(`${f.name}: không phải JSON hợp lệ`);
        continue;
      }
      if (isMemberFile(obj)) plans.push(planMemberImport(f, obj));
      else if (isOffFile(obj)) offFiles.push({ file: f, data: obj });
      else others.push(f);
    }
    if (plans.length) {
      for (const f of [...others, ...offFiles.map((x) => x.file)]) errors.push(`${f.name}: không phải file roster member – bỏ qua`);
      openMemberImportPreview(plans, errors);
    } else if (offFiles.length) {
      for (const f of others) errors.push(`${f.name}: không phải file team OFF-TYPE – bỏ qua`);
      openOffImportPreview(planOffImport(offFiles), errors);
    } else if (others.length) {
      if (others.length > 1) toast('Chỉ import được 1 file dữ liệu toàn bộ / Rosters mỗi lần', 'error');
      await importFile(others[0]);
    } else if (errors.length) {
      alert(errors.join('\n'));
    }
  }

  // ---------------------------------------------------------------- Team OFF-TYPE files

  const OFF_KIND = 'off-teams';

  function isOffFile(obj) {
    return obj && obj.kind === OFF_KIND && Array.isArray(obj.teams);
  }

  /** Mỗi slot ghi kèm tên pair + icon để máy khác (id pair khác) vẫn khớp lại được. */
  function exportOffTeams() {
    if (!state.offTeams.length) { toast('Chưa có team OFF-TYPE nào để export', 'error'); return; }
    const teams = state.offTeams.map((t) => ({
      ...clone(t),
      slots: t.slots.map((s) => {
        const p = s.pair && idx.pair.get(s.pair);
        const e = p && iconFor(p);
        return { pair: p ? p.id : null, pairName: p ? p.name : s.pairName, icon: e ? e.id : '', req: s.req, note: s.note };
      }),
    }));
    download(`gvg-offtype-${localDate()}.json`,
      { app: 'gvg-team-planner', kind: OFF_KIND, version: 1, exportedAt: new Date().toISOString(), teams });
    toast(`Đã export ${teams.length} team OFF-TYPE`, 'ok');
  }

  /** Slot trong file -> pair của Rosters máy này: cùng id + tên, rồi theo tên, rồi theo icon. Không thấy thì "Chưa map". */
  function resolveOffSlot(raw, look) {
    const s = normSlot(raw);
    const name = str(raw.pairName);
    let p = raw.pair ? idx.pair.get(str(raw.pair)) : null;
    if (p && name && fold(p.name) !== fold(name)) p = null;
    if (!p && name) p = look.byName.get(fold(name)) || null;
    if (!p && raw.icon) p = look.byIcon.get(str(raw.icon)) || null;
    if (!p && name) {
      const e = autoIcon(name);
      p = (e && look.byIcon.get(e.id)) || null;
    }
    return p ? { ...s, pair: p.id, pairName: '' } : { ...s, pair: null, pairName: name };
  }

  function planOffImport(files) {
    const look = rosterLookup();
    const byId = new Map();
    for (const { data } of files) {
      for (const raw of data.teams) {
        const t = normOffTeam(raw);
        t.slots = [0, 1, 2].map((k) => resolveOffSlot((raw.slots || [])[k] || {}, look));
        byId.set(t.id, t);
      }
    }
    const teams = [...byId.values()];
    const have = new Set(state.offTeams.map((t) => t.id));
    return {
      files: files.map((x) => x.file.name), teams,
      isNew: (t) => !have.has(t.id),
      unmapped: teams.reduce((n, t) => n + t.slots.filter((s) => !s.pair && s.pairName).length, 0),
    };
  }

  /** merge: thêm team mới, team trùng id lấy theo file và gộp record theo id. replace: thay hết team hiện tại. */
  function applyOffImport(plan, mode) {
    if (mode === 'replace') {
      state.offTeams = plan.teams;
    } else {
      for (const t of plan.teams) {
        const cur = state.offTeams.find((x) => x.id === t.id);
        if (!cur) { state.offTeams.push(t); continue; }
        const fileIds = new Set(t.records.map((r) => r.id));
        Object.assign(cur, t, { records: [...t.records, ...cur.records.filter((r) => !fileIds.has(r.id))] });
      }
    }
    save();
    if (location.hash === '#offtype') render();
    else location.hash = 'offtype';
    toast(`Đã import ${plan.teams.length} team OFF-TYPE` + (plan.unmapped ? ` – ${plan.unmapped} slot chưa map` : ''), 'ok');
  }

  function openOffImportPreview(plan, errors) {
    const getDlg = () => $('#appDialog');
    const nNew = plan.teams.filter(plan.isNew).length;
    const nUpd = plan.teams.length - nNew;
    const nRec = plan.teams.reduce((n, t) => n + t.records.length, 0);
    const done = (mode) => { getDlg().close(); applyOffImport(plan, mode); };
    const rows = plan.teams.map((t) => {
      const miss = t.slots.filter((s) => !s.pair && s.pairName);
      return el('tr', null,
        el('td', null, el('strong', null, offName(t)),
          miss.length ? el('div', { class: 'warn small' }, 'Chưa map: ', miss.map((s) => s.pairName).join(', ')) : null),
        el('td', null, catChip(offCategory(t), !t.category)),
        el('td', { class: 'n' }, offReqText(t)),
        el('td', { class: 'n' }, `${t.records.length} record`),
        el('td', { class: 'n' }, el('span', { class: 'pill ' + (plan.isNew(t) ? 'ok' : 'neutral') }, plan.isNew(t) ? 'mới' : 'cập nhật')));
    });
    openDialog(
      dialogHead(`Import team OFF-TYPE (${plan.files.length} file)`, getDlg),
      errors.length ? el('div', { class: 'import-errors' }, errors.map((e) => el('div', null, '⚠ ', e))) : null,
      el('div', { class: 'import-stats' },
        el('span', { class: 'chip' }, `${plan.teams.length} team · ${nRec} record`),
        nNew ? el('span', { class: 'chip ok' }, `${nNew} team mới`) : null,
        nUpd ? el('span', { class: 'chip' }, `${nUpd} team đã có (cập nhật, gộp record)`) : null,
        plan.unmapped ? el('span', { class: 'chip zero', title: 'Pair không có trong Rosters máy này – slot sẽ hiện "Chưa map"' },
          `${plan.unmapped} slot không tìm thấy pair`) : null),
      el('div', { class: 'import-list' }, el('table', { class: 'result' }, el('tbody', null, rows))),
      el('div', { class: 'dlg-foot' },
        el('button', { class: 'btn', style: 'margin-right:auto', onclick: () => getDlg().close() }, 'Hủy'),
        state.offTeams.length ? el('button', {
          class: 'btn btn-ghost btn-danger', title: 'Xóa toàn bộ team OFF-TYPE hiện có rồi nạp team trong file',
          onclick: () => {
            if (confirm(`Thay ${state.offTeams.length} team OFF-TYPE hiện có bằng ${plan.teams.length} team trong file?`)) done('replace');
          },
        }, `Thay toàn bộ (${state.offTeams.length} team hiện có)`) : null,
        el('button', { class: 'btn btn-primary', onclick: () => done('merge') }, ic('upload'), state.offTeams.length ? 'Gộp vào' : 'Import'),
      ),
    );
  }

  // ---------------------------------------------------------------- wiring

  const exportMenu = $('#exportMenu');
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
  exportMenu.addEventListener('click', (e) => {
    const kind = e.target.dataset.export;
    if (!kind) return;
    exportMenu.classList.remove('open');
    if (kind === 'members') openMemberExport();
    else if (kind === 'offtype') exportOffTeams();
    else exportData(kind);
  });
  document.addEventListener('click', () => exportMenu.classList.remove('open'));

  const fileInput = $('#fileInput');
  $('#btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) handleFiles(files);
  });

  const iconsBtn = $('#btnIcons');
  if (iconsBtn) iconsBtn.addEventListener('click', () => updateCatalog(iconsBtn));
  updateCatalogButton();

  setTheme(getTheme());
  for (const b of document.querySelectorAll('[data-theme-mode]')) {
    b.addEventListener('click', () => setTheme(b.dataset.themeMode));
  }

  const menuBtn = $('#btnMenu');
  if (menuBtn) menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  const scrim = $('#scrim');
  if (scrim) scrim.addEventListener('click', closeNav);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
      const box = document.querySelector('#view [data-search]');
      if (box) { e.preventDefault(); box.focus(); box.select(); }
    } else if ((e.key === '[' || e.key === ']') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const step = document.querySelectorAll('#bossNav .boss-nav-step')[e.key === '[' ? 0 : 1];
      if (step && step.href) location.hash = step.getAttribute('href');
    } else if (e.key === 'Escape') {
      closeNav();
    }
  });

  let navFrame = 0;
  const queueNavSync = () => {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => { navFrame = 0; syncBossNav(); });
  };
  window.addEventListener('scroll', queueNavSync, { passive: true });
  window.addEventListener('resize', () => { queueNavSync(); fitRosterGrid(); });

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  $('#saveStatus').textContent = 'Tự lưu trên trình duyệt này';
  render();
  if (seedStatus === 'auto') toast('Đã nạp dữ liệu chuẩn mới' + (state.updated ? ` (cập nhật ${state.updated})` : ''), 'ok');
  if (seedStatus === 'notice') showSeedNotice();
})();
