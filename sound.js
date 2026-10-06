/* BGMと効果音：音源ファイルを使わず、ブラウザ（Web Audio）で合成して鳴らす
   ・BGMは「にぎやか」（受付・順位）と「考え中」（回答中）の2種類
   ・開催ごとに音源ファイル（mp3など）を登録すると、にぎやかBGMの代わりにそれを流す */
(function () {
  let ctx = null, master, bgmBus, sfxBus, noiseBuf = null;
  const ls = (k, d) => { try { const v = localStorage.getItem('quizsnd_' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem('quizsnd_' + k, v ? '1' : '0'); } catch (e) {} };
  let bgmOn = ls('bgm', true), sfxOn = ls('sfx', true);
  let mode = null, timer = null, nextT = 0, step = 0, fileAudio = null, fileNode = null, fileSrc = '';

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      bgmBus = ctx.createGain(); bgmBus.gain.value = bgmOn ? 0.22 : 0; bgmBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.7 : 0; sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // 最初のクリック・キー操作で音を有効にする（ブラウザの決まり）
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (window.Sound) window.Sound.unlock(); }, { capture: true }));

  function tone(freq, t, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const peak = o.gain == null ? 0.25 : o.gain, a = o.attack || 0.005, r = Math.min(o.release || 0.08, dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - r));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); out = f; }
    osc.connect(g); out.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf;
    f.type = o.ftype || 'highpass'; f.frequency.value = o.freq || 6000;
    const peak = o.gain == null ? 0.2 : o.gain;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t); src.stop(t + dur + 0.05);
  }
  function kick(t, bus) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.25);
  }

  // ========== 効果音 ==========
  const SFX = {
    // 出題：駆け上がるジングル
    question() {
      const t = ctx.currentTime + 0.02;
      [72, 76, 79, 84].forEach((m, i) => tone(mtof(m), t + i * 0.07, 0.12, { gain: 0.18 }));
      [72, 76, 79, 84].forEach(m => tone(mtof(m), t + 0.32, 0.5, { type: 'triangle', gain: 0.16, release: 0.3 }));
      noise(t + 0.32, 0.4, { gain: 0.15, freq: 7000 });
    },
    // 残り5秒のカウント
    tick(last) {
      const t = ctx.currentTime + 0.01;
      tone(last ? 1320 : 990, t, 0.07, { type: 'sine', gain: 0.25 });
    },
    // 締切のブザー
    buzzer() {
      const t = ctx.currentTime + 0.02;
      tone(98, t, 0.9, { type: 'sawtooth', gain: 0.22, lp: 1400, release: 0.15 });
      tone(104, t, 0.9, { type: 'sawtooth', gain: 0.22, lp: 1400, release: 0.15 });
      tone(196, t, 0.9, { type: 'square', gain: 0.08, lp: 1200, release: 0.15 });
    },
    // 正解発表：ドラムロール → ピンポーン
    reveal() {
      const t = ctx.currentTime + 0.02, roll = 1.1;
      for (let x = 0; x < roll; x += 0.045) noise(t + x, 0.06, { gain: 0.05 + 0.18 * (x / roll), ftype: 'bandpass', freq: 1800 });
      noise(t + roll, 0.9, { gain: 0.25, freq: 5000 });
      tone(mtof(88), t + roll, 0.35, { type: 'sine', gain: 0.35, release: 0.2 });
      tone(mtof(84), t + roll + 0.3, 0.7, { type: 'sine', gain: 0.35, release: 0.5 });
    },
    // 参加したとき
    join() {
      const t = ctx.currentTime + 0.01;
      tone(660, t, 0.12, { type: 'sine', gain: 0.18, slide: 1320 });
    },
    // 個人の結果
    spot() {
      const t = ctx.currentTime + 0.02;
      for (let x = 0; x < 0.7; x += 0.045) noise(t + x, 0.06, { gain: 0.05 + 0.15 * (x / 0.7), ftype: 'bandpass', freq: 1800 });
      [79, 84].forEach((m, i) => tone(mtof(m), t + 0.7 + i * 0.12, 0.3, { type: 'triangle', gain: 0.25 }));
    },
    // 最終結果のファンファーレ
    fanfare() {
      const t = ctx.currentTime + 0.05, s = 0.16;
      const mel = [[67, 1], [67, 1], [67, 1], [72, 4], [76, 2], [74, 1], [72, 1], [79, 6]];
      let x = 0;
      mel.forEach(([m, d]) => {
        tone(mtof(m), t + x * s, d * s, { type: 'sawtooth', gain: 0.16, lp: 2600 });
        tone(mtof(m - 12), t + x * s, d * s, { type: 'square', gain: 0.07, lp: 1800 });
        x += d;
      });
      [60, 64, 67, 72].forEach(m => tone(mtof(m), t + x * s, 1.4, { type: 'sawtooth', gain: 0.08, lp: 2200, release: 0.9 }));
      noise(t + x * s, 1.5, { gain: 0.22, freq: 5000 });
    }
  };

  // ========== BGM（合成） ==========
  // にぎやか：C → Am → F → G（1小節ずつ）
  const PARTY = { bpm: 124, chords: [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]],
    mel: [76, null, 79, 76, 74, null, 72, null, 74, 76, null, 72, 69, null, 67, null,
          72, null, 76, 72, 69, null, 72, 74, null, 76, 74, null, 71, null, 67, null] };
  const THINK = { bpm: 96, chords: [[45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62], [45, 57, 60, 64]] };

  function schedule(t, i) {
    const bar = Math.floor(i / 16) % 4, s16 = i % 16;
    if (mode === 'party') {
      const c = PARTY.chords[bar], sp = 60 / PARTY.bpm / 4;
      if (s16 % 4 === 0) kick(t, bgmBus);
      if (s16 === 4 || s16 === 12) noise(t, 0.14, { gain: 0.16, ftype: 'bandpass', freq: 2200, bus: bgmBus });
      if (s16 % 2 === 0) noise(t, 0.04, { gain: 0.06, freq: 8000, bus: bgmBus });
      if (s16 % 2 === 0) tone(mtof(c[0] + (s16 % 4 === 2 ? 12 : 0)), t, sp * 1.8, { type: 'triangle', gain: 0.35, bus: bgmBus });
      if (s16 % 4 === 2) c.slice(1).forEach(m => tone(mtof(m), t, sp * 1.2, { type: 'square', gain: 0.045, lp: 1800, bus: bgmBus }));
      const m = PARTY.mel[(Math.floor(i / 16) % 2) * 16 + s16];
      if (m) tone(mtof(m), t, sp * 1.7, { type: 'square', gain: 0.07, lp: 3000, bus: bgmBus });
    } else if (mode === 'think') {
      const c = THINK.chords[bar], sp = 60 / THINK.bpm / 4;
      if (s16 % 4 === 0) tone(mtof(c[0]), t, sp * 3, { type: 'triangle', gain: 0.3, bus: bgmBus });
      if (s16 % 2 === 0) noise(t, 0.03, { gain: 0.05, freq: 9000, bus: bgmBus });
      if (s16 === 0) c.slice(1).forEach(m => tone(mtof(m), t, sp * 15, { type: 'sine', gain: 0.05, attack: 0.3, release: 0.8, bus: bgmBus }));
      if (s16 % 4 === 2) tone(mtof(c[1 + (s16 / 4 | 0) % 3] + 12), t, sp, { type: 'sine', gain: 0.06, bus: bgmBus });
    }
  }
  function startLoop() {
    if (!ctx || ctx.state !== 'running' || timer) return;
    nextT = ctx.currentTime + 0.05; step = 0;
    timer = setInterval(() => {
      const sp = 60 / (mode === 'think' ? THINK.bpm : PARTY.bpm) / 4;
      while (nextT < ctx.currentTime + 0.25) { schedule(nextT, step); nextT += sp; step++; }
    }, 60);
  }
  function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }
  function stopFile() { if (fileAudio) { fileAudio.pause(); } }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    stopLoop(); stopFile();
    if (!m || !ensure()) return;
    if (m === 'party' && fileSrc) {
      if (!fileAudio) {
        fileAudio = new Audio(); fileAudio.loop = true; fileAudio.src = fileSrc;
        try { fileNode = ctx.createMediaElementSource(fileAudio); fileNode.connect(bgmBus); } catch (e) {}
      }
      fileAudio.currentTime = 0;
      fileAudio.play().catch(() => {});
      return;
    }
    startLoop();
  }

  window.Sound = {
    play(name, arg) { if (!sfxOn || !ensure() || ctx.state !== 'running' || !SFX[name]) return; SFX[name](arg); },
    bgm(m) { setMode(m); },
    setFile(dataUrl) {
      if (dataUrl === fileSrc) return;
      fileSrc = dataUrl || '';
      if (fileAudio) { fileAudio.pause(); fileAudio = null; }
      if (mode === 'party') { const m = mode; mode = null; setMode(m); }
    },
    get bgmOn() { return bgmOn; }, get sfxOn() { return sfxOn; },
    toggleBgm() { bgmOn = !bgmOn; lsSet('bgm', bgmOn); if (ensure()) bgmBus.gain.setTargetAtTime(bgmOn ? 0.22 : 0, ctx.currentTime, 0.05); return bgmOn; },
    toggleSfx() { sfxOn = !sfxOn; lsSet('sfx', sfxOn); if (ensure()) sfxBus.gain.setTargetAtTime(sfxOn ? 0.7 : 0, ctx.currentTime, 0.05); return sfxOn; },
    ready() { return !!ctx && ctx.state === 'running'; },
    unlock() {
      if (!ensure()) return;
      const playing = timer || (fileAudio && !fileAudio.paused);
      if (mode && !playing && ctx.state === 'running') { const m = mode; mode = null; setMode(m); }
      else if (mode && !playing) ctx.resume().then(() => { if (!timer && !(fileAudio && !fileAudio.paused)) { const m = mode; mode = null; setMode(m); } });
    }
  };
})();
