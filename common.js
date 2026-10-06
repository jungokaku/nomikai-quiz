/* 共通処理：データ保存（Firebase / デモモード）・採点・画像・PIN */
(function () {
  const C = window.APP_CONFIG || {};
  const ROOM = C.ROOM_ID || 'nomikai';
  const ROOT = 'rooms/' + ROOM;
  const useFirebase = !!(C.firebase && C.firebase.apiKey && C.firebase.databaseURL && window.firebase);
  const full = p => (p ? ROOT + '/' + p : ROOT);
  const split = p => full(p).split('/').filter(Boolean);
  const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

  let Store;

  if (useFirebase) {
    // ===== 本番：Firebase Realtime Database =====
    firebase.initializeApp(C.firebase);
    const db = firebase.database();
    let offset = 0;
    db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    Store = {
      mode: 'firebase',
      listen(path, cb) {
        const r = db.ref(full(path));
        const h = r.on('value', s => cb(s.val()));
        return () => r.off('value', h);
      },
      get: path => db.ref(full(path)).once('value').then(s => s.val()),
      set: (path, v) => db.ref(full(path)).set(v === undefined ? null : v),
      update: (path, obj) => db.ref(full(path)).update(obj),
      remove: path => db.ref(full(path)).remove(),
      now: () => Date.now() + offset,
      onConnection(cb) { db.ref('.info/connected').on('value', s => cb(!!s.val())); }
    };
  } else {
    // ===== デモ：同じブラウザ内の localStorage でタブ間同期 =====
    const KEY = 'quizdemo_' + ROOM;
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    let tree = load();
    const listeners = [];
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify(tree)); }
      catch (e) { alert('デモモードの保存容量を超えました。画像を減らすか Firebase を設定してください。'); }
    };
    const getAt = parts => {
      let o = tree;
      for (const k of parts) { if (o == null || typeof o !== 'object') return null; o = o[k]; }
      return o === undefined ? null : o;
    };
    const setAt = (parts, v) => {
      let o = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (v === null || v === undefined) delete o[last]; else o[last] = v;
    };
    const notify = () => listeners.forEach(l => l.cb(clone(getAt(l.parts))));
    window.addEventListener('storage', e => { if (e.key === KEY) { tree = load(); notify(); } });
    Store = {
      mode: 'demo',
      listen(path, cb) {
        const l = { parts: split(path), cb };
        listeners.push(l);
        setTimeout(() => cb(clone(getAt(l.parts))), 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      get: path => Promise.resolve(clone(getAt(split(path)))),
      set(path, v) { setAt(split(path), clone(v)); save(); notify(); return Promise.resolve(); },
      update(path, obj) {
        const base = split(path);
        Object.keys(obj).forEach(k => setAt(base.concat(k.split('/').filter(Boolean)), clone(obj[k])));
        save(); notify(); return Promise.resolve();
      },
      remove(path) { setAt(split(path), null); save(); notify(); return Promise.resolve(); },
      now: () => Date.now(),
      onConnection(cb) { cb(true); }
    };
  }

  // ===== 定数・小物 =====
  const CIRCLED = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
  const LETTERS = 'ABCDEFGHIJ'.split('');
  const TYPES = {
    choice: { name: '選択（1位当て・2択など）', short: '選択' },
    order:  { name: '並び替え（A〜に①〜を割り当て）', short: '並び替え' },
    match:  { name: '写真マッチング（A〜と写真①〜）', short: '写真マッチ' },
    group:  { name: 'グループ分け', short: 'グループ分け' }
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmt = n => String(Math.round((n || 0) * 100) / 100);
  const toArr = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]) : []);

  function sortedQuestions(qs) {
    return Object.values(qs || {}).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  function slotLabel(q, k) {
    if (q.type === 'group') return (toArr(q.slots)[k] || {}).text || ('G' + (k + 1));
    return CIRCLED[k] || String(k + 1);
  }

  // 採点：選択は正解で1点。それ以外は「合っている項目数 ÷ 項目数」の部分点
  function scoreAnswer(q, key, value) {
    if (value == null || key == null) return 0;
    if (q.type === 'choice') return Number(value) === Number(key) ? 1 : 0;
    const k = toArr(key), v = toArr(value), n = toArr(q.items).length;
    if (!n) return 0;
    let ok = 0;
    for (let i = 0; i < n; i++) if (v[i] != null && Number(v[i]) === Number(k[i])) ok++;
    return ok / n;
  }

  function buildRanking(players, scores) {
    const arr = Object.entries(players || {}).map(([pid, p]) => ({
      pid, name: (p && p.name) || '?', score: (scores && scores[pid]) || 0
    }));
    arr.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name, 'ja'));
    let rank = 0, prev = null;
    arr.forEach((r, i) => {
      const s = Math.round(r.score * 1000);
      if (prev === null || s !== prev) { rank = i + 1; prev = s; }
      r.rank = rank;
    });
    return arr;
  }

  // ===== 画像 =====
  function compressImage(file) {
    const maxSize = Store.mode === 'demo' ? 600 : 1000;
    const quality = Store.mode === 'demo' ? 0.6 : 0.75;
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.round(img.width * s), h = Math.round(img.height * s);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          res(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = rej;
        img.src = fr.result;
      };
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }
  const imgCache = {};
  function getImage(id) {
    if (!id) return Promise.resolve('');
    if (!imgCache[id]) imgCache[id] = Store.get('images/' + id).then(v => v || '');
    return imgCache[id];
  }
  // <img data-img="画像ID"> に画像を流し込む
  function hydrateImages(root) {
    (root || document).querySelectorAll('img[data-img]').forEach(el => {
      const id = el.getAttribute('data-img');
      if (!id) { el.remove(); return; }
      getImage(id).then(src => { if (src) el.src = src; });
    });
  }

  // ===== 端末ごとのID保存（デモはタブごと、本番は端末ごと） =====
  const idStore = () => (Store.mode === 'demo' ? window.sessionStorage : window.localStorage);
  const lsGet = k => { try { return idStore().getItem('quiz_' + ROOM + '_' + k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { idStore().setItem('quiz_' + ROOM + '_' + k, v); } catch (e) {} };

  // ===== PIN =====
  function pinGate(onOk) {
    let ok = false;
    try { ok = sessionStorage.getItem('quiz_pin_' + ROOM) === String(C.ADMIN_PIN); } catch (e) {}
    if (ok) return onOk();
    const wrap = document.createElement('div');
    wrap.className = 'pin-gate';
    wrap.innerHTML = '<div class="pin-box"><h2>PINを入力</h2>' +
      '<input type="password" inputmode="numeric" id="pinInput" autocomplete="off">' +
      '<button class="primary" id="pinBtn">開く</button><p class="err" id="pinErr"></p></div>';
    document.body.appendChild(wrap);
    const go = () => {
      if (document.getElementById('pinInput').value === String(C.ADMIN_PIN)) {
        try { sessionStorage.setItem('quiz_pin_' + ROOM, String(C.ADMIN_PIN)); } catch (e) {}
        wrap.remove(); onOk();
      } else document.getElementById('pinErr').textContent = 'PINが違います';
    };
    document.getElementById('pinBtn').onclick = go;
    document.getElementById('pinInput').onkeydown = e => { if (e.key === 'Enter') go(); };
    document.getElementById('pinInput').focus();
  }

  function demoBanner() {
    if (Store.mode !== 'demo') return;
    const d = document.createElement('div');
    d.className = 'demo-banner';
    d.textContent = 'デモモード：同じブラウザのタブ同士だけで動きます（config.js に Firebase を設定すると本番動作）';
    document.body.prepend(d);
  }

  window.Q = {
    C, Store, CIRCLED, LETTERS, TYPES, uid, esc, fmt, toArr, sortedQuestions, slotLabel,
    scoreAnswer, buildRanking, compressImage, getImage, hydrateImages, lsGet, lsSet, pinGate, demoBanner
  };
})();
