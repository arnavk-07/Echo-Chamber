// All sound is synthesised with Web Audio, so there are no asset files.
// `sp` is an optional spatial descriptor { gain, pan, muffled } from game.js.
const Sfx = (() => {
  let ctx = null;
  let master;
  let noiseBuf;
  let chaseNodes = null;

  function init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function out(sp) {
    const g = ctx.createGain();
    g.gain.value = sp ? sp.gain : 1;
    const p = ctx.createStereoPanner();
    p.pan.value = sp ? sp.pan : 0;
    g.connect(p);
    if (sp && sp.muffled) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      p.connect(f);
      f.connect(master);
    } else {
      p.connect(master);
    }
    return g;
  }

  function audible(sp) { return ctx && (!sp || sp.gain > 0.01); }

  function env(t, vol, dur) {
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.01);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return e;
  }

  function tone(type, f0, f1, dur, vol, sp, delay = 0) {
    if (!audible(sp)) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = env(t, vol, dur);
    o.connect(e);
    e.connect(out(sp));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(dur, vol, filterType, freq, sp, delay = 0) {
    if (!audible(sp)) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const e = env(t, vol, dur);
    s.connect(f);
    f.connect(e);
    e.connect(out(sp));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  return {
    init,
    click() { tone('square', 2400, 1800, 0.04, 0.12); tone('sine', 1600, 1200, 0.15, 0.08, null, 0.05); },
    ping(charge) {
      tone('sine', 1400, 500, 0.35 + charge * 0.5, 0.3 + 0.25 * charge);
      tone('sine', 700, 350, 0.6 + charge * 0.6, 0.12, null, 0.1);
      tone('sine', 700, 350, 0.6 + charge * 0.6, 0.05, null, 0.35);
    },
    step(run, sp) { noise(0.07, run ? 0.22 : 0.08, 'lowpass', run ? 1200 : 700, sp); },
    splash(sp) { noise(0.15, 0.2, 'bandpass', 1800, sp); },
    creatureStep(sp) { noise(0.12, 0.45, 'lowpass', 220, sp); tone('sine', 70, 40, 0.15, 0.35, sp); },
    growl(sp) {
      if (!audible(sp)) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(95, t);
      o.frequency.linearRampToValueAtTime(50, t + 1.2);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const lg = ctx.createGain();
      lg.gain.value = 25;
      lfo.connect(lg);
      lg.connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const e = env(t, 0.7, 1.3);
      o.connect(f); f.connect(e); e.connect(out(sp));
      o.start(t); lfo.start(t);
      o.stop(t + 1.4); lfo.stop(t + 1.4);
    },
    drip(sp) { tone('sine', 1800, 700, 0.09, 0.15, sp); },
    hiss(sp) { noise(0.7, 0.06, 'highpass', 3000, sp); },
    hum(sp) { tone('sawtooth', 58, 60, 0.9, 0.05, sp); },
    clink(sp) { tone('triangle', 2200, 1900, 0.12, 0.35, sp); tone('triangle', 3100, 2800, 0.1, 0.2, sp, 0.04); },
    radio(sp, dur) {
      noise(dur, 0.1, 'bandpass', 1600, sp);
      for (let i = 0; i < dur * 2; i++) tone('square', [440, 523, 392, 330][i % 4], 440, 0.2, 0.03, sp, i * 0.5);
    },
    heartbeat(vol) { tone('sine', 62, 40, 0.13, vol); tone('sine', 56, 38, 0.13, vol * 0.8, null, 0.18); },
    breath(sp) { noise(0.5, 0.05, 'bandpass', 700, sp); },
    beacon(sp) { tone('sine', 1320, 1320, 0.08, 0.1, sp); tone('sine', 1760, 1760, 0.08, 0.08, sp, 0.1); },
    pickup() { tone('sine', 660, 660, 0.1, 0.2); tone('sine', 990, 990, 0.18, 0.2, null, 0.1); },
    key() { [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.2, 0.2, null, i * 0.08)); },
    locker() { noise(0.15, 0.2, 'bandpass', 500); tone('square', 120, 90, 0.1, 0.08); },
    gasp() { noise(0.4, 0.35, 'bandpass', 900); },
    denied() { tone('square', 200, 150, 0.2, 0.12); },
    death() { noise(1.2, 0.8, 'lowpass', 900); tone('sawtooth', 90, 30, 1.2, 0.5); },
    // Ported from Ghost Ship: traps, terminals and jump scares
    click2() { tone('square', 1800, 1500, 0.03, 0.08); },
    beep(n) { tone('sine', 300 + n * 70, 300 + n * 70, 0.18, 0.15); },
    buzz() { tone('square', 140, 110, 0.35, 0.15); },
    task() { [660, 880, 1100].forEach((f, i) => tone('sine', f, f, 0.15, 0.2, null, i * 0.08)); },
    creak() { tone('sawtooth', 180, 120, 0.5, 0.12); tone('sawtooth', 190, 130, 0.45, 0.08, null, 0.05); },
    snap() { noise(0.15, 0.6, 'highpass', 1500); tone('square', 600, 80, 0.2, 0.3); },
    struggle() { noise(0.1, 0.3, 'bandpass', 1200); tone('square', 300, 200, 0.08, 0.1); },
    shock() { noise(0.4, 0.4, 'highpass', 2000); tone('sawtooth', 900, 200, 0.4, 0.15); },
    alarm() { for (let i = 0; i < 5; i++) tone('square', 880, 620, 0.25, 0.15, null, i * 0.3); },
    sting() { tone('sawtooth', 1200, 300, 0.5, 0.25); tone('sawtooth', 1270, 320, 0.5, 0.2); noise(0.4, 0.3, 'bandpass', 2500); },
    screech() {
      [620, 700, 1050, 1400].forEach((f) => tone('sawtooth', f, f * 0.55, 1.3, 0.22));
      noise(1.3, 0.8, 'bandpass', 2400); tone('square', 110, 50, 1.3, 0.35);
    },
    // Looping chase music: a low pulsing drone that fades in and out.
    chase(on) {
      if (!ctx || on === !!chaseNodes) return;
      const t = ctx.currentTime;
      if (on) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.6);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420;
        const trem = ctx.createGain();
        trem.gain.value = 0.6;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const lg = ctx.createGain();
        lg.gain.value = 0.4;
        lfo.connect(lg); lg.connect(trem.gain);
        const oscs = [55, 58.3, 110].map((fr) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(t); return o; });
        f.connect(trem); trem.connect(g); g.connect(master);
        lfo.start(t);
        chaseNodes = { g, oscs, lfo };
      } else {
        const n = chaseNodes;
        chaseNodes = null;
        n.g.gain.setValueAtTime(n.g.gain.value, t);
        n.g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        n.oscs.forEach((o) => o.stop(t + 1.3));
        n.lfo.stop(t + 1.3);
      }
    },
    // Layered under her voice so it reads creepy even with a plain system voice.
    musicBox() {
      [988, 932, 784, 740, 659, 622].forEach((f, i) => tone('triangle', f, f * 0.995, 0.6, 0.05, null, i * 0.3));
      [1976, 1864].forEach((f, i) => tone('sine', f, f, 0.5, 0.015, null, 0.15 + i * 0.6));
    },
    giggle() {
      for (let i = 0; i < 6; i++) tone('sine', 1400 - i * 70, 1150 - i * 70, 0.08, 0.06, null, i * 0.12);
      noise(0.7, 0.03, 'bandpass', 3500);
    },
    uv() { tone('sine', 2400, 600, 0.5, 0.25); noise(0.4, 0.3, 'highpass', 4000); },
    // Her bat dragging along the floor
    scrape(sp) { noise(0.35, 0.12, 'bandpass', 900, sp); tone('sawtooth', 220, 180, 0.3, 0.03, sp); },
    howl() { tone('sawtooth', 300, 700, 0.6, 0.2); tone('sawtooth', 700, 200, 0.8, 0.2, null, 0.6); },
    win() { [392, 523, 659, 784, 1046].forEach((f, i) => tone('sine', f, f, 0.5, 0.2, null, i * 0.15)); },
  };
})();
