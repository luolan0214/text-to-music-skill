// engine.js — 底座：乐器、混音、「画纸 + 乐器舞台（琴键 / 俯视的鼓）」画面、播放 / 录制 / 导出。
// 每首歌不改这个文件；歌本身写在 index.html 里，通过 createEngine(song) 交给底座。

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (x, a, b) => clamp((x - a) / (b - a));
const ease = x => x * x * (3 - 2 * x);
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 画纸上的「一根线」：path(env) 返回 [x, y, 粗细, 颜色] 的数组（每秒 env.HZ 个点），dots 可选
function lineArt({ path, dots, dotColor = [204, 140, 0] }) {
  return env => {
    const P = path(env), D = dots ? dots(env, P).sort((a, b) => a.t - b.t) : [];
    let di = 0, dd = 0;
    return {
      draw(pc, t) {
        const idx = Math.min(P.length - 1, Math.floor(t * env.HZ));
        if (idx < di) { pc.clearRect(0, 0, env.PW, env.PH); di = 0; dd = 0; }
        pc.lineCap = 'round';
        for (let j = di + 1; j <= idx; j++) {
          const a = P[j - 1], b = P[j];
          pc.beginPath(); pc.moveTo(a[0], a[1]); pc.lineTo(b[0], b[1]); pc.lineWidth = b[2]; pc.strokeStyle = b[3]; pc.stroke();
        }
        di = idx;
        pc.fillStyle = rgb(dotColor);
        while (dd < D.length && D[dd].t <= t) { const d = D[dd++]; pc.beginPath(); pc.arc(d.x, d.y, d.r, 0, 6.3); pc.fill(); }
        return [P[idx][0], P[idx][1], P[idx][3]];
      },
    };
  };
}

// 画纸上的字幕：blocks = [{ out: 小节, size?, y?, lines: [[文字, 出现的小节], ...] }]
// under(pc, t, env) 可选：画在字后面的东西（封面时 t = 整首歌结束）。封面显示最后一个 block。
function textArt({ blocks, size = 48, lineHeight = 1.7, x = 70, y = 0.42, color = [26, 26, 26], weight = 600, font = '"Songti SC","STSong","Noto Serif SC",serif', under }) {
  return env => ({
    draw(pc, t) {
      const b = t / env.BAR, cover = t >= env.TOTAL;
      pc.clearRect(0, 0, env.PW, env.PH);
      if (under) under(pc, t, env);
      pc.textBaseline = 'middle'; pc.textAlign = 'left';
      blocks.forEach((bl, bi) => {
        const sz = bl.size || size, LH = sz * lineHeight, n = bl.lines.length, y0 = env.PH * (bl.y ?? y) - (n - 1) * LH / 2;
        pc.font = `${weight} ${sz}px ${font}`;
        bl.lines.forEach(([txt, at], j) => {
          const inn = ease(ramp(b, at, at + 0.5)), a = cover ? (bi === blocks.length - 1 ? 1 : 0) : inn * (1 - ramp(b, bl.out, bl.out + 0.5));
          if (a <= 0) return;
          pc.fillStyle = rgb(color, a); pc.fillText(txt, x, y0 + j * LH + (cover ? 0 : (1 - inn) * 12));
        });
      });
      return null;
    },
  });
}

function createEngine(song) {
  // ───────────── 时间 ─────────────
  const BPM = song.bpm, BEAT = 60 / BPM, S16 = BEAT / 4, BAR = BEAT * 4, SWING = song.swing ?? 0.12;
  const END_BAR = song.endBar, TOTAL = END_BAR * BAR + (song.tail ?? 4), VOL = song.volume ?? 0.5;
  let REC = null;

  // ───────────── 乐器与混音 ─────────────
  function build(ctx, out, t0) {
    const T = (bar, step = 0) => t0 + bar * BAR + step * S16 + (step % 2 ? SWING * S16 : 0);
    const note = (i, t, d, m) => REC && REC.notes.push({ i, t: t - t0, d, m });
    const hit = (k, t) => REC && REC.drums.push({ k, t: t - t0 });

    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    // tone：总的「明暗」旋钮。歌可以自动化它，让某一段变闷再擦亮
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.5; tone.frequency.setValueAtTime(18000, t0);
    tone.connect(comp); comp.connect(master); master.connect(out);
    master.gain.setValueAtTime(VOL, t0);
    if (song.fade !== false) {          // fade: false = 结尾不淡出，直接停
      master.gain.setValueAtTime(VOL, t0 + (END_BAR - 1) * BAR);
      master.gain.linearRampToValueAtTime(0.0001, t0 + TOTAL - 0.2);
    }

    const rev = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3); }
    rev.buffer = ir;
    const revG = ctx.createGain(); revG.gain.value = 0.5; rev.connect(revG); revG.connect(tone);
    const dly = ctx.createDelay(1); dly.delayTime.value = S16 * 3;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2800;
    const dfb = ctx.createGain(); dfb.gain.value = 0.33;
    const dOut = ctx.createGain(); dOut.gain.value = 0.5;
    dly.connect(dlp); dlp.connect(dfb); dfb.connect(dly); dlp.connect(dOut); dOut.connect(tone);

    function bus(level, revSend = 0, dlySend = 0, target = tone) {
      const g = ctx.createGain(), l = ctx.createGain(); l.gain.value = level; g.connect(l); l.connect(target);
      if (revSend) { const s = ctx.createGain(); s.gain.value = level * revSend; g.connect(s); s.connect(rev); }
      if (dlySend) { const s = ctx.createGain(); s.gain.value = level * dlySend; g.connect(s); s.connect(dly); }
      return g;
    }
    // pump：底鼓一响，贝斯 / 铺底 / 琶音被压一下再弹回来（duck），形成「推着走」的感觉。不调用 duck 就没有任何影响
    const pump = ctx.createGain(); pump.connect(tone);
    const duck = (t, depth = 0.5, rel = 0.2) => { pump.gain.setValueAtTime(1 - depth, t); pump.gain.setTargetAtTime(1, t + 0.01, rel / 3); };
    const epBus = bus(0.55, 0.25), bassBus = bus(0.8, 0, 0, pump), leadBus = bus(0.5, 0.3, 0.35), padBus = bus(0.3, 0.4, 0, pump);
    // arpTone：琶音自己的「明暗」旋钮，歌可以让它慢慢变亮
    const arpTone = ctx.createBiquadFilter(); arpTone.type = 'lowpass'; arpTone.Q.value = 5; arpTone.frequency.setValueAtTime(3000, t0);
    arpTone.connect(bus(0.42, 0.2, 0.3, pump));
    // arpEcho：琶音的回声量（歌可以自动化它）；echoFb：回声重复的次数感。两个一起拧大，就是「往复回环」
    const arpEcho = ctx.createGain(); arpEcho.gain.setValueAtTime(0, t0); arpTone.connect(arpEcho); arpEcho.connect(dly);
    const sawBus = bus(0.5, 0.3, 0, pump), fxBus = bus(0.6, 0.35);
    const drumBus = bus(0.9, 0.06), snrBus = bus(0.8, 0.25), bellBus = bus(0.3, 0.5, 0.4);
    const pingBus = bus(0.32, 0.5, 0.5, comp);   // 不经过 tone：闷的时候它依然清楚

    const nLen = ctx.sampleRate * 2, noiseBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    { const d = noiseBuf.getChannelData(0); for (let i = 0; i < nLen; i++) d[i] = Math.random() * 2 - 1; }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };

    function shape(g, t, a, peak, d, sus, dur, r) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setTargetAtTime(peak * sus, t + a, d / 3);
      g.gain.setTargetAtTime(0, t + Math.max(dur, a + 0.01), r / 3);
      return t + Math.max(dur, a + 0.01) + r * 2;
    }

    // 电钢琴
    function ep(t, m, dur, vel = 1) {
      note('ep', t, dur, m);
      const f = mtof(m), g = ctx.createGain(), end = shape(g, t, 0.004, 0.22 * vel, 0.6, 0.35, dur, 0.25);
      for (const det of [-4, 4]) {
        const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
        car.frequency.value = f; car.detune.value = det; mod.frequency.value = f;
        mg.gain.setValueAtTime(f * 1.5 * vel, t); mg.gain.setTargetAtTime(f * 0.2, t, 0.22);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        car.start(t); mod.start(t); car.stop(end); mod.stop(end);
      }
      g.connect(epBus);
    }
    // 贝斯
    function bass(t, m, dur, vel = 1) {
      note('bass', t, dur, m);
      const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(1300, t); lp.frequency.setTargetAtTime(320, t, 0.08);
      const end = shape(g, t, 0.005, 0.5 * vel, 0.15, 0.7, dur, 0.06);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f;
      o.connect(lp); s.connect(lp); lp.connect(g); g.connect(bassBus);
      o.start(t); s.start(t); o.stop(end); s.stop(end);
    }
    // 主旋律（ghost = 叠加的八度声部，画面上画得淡，不参与画纸）
    function lead(t, m, dur, vel = 1, ghost) {
      note(ghost ? 'lead2' : 'lead', t, dur, m);
      const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.8;
      const end = shape(g, t, 0.02, 0.2 * vel, 0.2, 0.8, dur, 0.14);
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.setTargetAtTime(f * 0.006, t + 0.22, 0.1);
      lfo.connect(lg); lfo.start(t); lfo.stop(end);
      for (const [type, det, lvl] of [['sawtooth', 0, 0.55], ['triangle', 7, 1]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type; o.frequency.value = f; o.detune.value = det; og.gain.value = lvl;
        lg.connect(o.frequency); o.connect(og); og.connect(lp); o.start(t); o.stop(end);
      }
      lp.connect(g); g.connect(leadBus);
    }
    // 铺底
    function pad(t, m, dur, vel = 1) {
      note('pad', t, dur, m);
      const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1500;
      const end = shape(g, t, 0.5, 0.06 * vel, 0.3, 0.9, dur, 1.0);
      for (const det of [-9, 9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(end); }
      lp.connect(g); g.connect(padBus);
    }
    // 铃
    function bell(t, m, vel = 1) {
      note('bell', t, 0.1, m);
      const f = mtof(m), g = ctx.createGain();
      g.gain.setValueAtTime(0.3 * vel, t); g.gain.setTargetAtTime(0, t, 0.12);
      for (const [r, lvl] of [[1, 1], [3.01, 0.25]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f * r; og.gain.value = lvl; o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.9); }
      g.connect(bellBus);
    }
    // 信号音「滴」
    function ping(t, m) {
      note('ping', t, 0.1, m);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = mtof(m);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.005);
      g.gain.setValueAtTime(0.5, t + 0.09); g.gain.linearRampToValueAtTime(0, t + 0.11);
      o.connect(g); g.connect(pingBus); o.start(t); o.stop(t + 0.13);
    }
    function kick(t, vel = 1) {
      hit('kick', t);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
      g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.32);
    }
    function snare(t, vel = 1) {
      hit('snare', t);
      const n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      g.gain.setValueAtTime(0.6 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      n.connect(hp); hp.connect(g); g.connect(snrBus); n.start(t); n.stop(t + 0.22);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle';
      o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
      og.gain.setValueAtTime(0.45 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og); og.connect(snrBus); o.start(t); o.stop(t + 0.12);
    }
    // len > 1 秒会被当作镲片（crash）
    function hat(t, vel = 1, len = 0.045) {
      hit(len > 1 ? 'crash' : 'hat', t);
      const n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 8000;
      g.gain.setValueAtTime(0.25 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(hp); hp.connect(g); g.connect(drumBus); n.start(t); n.stop(t + len + 0.02);
    }
    function rim(t, vel = 1) {
      hit('snare', t);
      const n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 4;
      g.gain.setValueAtTime(0.9 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(bp); bp.connect(g); g.connect(snrBus); n.start(t); n.stop(t + 0.07);
    }
    // 琶音：短促的拨弦感合成器，用来做一直滚动的十六分音符
    function arp(t, m, dur, vel = 1, pan = 0) {
      note('arp', t, dur, m);
      const f = mtof(m), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, dur / 2.5);
      for (const [type, det] of [['sawtooth', -6], ['square', 6]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.connect(g); o.start(t); o.stop(t + dur * 2 + 0.1); }
      if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(arpTone); } else g.connect(arpTone);
    }
    // 切断式混响军鼓（80 年代标志音色）：尾巴很大，然后突然被切掉
    function gsnare(t, vel = 1) {
      hit('snare', t);
      const n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 900;
      g.gain.setValueAtTime(0.75 * vel, t); g.gain.exponentialRampToValueAtTime(0.32 * vel, t + 0.05);
      g.gain.setValueAtTime(0.28 * vel, t + 0.17); g.gain.linearRampToValueAtTime(0, t + 0.19);
      n.connect(hp); hp.connect(g); g.connect(snrBus); n.start(t); n.stop(t + 0.21);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle';
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.09);
      og.gain.setValueAtTime(0.5 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(og); og.connect(snrBus); o.start(t); o.stop(t + 0.14);
    }
    // 超级锯齿：五个略微走音的锯齿波叠成「一堵墙」。走 pump，底鼓一响它就被压下去再弹回来
    function saw(t, m, dur, vel = 1) {
      note('pad', t, dur, m);
      const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1; lp.frequency.setValueAtTime(6500, t); lp.frequency.setTargetAtTime(2400, t, dur / 2);
      const end = shape(g, t, 0.01, 0.05 * vel, 0.3, 0.85, dur, 0.12);
      for (const det of [-22, -11, 0, 11, 22]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(end); }
      lp.connect(g); g.connect(sawBus);
    }
    // 砸下来的那一下：一个往下掉的超低音 + 一团噪音
    function boom(t, vel = 1) {
      hit('kick', t);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
      g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 1.45);
      const n = noise(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
      ng.gain.setValueAtTime(0.5 * vel, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 1);
      n.connect(lp); lp.connect(ng); ng.connect(snrBus); n.start(t); n.stop(t + 1.05);
    }
    // 往上拧紧的音：音高在 dur 秒里升三个八度，越来越响，到点突然切掉
    function riser(t, dur, vel = 1) {
      const g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(9000, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 * vel, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.13 * vel, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.015);
      for (const det of [-12, 12]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur); o.connect(lp); o.start(t); o.stop(t + dur + 0.05); }
      lp.connect(g); g.connect(fxBus);
    }
    // 气声 / 上升的噪音（f0→f1 是音色从暗到亮）
    function breath(t, dur, peak, f0, f1) {
      const n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      n.connect(bp); bp.connect(g); g.connect(padBus); n.start(t); n.stop(t + dur + 0.05);
    }
    // 常用写法：琶开的长和弦 / 短促和弦 / 一段旋律 [小节偏移, 十六分位, 音高, 时值]
    const roll = (bar, c, steps, vel) => c.n.forEach((m, i) => ep(T(bar) + i * 0.035, m, steps * S16, vel));
    const stab = (bar, step, c, len, vel) => c.n.forEach(m => ep(T(bar, step), m, len * S16 * 0.9, vel));
    const melody = (bar0, ph, k, vel, ghost) => ph.forEach(([b, s, m, l]) => lead(T(bar0 + b, s), m + k, l * S16 * 0.95, vel, ghost));

    song.arrange({ ctx, t0, T, BAR, BEAT, S16, END_BAR, TOTAL, tone, arpTone, arpEcho: arpEcho.gain, echoFb: dfb.gain, master, duck, ep, bass, lead, pad, saw, bell, ping, arp, kick, boom, snare, gsnare, hat, rim, breath, riser, roll, stab, melody });
  }

  // ───────────── 把整首歌的音符先记下来，画面要用 ─────────────
  const ev = (() => {
    REC = { notes: [], drums: [] };
    const o = new OfflineAudioContext(2, 44100, 44100);
    build(o, o.destination, 0);
    const r = REC; REC = null;
    r.notes.sort((a, b) => a.t - b.t); r.drums.sort((a, b) => a.t - b.t);
    for (const k of ['lead', 'bell', 'ping', 'ep', 'bass', 'arp', 'pad']) r[k] = r.notes.filter(n => n.i === k);
    return r;
  })();

  // ───────────── 画面 ─────────────
  const cv = document.getElementById('c'), g2 = cv.getContext('2d'), W = cv.width, H = cv.height;
  const SANS = '"PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif';
  // 主题：song.theme 可以换成深色；song.colors 可以换各乐器的颜色
  const TH = Object.assign({ bg: [236, 231, 220], paper: [246, 242, 232], ink: [26, 26, 26], grid: [20, 20, 20] }, song.theme || {});
  const INK = TH.ink, KEYINK = [26, 26, 26];
  const COL = Object.assign({ lead: [217, 83, 43], ep: [43, 76, 126], bass: [27, 27, 27], pad: [146, 164, 153], bell: [31, 122, 109], arp: [122, 92, 168] }, song.colors || {});
  COL.lead2 = COL.lead;
  const WIDTH = { lead: 20, lead2: 12, ep: 15, bass: 18, pad: 9, bell: 11, arp: 10 };
  const ORDER = ['pad', 'arp', 'ep', 'bass', 'bell', 'lead2', 'lead'];
  const LEGEND = [['lead', '主旋律'], ['arp', '琶音'], ['ep', '电钢琴'], ['bass', '贝斯'], ['pad', '铺底'], ['bell', '铃']].filter(([k]) => ev.notes.some(n => n.i === k));

  const RX = 40, RW = 1000, PY = 170, PH = 730, RY = PY + PH, RH = 290, KY = RY + RH, KH = 94;
  const LO = 36, WW = RW / 36, PPS = RH / (2 * BAR);
  const WMAP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const keyX = m => { const w = Math.floor(m / 12) * 7 + WMAP[m % 12] - 21; return RX + (BLACK[m % 12] ? w + 1 : w + 0.5) * WW; };

  const paper = document.createElement('canvas'); paper.width = RW; paper.height = PH;
  const pc = paper.getContext('2d');
  const env = { BPM, BAR, BEAT, S16, END_BAR, TOTAL, HZ: 120, PW: RW, PH, ev };
  const art = song.art ? song.art(env) : null;
  const badge = song.badge || [RW / 2, PH / 2];
  const sectionAt = b => (song.sections.find(s => b < s[1]) || song.sections[song.sections.length - 1])[0];
  const rollColor = song.rollColor || (() => [201, 214, 227]);

  function draw(t, idle) {
    const b = t / BAR;
    g2.fillStyle = rgb(TH.bg); g2.fillRect(0, 0, W, H);

    g2.textBaseline = 'alphabetic'; g2.fillStyle = rgb(INK);
    g2.textAlign = 'left'; g2.font = `700 88px ${SANS}`; g2.fillText(song.title, RX - 4, 122);
    g2.textAlign = 'right'; g2.font = `600 25px ${SANS}`;
    if (!idle) { const ch = song.chordAt(Math.min(END_BAR - 1, Math.floor(b)))[b % 1 < 0.5 ? 0 : 1]; g2.fillText(`${sectionAt(b)} · ${ch.name}`, RX + RW, 58); }
    g2.fillText(`${BPM} BPM`, RX + RW, 94); g2.fillText(song.tag || '', RX + RW, 130);

    // 画纸
    g2.fillStyle = rgb(TH.paper); g2.fillRect(RX, PY, RW, PH);
    const tip = art ? art.draw(pc, idle ? TOTAL : t) : null;
    g2.drawImage(paper, RX, PY);
    if (tip && !idle && t < END_BAR * BAR + 1.5) {
      g2.fillStyle = tip[2]; g2.beginPath(); g2.arc(RX + tip[0], PY + tip[1], 6.5, 0, 6.3); g2.fill();
      g2.strokeStyle = tip[2]; g2.lineWidth = 1.5; g2.beginPath(); g2.arc(RX + tip[0], PY + tip[1], 13, 0, 6.3); g2.stroke();
    }
    if (idle) {
      const bx = RX + badge[0], by = PY + badge[1];
      g2.fillStyle = rgb(INK); g2.beginPath(); g2.arc(bx, by, 52, 0, 6.3); g2.fill();
      g2.fillStyle = rgb(TH.paper); g2.beginPath(); g2.moveTo(bx - 15, by - 24); g2.lineTo(bx + 26, by); g2.lineTo(bx - 15, by + 24); g2.closePath(); g2.fill();
    }

    if (song.lyrics) drawLyrics(t, idle);
    if (song.stage === 'drums') return drawDrums(t, idle);

    // 下落的音符
    g2.save(); g2.beginPath(); g2.rect(RX, RY, RW, RH); g2.clip();
    g2.fillStyle = rgb(rollColor(idle ? END_BAR : b)); g2.fillRect(RX, RY, RW, RH);
    g2.strokeStyle = rgb(TH.grid, 0.16); g2.lineWidth = 1.5;
    for (let m = LO; m <= 96; m += 12) { const x = keyX(m) - WW / 2; g2.beginPath(); g2.moveTo(x, RY); g2.lineTo(x, KY); g2.stroke(); }
    const active = {};
    if (!idle) {
      for (let k = Math.ceil(b * 4); k <= b * 4 + 8; k++) {
        const y = KY - (k * BEAT - t) * PPS;
        g2.strokeStyle = rgb(TH.grid, k % 4 === 0 ? 0.5 : 0.13); g2.lineWidth = k % 4 === 0 ? 2 : 1;
        g2.beginPath(); g2.moveTo(RX, y); g2.lineTo(RX + RW, y); g2.stroke();
      }
      for (const inst of ORDER) {
        const w = WIDTH[inst]; g2.fillStyle = rgb(COL[inst], inst === 'pad' ? 0.55 : inst === 'lead2' ? 0.5 : 1);
        for (const n of ev.notes) {
          if (n.i !== inst) continue;
          if (n.t > t + 2 * BAR + 0.5) break;
          const len = Math.max(n.d * PPS, w), yb = KY - (n.t - t) * PPS;
          if (yb - len > KY || yb < RY) continue;
          g2.beginPath(); g2.roundRect(keyX(n.m) - w / 2, yb - len, w, len, w / 2); g2.fill();
          if (n.t <= t && t < n.t + Math.max(n.d, 0.14)) active[n.m] = inst;
        }
      }
      if (song.rollOverlay) song.rollOverlay(g2, b, { x: RX, y: RY, w: RW, h: RH });
    }
    g2.restore();

    // 鼓点指示灯
    const lit = { kick: 0, snare: 0, hat: 0 };
    if (!idle) for (const d of ev.drums) { if (d.t > t) break; const k = d.k === 'crash' ? 'hat' : d.k; lit[k] = Math.exp(-(t - d.t) * (d.k === 'crash' ? 3 : 14)); }
    g2.font = `600 19px ${SANS}`; g2.textAlign = 'right'; g2.textBaseline = 'middle';
    [['踩镲', 'hat'], ['军鼓', 'snare'], ['底鼓', 'kick']].forEach(([label, k], i) => {
      const x = RX + RW - 30 - i * 112, y = RY + 28;
      g2.beginPath(); g2.arc(x, y, 11, 0, 6.3); g2.fillStyle = rgb(INK, lit[k]); g2.fill();
      g2.strokeStyle = rgb(INK); g2.lineWidth = 2; g2.stroke();
      g2.fillStyle = rgb(INK); g2.fillText(label, x - 20, y + 1);
    });

    // 琴键
    g2.lineWidth = 1.5; g2.strokeStyle = rgb(KEYINK);
    for (let m = LO; m <= 96; m++) {
      if (BLACK[m % 12]) continue;
      const x = keyX(m) - WW / 2;
      g2.fillStyle = active[m] ? rgb(COL[active[m]]) : '#fbf9f3';
      g2.fillRect(x, KY, WW, KH); g2.strokeRect(x, KY, WW, KH);
    }
    for (let m = LO; m <= 96; m++) {
      if (!BLACK[m % 12]) continue;
      const x = keyX(m);
      g2.fillStyle = active[m] ? rgb(COL[active[m]]) : rgb(KEYINK);
      g2.fillRect(x - WW * 0.3, KY, WW * 0.6, KH * 0.6);
      if (active[m]) g2.strokeRect(x - WW * 0.3, KY, WW * 0.6, KH * 0.6);
    }
    g2.strokeStyle = rgb(INK); g2.lineWidth = 2; g2.strokeRect(RX, PY, RW, KY + KH - PY);
    g2.beginPath(); g2.moveTo(RX, RY); g2.lineTo(RX + RW, RY); g2.stroke();

    // 图例
    if (song.lyrics) return;
    g2.font = `500 21px ${SANS}`; g2.textAlign = 'left'; g2.textBaseline = 'middle';
    let lx = RX + 10;
    for (const [k, label] of LEGEND) {
      g2.fillStyle = rgb(COL[k]); g2.beginPath(); g2.arc(lx, KY + KH + 44, 8, 0, 6.3); g2.fill();
      g2.fillStyle = rgb(INK, 0.75); g2.fillText(label, lx + 18, KY + KH + 45);
      lx += 40 + g2.measureText(label).width + 26;
    }
  }

  // 滚动歌词（song.lyrics = [[文字, 出现的小节], ...]）：最下面一条窄栏，当前句亮、下一句暗，唱到就往上滚。
  // 字放这里，画纸就能整张留给节奏和乐器。有歌词时不画图例。
  const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
  function drawLyrics(t, idle) {
    const L = song.lyrics, b = t / BAR, top = KY + KH + 26, LH = 58;
    let idx = -1; for (let i = 0; i < L.length; i++) if (L[i][1] <= b) idx = i;
    const pos = idle ? L.length - 1 : idx < 0 ? -1 : idx - 1 + ease(ramp(b, L[idx][1], L[idx][1] + 0.35));
    g2.save(); g2.beginPath(); g2.rect(RX, top, RW, H - top - 8); g2.clip();
    g2.font = `600 38px ${SERIF}`; g2.textAlign = 'left'; g2.textBaseline = 'middle';
    L.forEach(([txt], i) => { const d = i - pos; if (d < -1.2 || d > 1.8) return; g2.fillStyle = rgb(INK, 0.3 + 0.7 * clamp(1 - Math.abs(d))); g2.fillText(txt, RX + 4, top + 34 + d * LH); });
    g2.restore();
  }

  // 另一种舞台：俯视的一套鼓（song.stage = 'drums'）。鼓是主角的歌用它，被敲到的那面会震。
  // song.kit 可以改每面鼓的位置和大小：[{ k: 'kick'|'snare'|'hat'|'crash', x, y（0–1）, r, accent? }]
  const KIT = song.kit || [{ k: 'hat', x: 0.14, y: 0.4, r: 62 }, { k: 'snare', x: 0.33, y: 0.6, r: 86 }, { k: 'kick', x: 0.56, y: 0.5, r: 132, accent: true }, { k: 'crash', x: 0.84, y: 0.4, r: 98 }];
  function drawDrums(t, idle) {
    const SH = KY + KH - RY, ACC = song.accent || COL.lead;
    g2.fillStyle = rgb(TH.stage || TH.paper); g2.fillRect(RX, RY, RW, SH);
    g2.save(); g2.beginPath(); g2.rect(RX, RY, RW, SH); g2.clip();
    const age = {};
    if (!idle) for (const d of ev.drums) { if (d.t > t) break; age[d.k] = t - d.t; }
    for (const p of KIT) {
      const a = age[p.k] ?? 99, cym = p.k === 'hat' || p.k === 'crash', slow = p.k === 'crash' ? 2.2 : cym ? 16 : 7;
      const x = RX + p.x * RW, y = RY + p.y * SH, r = p.r * (1 + 0.05 * Math.exp(-a * 14)), c = p.accent ? ACC : INK;
      const rip = Math.exp(-a * (cym ? 9 : 4.5));
      if (rip > 0.02 && !cym) { g2.strokeStyle = rgb(c, rip * 0.7); g2.lineWidth = 2.5; g2.beginPath(); g2.arc(x, y, r + (p.r * 0.5) * (1 - rip), 0, 6.3); g2.stroke(); }
      g2.fillStyle = rgb(c, Math.exp(-a * slow) * (cym ? 0.75 : 0.95)); g2.beginPath(); g2.arc(x, y, r, 0, 6.3); g2.fill();
      g2.strokeStyle = rgb(INK); g2.lineWidth = cym ? 2 : 3.5; g2.beginPath(); g2.arc(x, y, r, 0, 6.3); g2.stroke();
      if (cym) { g2.fillStyle = rgb(INK); g2.beginPath(); g2.arc(x, y, 7, 0, 6.3); g2.fill(); if (p.k === 'hat') { g2.lineWidth = 1.5; g2.beginPath(); g2.arc(x, y, r * 0.42, 0, 6.3); g2.stroke(); } }
      else { g2.lineWidth = 1.5; g2.beginPath(); g2.arc(x, y, r * 0.84, 0, 6.3); g2.stroke(); }
    }
    g2.restore();
    g2.strokeStyle = rgb(INK); g2.lineWidth = 2; g2.strokeRect(RX, PY, RW, KY + KH - PY);
    g2.beginPath(); g2.moveTo(RX, RY); g2.lineTo(RX + RW, RY); g2.stroke();
  }

  // ───────────── 播放 / 录制 / 导出 ─────────────
  let actx = null, t0 = 0, raf = 0, recorder = null;
  const btnPlay = document.getElementById('play'), btnRec = document.getElementById('rec'), btnWav = document.getElementById('wav');
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  function stop() {
    cancelAnimationFrame(raf);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    if (actx) { actx.close(); actx = null; }
    btnPlay.textContent = '播放'; btnRec.textContent = '录制视频'; btnRec.classList.remove('on');
    draw(0, true);
  }
  function start(record) {
    stop();
    actx = new AudioContext();
    const sink = actx.createGain(); sink.connect(actx.destination);
    if (record) {
      const md = actx.createMediaStreamDestination(); sink.connect(md);
      const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...md.stream.getAudioTracks()]);
      const mp4 = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', mime = MediaRecorder.isTypeSupported(mp4) ? mp4 : 'video/webm;codecs=vp9,opus', chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192e3 });
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      recorder.onstop = () => save(new Blob(chunks, { type: mime }), song.title + (mime.startsWith('video/mp4') ? '.mp4' : '.webm'));
      recorder.start();
      btnRec.textContent = '停止录制'; btnRec.classList.add('on');
    }
    t0 = actx.currentTime + 0.25;
    build(actx, sink, t0);
    btnPlay.textContent = '停止';
    const tick = () => { const t = actx.currentTime - t0; if (t >= TOTAL) return stop(); draw(Math.max(0, t), false); raf = requestAnimationFrame(tick); };
    tick();
  }
  async function render() { const sr = 44100, off = new OfflineAudioContext(2, Math.ceil(sr * TOTAL), sr); build(off, off.destination, 0); return off.startRendering(); }
  function wavBytes(buf) {
    const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), dv = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, buf.sampleRate, true);
    dv.setUint32(28, buf.sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true); dv.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true); }
    return new Uint8Array(dv.buffer);
  }
  // 自检：我听不到声音，但能量出每一段的音量。peak 超过 1 就是爆音。
  async function check() {
    const buf = await render(), L = buf.getChannelData(0), R = buf.getChannelData(1), sr = buf.sampleRate, out = { total: +TOTAL.toFixed(1), peak: 0, nan: 0, sections: {} };
    let from = 0;
    for (const [name, to] of song.sections) {
      const a = Math.floor(from * BAR * sr), b = Math.min(L.length, Math.floor(Math.min(to, END_BAR) * BAR * sr)); let pk = 0, sq = 0;
      for (let i = a; i < b; i++) { const v = L[i]; if (v !== v) out.nan++; pk = Math.max(pk, Math.abs(v), Math.abs(R[i])); sq += v * v; }
      out.sections[name] = { peak: +pk.toFixed(3), rmsDb: +(10 * Math.log10(sq / Math.max(1, b - a))).toFixed(1) };
      out.peak = Math.max(out.peak, +pk.toFixed(3)); from = to;
    }
    return out;
  }
  btnPlay.onclick = cv.onclick = () => actx ? stop() : start(false);
  btnRec.onclick = () => recorder ? stop() : start(true);
  btnWav.onclick = async () => { btnWav.textContent = '导出中…'; save(new Blob([wavBytes(await render())], { type: 'audio/wav' }), song.title + '.wav'); btnWav.textContent = '导出音频'; };

  Object.assign(window, { __draw: draw, __render: render, __check: check, __wav: async () => wavBytes(await render()), __song: { title: song.title, TOTAL, BAR, END_BAR } });
  draw(0, true);
}
