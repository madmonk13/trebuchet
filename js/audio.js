/* Trebuchet — synthesized sound effects (Web Audio, no sound files needed). */
window.Sfx = (() => {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('trebuchet.muted') === '1'; } catch (e) { /* storage unavailable */ }
  const last = {};

  function init() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return true;
  }

  const ready = () => ac && !muted && ac.state === 'running';

  function throttle(key, ms) {
    const t = performance.now();
    if (last[key] && t - last[key] < ms) return false;
    last[key] = t;
    return true;
  }

  function noise({ dur = 0.2, freq = 800, freqEnd, q = 1, type = 'bandpass', vol = 0.5, attack = 0.003, delay = 0 }) {
    if (!ready()) return;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function tone({ f0, f1 = f0, dur = 0.2, type = 'sine', vol = 0.3, delay = 0, attack = 0.005 }) {
    if (!ready()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // A brassy note: sawtooth through a lowpass filter.
  function horn(freq, delay, dur, vol = 0.16) {
    if (!ready()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 2, t);
    f.frequency.linearRampToValueAtTime(freq * 5, t + 0.06);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    unlock: init,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('trebuchet.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.value = m ? 0 : 0.7;
    },
    hit(mat, intensity) {
      const v = Math.min(1, intensity / 14);
      if (v < 0.1 || !throttle('hit' + mat, 50)) return;
      if (mat === 'stone') {
        noise({ dur: 0.18, freq: 380, q: 1.5, vol: 0.5 * v });
        tone({ f0: 110, f1: 55, dur: 0.15, vol: 0.25 * v });
      } else if (mat === 'wood') {
        noise({ dur: 0.1, freq: 950, q: 3, vol: 0.45 * v });
        tone({ f0: 240, f1: 150, dur: 0.09, type: 'triangle', vol: 0.18 * v });
      } else if (mat === 'straw') {
        noise({ dur: 0.16, freq: 2600, q: 0.6, vol: 0.25 * v });
      } else {
        noise({ dur: 0.22, freq: 220, type: 'lowpass', vol: 0.55 * v });
      }
    },
    break(mat) {
      if (!throttle('break', 60)) return;
      if (mat === 'stone') {
        noise({ dur: 0.45, freq: 900, freqEnd: 200, type: 'lowpass', vol: 0.6 });
        noise({ dur: 0.25, freq: 2500, q: 1, vol: 0.2, delay: 0.03 });
      } else if (mat === 'wood') {
        noise({ dur: 0.08, freq: 2400, q: 2, vol: 0.5 });
        noise({ dur: 0.3, freq: 700, q: 2, vol: 0.4, delay: 0.04 });
      } else {
        noise({ dur: 0.35, freq: 3500, freqEnd: 1500, q: 0.5, vol: 0.3 });
      }
    },
    launch() {
      tone({ f0: 95, f1: 55, dur: 0.3, type: 'sawtooth', vol: 0.08 });
      noise({ dur: 0.45, freq: 300, freqEnd: 1800, q: 1.2, vol: 0.3, attack: 0.15 });
    },
    creak() {
      tone({ f0: 70, f1: 120, dur: 0.5, type: 'sawtooth', vol: 0.05 });
      noise({ dur: 0.5, freq: 500, freqEnd: 800, q: 8, vol: 0.12, attack: 0.1 });
    },
    oof(kind) {
      if (!throttle('oof', 80)) return;
      const base = kind === 'king' ? 220 : kind === 'knight' ? 300 : 380;
      tone({ f0: base, f1: base * 0.45, dur: 0.28, type: 'square', vol: 0.09 });
      tone({ f0: base * 1.5, f1: base * 0.6, dur: 0.22, type: 'triangle', vol: 0.08, delay: 0.02 });
      noise({ dur: 0.3, freq: 600, type: 'lowpass', vol: 0.3 });
    },
    explode() {
      noise({ dur: 1.0, freq: 1400, freqEnd: 60, type: 'lowpass', vol: 0.9, attack: 0.005 });
      tone({ f0: 80, f1: 28, dur: 0.7, vol: 0.6 });
    },
    split() { tone({ f0: 700, f1: 1400, dur: 0.12, type: 'triangle', vol: 0.15 }); },
    slam() { noise({ dur: 0.35, freq: 200, freqEnd: 1600, q: 1, vol: 0.3, attack: 0.1 }); },
    click() { tone({ f0: 660, f1: 520, dur: 0.06, type: 'triangle', vol: 0.12 }); },
    win() {
      [[392, 0, 0.18], [523, 0.18, 0.18], [659, 0.36, 0.18], [784, 0.54, 0.5], [659, 0.86, 0.16], [784, 1.02, 0.7]]
        .forEach(([f, d, l]) => horn(f, d, l));
    },
    lose() {
      [[392, 0, 0.35], [370, 0.35, 0.35], [349, 0.7, 0.35], [262, 1.05, 0.9]].forEach(([f, d, l]) => horn(f, d, l, 0.12));
    },
    star(i) { tone({ f0: 880 + i * 220, dur: 0.25, type: 'triangle', vol: 0.15 }); },
  };
})();
