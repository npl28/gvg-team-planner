/* Khớp tên pair trong Rosters (vd "Anni Juliana & Terapagos (Strike)")
 * với catalog icon của pomatools (vd trainer "Juliana (Anniversary 2026)", pokemon "Terapagos"). */
(function (root) {
  'use strict';

  const ROLE_NAMES = { 0: 'Strike', 1: 'Strike', 2: 'Support', 3: 'Tech', 4: 'Sprint', 5: 'Field', 6: 'Multi' };
  const TYPE_NAMES = ['', 'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
    'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  const VARIETY = 5;

  // Viết tắt đứng trước tên trainer -> từ khóa phải có trong tên đầy đủ
  const PREFIX = {
    anni: ['anniversary'], c: ['champion'], sc: ['special costume'], sc2: ['special costume 2'],
    ss: ['sygna suit'], ssa: ['sygna suit', 'alt'], ssr: ['sygna suit', 'renegade'], arc: ['arc suit'],
    var: ['@variety'], pal: ['palentine'], fall: ['fall'], summer: ['summer'], spring: ['spring'],
    holiday: ['holiday'], h: ['holiday'], a: ['academy'], ny: ['new year'], af: ['arc suit'],
  };
  const SUFFIX = { alt: ['alt'], anni: ['anniversary'], sc: ['special costume'], c: ['champion'] };
  // Từ chỉ dạng/vùng của pokémon, bỏ qua khi so tên
  const FORM_WORDS = new Set(['hisui', 'hisuian', 'alola', 'alolan', 'galar', 'galarian', 'paldea', 'paldean',
    'white', 'black', 'mega', 'origin', 'teal', 'mask', 'therian']);
  const QUALIFIERS = ['sygna suit', 'arc suit', 'anniversary', 'champion', 'special costume', 'alt', 'academy',
    'palentine', 'summer', 'fall', 'spring', 'holiday', 'new year', 'classic', 'renegade', 'aura', 'thunderbolt'];

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function ratio(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  /** "SSA Elesa & Thunderus (Field)" -> { base: 'elesa', keys: [...], pokemon: 'thunderus', role: 'Field' } */
  function parseName(name) {
    let s = String(name || '').trim();
    let role = '';
    const rm = /\(([^()]*)\)\s*$/.exec(s);
    if (rm && Object.values(ROLE_NAMES).some((r) => fold(r) === fold(rm[1]))) {
      role = rm[1].trim();
      s = s.slice(0, rm.index).trim();
    }
    const amp = s.indexOf('&');
    let trainer = amp >= 0 ? s.slice(0, amp) : s;
    const pokemon = amp >= 0 ? s.slice(amp + 1) : '';

    const keys = [];
    // Ngoặc trong tên trainer: "(Anni 25)" -> anniversary 2025, "(Alt.)" -> alt
    trainer = trainer.replace(/\(([^()]*)\)/g, (_, inner) => {
      for (const w of fold(inner).split(' ')) {
        if (/^\d{2}$/.test(w)) keys.push('20' + w);
        else if (PREFIX[w]) keys.push(...PREFIX[w]);
        else if (w) keys.push(w);
      }
      return ' ';
    });
    const words = fold(trainer.replace(/\b([A-Za-z])\.(?=\S)/g, '$1 ')).split(' ').filter(Boolean);
    while (words.length > 1 && PREFIX[words[0]]) keys.push(...PREFIX[words.shift()]);
    while (words.length > 1) {
      const last = words[words.length - 1];
      if (SUFFIX[last]) { keys.push(...SUFFIX[last]); words.pop(); }
      else if (/^(19|20)\d\d$/.test(last)) { keys.push(last); words.pop(); }
      else break;
    }
    const pk = fold(pokemon.replace(/\([^()]*\)/g, ' ')).split(' ').filter((w) => w && !FORM_WORDS.has(w)).join(' ');
    return { base: words.join(' '), keys, pokemon: pk, role };
  }

  function entryParts(e) {
    const full = fold(e.tr);
    const base = fold(e.tr.replace(/\([^()]*\)/g, ' ').replace(/^(Sygna Suit|Arc Suit)\s+/i, ''));
    return { full, base, pk: fold(e.pk) };
  }

  function score(q, e) {
    const p = e._p || (e._p = entryParts(e));
    const pkSim = q.pokemon ? ratio(q.pokemon, p.pk) : 0;
    const trSim = ratio(q.base, p.base);
    if (pkSim < 0.75 || trSim < 0.8) return -1;
    let s = pkSim * 10 + trSim * 10;
    for (const k of q.keys) {
      if (k === '@variety') s += e.ex === VARIETY ? 4 : -2;
      else if (p.full.includes(k)) s += 4;
      else s -= 2;
    }
    for (const qual of QUALIFIERS) {
      if (p.full.includes(qual) && !q.keys.some((k) => k.includes(qual) || qual.includes(k))) s -= 3;
    }
    if (q.role && ROLE_NAMES[e.role] && fold(ROLE_NAMES[e.role]) === fold(q.role)) s += 2;
    return s;
  }

  /** Trả về entry tốt nhất trong catalog cho tên pair, hoặc null. */
  function matchPair(name, catalog) {
    const q = parseName(name);
    if (!q.base || !q.pokemon) return null;
    let best = null, bestScore = 17;
    for (const e of catalog) {
      const s = score(q, e);
      if (s > bestScore) { best = e; bestScore = s; }
    }
    return best;
  }

  function displayName(e) {
    return `${e.tr} & ${e.pk} (${ROLE_NAMES[e.role] || '?'})`;
  }

  const api = { matchPair, parseName, displayName, fold, ROLE_NAMES, TYPE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GvgIconMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
