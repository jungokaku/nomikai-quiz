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
    pair:   { name: '言葉マッチング（A〜と言葉①〜）', short: '言葉マッチ' },
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
    if (q.type === 'pair') { const t = (toArr(q.slots)[k] || {}).text; return (CIRCLED[k] || String(k + 1)) + (t ? ' ' + t : ''); }
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
  let imgBase = 'images/';
  function setImageBase(b) { imgBase = b; }
  function getImage(id) {
    if (!id) return Promise.resolve('');
    const k = imgBase + id;
    if (!imgCache[k]) imgCache[k] = Store.get(k).then(v => v || '');
    return imgCache[k];
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

  // ===== 開催ごとの保存先（events/開催ID/…） =====
  function scope(prefix) {
    const p = path => (path ? prefix + '/' + path : prefix);
    return {
      mode: Store.mode, now: Store.now,
      listen: (path, cb) => Store.listen(p(path), cb),
      get: path => Store.get(p(path)),
      set: (path, v) => Store.set(p(path), v),
      update: (path, obj) => Store.update(p(path), obj),
      remove: path => Store.remove(p(path))
    };
  }

  // パスワードはそのまま保存せず、変換（ハッシュ）して保存
  async function hashPass(pass) {
    const str = ROOM + ':' + String(pass);
    try {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      let h = 5381; for (const ch of str) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
      return 'd' + h.toString(16);
    }
  }
  const ssGet = k => { try { return sessionStorage.getItem('quiz_' + ROOM + '_' + k); } catch (e) { return null; } };
  const ssSet = (k, v) => { try { if (v == null) sessionStorage.removeItem('quiz_' + ROOM + '_' + k); else sessionStorage.setItem('quiz_' + ROOM + '_' + k, v); } catch (e) {} };
  function leaveEvent() { ssSet('ev', null); ssSet('evh', null); location.reload(); }

  // 名簿の名前一覧（名簿＋実際に参加した人の名前、重複なし）
  function rosterNames(ev) {
    const names = [];
    Object.values((ev && ev.roster) || {}).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(r => names.push(r.name));
    Object.values((ev && ev.players) || {}).forEach(p => names.push(p.name));
    return [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))];
  }
  function rosterFromNames(names, start) {
    const r = {};
    names.forEach((n, i) => { r['r' + uid()] = { name: n, order: (start || 0) + i }; });
    return r;
  }

  // 以前の版（開催なし）のデータを「これまでの問題」という開催に移す
  async function migrateLegacy() {
    const old = await Store.get('');
    if (!old || !old.questions || old.catalog) return false;
    const eid = 'e' + uid();
    const ev = { questions: old.questions, keys: old.keys || {}, images: old.images || {},
      roster: rosterFromNames(rosterNames({ players: old.players })) };
    const upd = {
      ['events/' + eid]: ev,
      ['catalog/' + eid]: { title: 'これまでの問題', passHash: await hashPass(C.ADMIN_PIN), createdAt: Store.now(),
        qCount: Object.keys(old.questions).length, rosterCount: Object.keys(ev.roster).length },
      questions: null, keys: null, images: null, players: null, answers: null, results: null, scores: null, state: null
    };
    await Store.update('', upd);
    return true;
  }

  // 開催を選ぶ画面（問題作成・進行画面の入口）
  function eventGate(onOpen, role) {
    const wrap = document.createElement('div');
    wrap.className = 'gate';
    document.body.appendChild(wrap);
    let catalog = {}, view = { mode: 'list' }, unsub = null, opened = false, checked = false;
    const finish = (eid, meta) => {
      if (opened) return; opened = true;
      if (unsub) unsub(); wrap.remove();
      onOpen(eid, meta);
    };
    unsub = Store.listen('catalog', async v => {
      catalog = v || {};
      if (!checked) {
        checked = true;
        if (!Object.keys(catalog).length && await migrateLegacy()) return;
        const sv = ssGet('ev'), sh = ssGet('evh');
        if (sv && catalog[sv] && catalog[sv].passHash === sh) return finish(sv, catalog[sv]);
      }
      if (!opened) draw();
    });
    const list = () => Object.entries(catalog).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const opts = (first) => `<option value="">${first}</option>` + list().map(([id, m]) => `<option value="${id}">${esc(m.title)}</option>`).join('');
    function draw() {
      const L = list();
      let body = '';
      if (view.mode === 'new') {
        body = `<h2>新しい開催を作る</h2>
          <div class="field"><label>開催のタイトル</label><input id="gTitle" maxlength="30" placeholder="例：10月の飲み会クイズ"></div>
          <div class="field"><label>この開催のパスワード</label><input id="gPass" type="password" autocomplete="new-password" placeholder="問題作成・進行画面を開くときに使います"></div>
          <div class="field"><label>参加者名簿</label><select id="gRoster">${opts('引き継がない（当日その場で参加）')}</select>
            <p class="mini">選んだ開催の名簿と参加者の名前を引き継ぎます。あとから追加・削除もできます。</p></div>
          <div class="field"><label>問題</label><select id="gCopy">${opts('空の状態から作る')}</select></div>
          <div class="field"><label>管理者PIN（config.js の ADMIN_PIN）</label><input id="gMaster" type="password" inputmode="numeric" autocomplete="off"></div>
          <p class="err" id="gErr"></p>
          <div class="a-actions"><button class="primary" id="gCreate">作成して開く</button><button id="gBack">戻る</button></div>`;
      } else {
        body = `<h2>${role === 'host' ? '進行する開催を選ぶ' : '編集する開催を選ぶ'}</h2>
          <div class="ev-list">${L.length ? L.map(([id, m]) => `
            <div class="ev ${view.open === id ? 'open' : ''}" data-ev="${id}">
              <div class="ev-t">${esc(m.title)}</div>
              <div class="ev-s">問題 ${m.qCount || 0}問 ・ 名簿 ${m.rosterCount || 0}人</div>
              ${view.open === id ? `<div class="ev-pass"><input id="gOpenPass" type="password" placeholder="この開催のパスワード" autocomplete="off">
                <button class="primary" id="gOpen">開く</button></div><p class="err" id="gErr"></p>` : ''}
            </div>`).join('') : '<p class="sub">まだ開催がありません。下のボタンから作ってください。</p>'}</div>
          <div class="a-actions"><button id="gNew">＋ 新しい開催を作る</button></div>`;
      }
      wrap.innerHTML = `<div class="gate-box"><div class="gate-brand"><img src="favicon.svg" alt="">${esc(C.APP_TITLE)}</div>${body}</div>`;
      const $ = id => document.getElementById(id);
      wrap.querySelectorAll('[data-ev]').forEach(el => el.addEventListener('click', e => {
        if (e.target.closest('.ev-pass')) return;
        view = { mode: 'list', open: el.dataset.ev }; draw(); setTimeout(() => $('gOpenPass') && $('gOpenPass').focus(), 0);
      }));
      if ($('gNew')) $('gNew').onclick = () => { view = { mode: 'new' }; draw(); $('gTitle').focus(); };
      if ($('gBack')) $('gBack').onclick = () => { view = { mode: 'list' }; draw(); };
      const tryOpen = async () => {
        const id = view.open, m = catalog[id], pass = $('gOpenPass').value;
        const ok = pass && ((await hashPass(pass)) === m.passHash || pass === String(C.ADMIN_PIN));
        if (!ok) { $('gErr').textContent = 'パスワードが違います'; return; }
        ssSet('ev', id); ssSet('evh', m.passHash); finish(id, m);
      };
      if ($('gOpen')) { $('gOpen').onclick = tryOpen; $('gOpenPass').onkeydown = e => { if (e.key === 'Enter') tryOpen(); }; }
      if ($('gCreate')) $('gCreate').onclick = async () => {
        const title = $('gTitle').value.trim(), pass = $('gPass').value;
        const err = t => { $('gErr').textContent = t; };
        if (!title) return err('タイトルを入れてください');
        if (pass.length < 4) return err('パスワードは4文字以上にしてください');
        if ($('gMaster').value !== String(C.ADMIN_PIN)) return err('管理者PINが違います');
        $('gCreate').disabled = true;
        const eid = 'e' + uid(), ev = {};
        if ($('gCopy').value) {
          const src = await Store.get('events/' + $('gCopy').value) || {};
          ev.questions = src.questions || null; ev.keys = src.keys || null; ev.images = src.images || null;
        }
        if ($('gRoster').value) ev.roster = rosterFromNames(rosterNames(await Store.get('events/' + $('gRoster').value)));
        const hash = await hashPass(pass);
        await Store.update('', {
          ['events/' + eid]: Object.keys(ev).length ? ev : { created: true },
          ['catalog/' + eid]: { title, passHash: hash, createdAt: Store.now(),
            qCount: Object.keys(ev.questions || {}).length, rosterCount: Object.keys(ev.roster || {}).length }
        });
        ssSet('ev', eid); ssSet('evh', hash);
        finish(eid, { title, passHash: hash });
      };
    }
  }

  function demoBanner() {
    if (Store.mode !== 'demo') return;
    const d = document.createElement('div');
    d.className = 'demo-banner';
    d.textContent = 'デモモード：同じブラウザのタブ同士だけで動きます（config.js に Firebase を設定すると本番動作）';
    document.body.prepend(d);
  }

  // ===== トースト通知 =====
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function toast(msg, type) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const icons = { ok: '✓', info: 'i', warn: '!', join: '+' };
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'ok');
    t.innerHTML = '<span class="ti">' + (icons[type] || '✓') + '</span><span></span>';
    t.lastChild.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2400);
  }

  // ===== 紙吹雪 =====
  function confetti(opts) {
    if (reduceMotion()) return;
    const o = Object.assign({ count: 140, duration: 2600 }, opts || {});
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:150';
    document.body.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
    const ctx = c.getContext('2d');
    const cols = ['#ff3d7f', '#ffc531', '#2f80ed', '#12b886', '#7c5cff', '#ff7a1a'];
    const ps = Array.from({ length: o.count }, () => ({
      x: W * (0.2 + Math.random() * 0.6), y: H * (o.from === 'top' ? -0.05 : 0.55),
      vx: (Math.random() - 0.5) * 18 * dpr, vy: (o.from === 'top' ? Math.random() * 4 : -12 - Math.random() * 14) * dpr,
      w: (6 + Math.random() * 8) * dpr, h: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      col: cols[Math.floor(Math.random() * cols.length)]
    }));
    const t0 = performance.now();
    (function frame(t) {
      const k = (t - t0) / o.duration;
      ctx.clearRect(0, 0, W, H);
      ps.forEach(p => {
        p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3);
        ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        ctx.restore();
      });
      if (k < 1) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ===== 数字のカウントアップ（data-count="数値"） =====
  function countUp(root) {
    (root || document).querySelectorAll('[data-count]').forEach(el => {
      const to = Number(el.getAttribute('data-count')), dec = String(to).includes('.') ? 2 : 0;
      if (reduceMotion() || !to) { el.textContent = fmt(to); return; }
      const t0 = performance.now(), dur = 900;
      (function step(t) {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? (to * e).toFixed(dec) : fmt(to);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }
  const vibrate = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  window.Q = {
    C, Store, CIRCLED, LETTERS, TYPES, uid, esc, fmt, toArr, sortedQuestions, slotLabel,
    scoreAnswer, buildRanking, compressImage, getImage, setImageBase, hydrateImages, lsGet, lsSet, demoBanner,
    scope, hashPass, eventGate, leaveEvent, rosterNames, rosterFromNames,
    toast, confetti, countUp, vibrate, reduceMotion
  };
})();
