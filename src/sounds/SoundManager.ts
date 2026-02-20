/**
 * SoundManager — Game audio using real sound files + Web Audio API synthesis.
 * Real recordings for aim, release/flight, and impact.
 * Synthesized effects for score pop and match end accents.
 */

let ctx: AudioContext | null = null;

const getCtx = (): AudioContext => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
};

// ── Audio file cache ──
const audioBuffers: Record<string, AudioBuffer> = {};

const loadSound = async (url: string): Promise<AudioBuffer> => {
    if (audioBuffers[url]) return audioBuffers[url];

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await getCtx().decodeAudioData(arrayBuffer);
    audioBuffers[url] = buffer;
    return buffer;
};

const playSample = (buffer: AudioBuffer, volume: number = 1.0, playbackRate: number = 1.0) => {
    const ac = getCtx();
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gain = ac.createGain();
    gain.gain.value = volume;
    gain.connect(ac.destination);
    source.connect(gain);
    source.start();
};

// ── Preload all sounds on first user interaction ──
let preloaded = false;

const SOUNDS = {
    aim: '/sounds/aim.mp3',
    whoosh: '/sounds/arrow-whoosh.wav',
    hit: '/sounds/arrow-hit.wav',
    bullseye: '/sounds/bullseye.mp3',
    click: '/sounds/click.wav',
    fail: '/sounds/game-fail.mp3',
    win: '/sounds/game-win.wav',
};

const preloadAll = async () => {
    if (preloaded) return;
    preloaded = true;
    await Promise.all(Object.values(SOUNDS).map(url => loadSound(url).catch(() => {})));
};

// ── Synth utilities (kept for score pop & miss accent) ──

const createGain = (audioCtx: AudioContext, volume: number): GainNode => {
    const gain = audioCtx.createGain();
    gain.gain.value = volume;
    gain.connect(audioCtx.destination);
    return gain;
};

const createOsc = (
    audioCtx: AudioContext,
    type: OscillatorType,
    freq: number,
    dest: AudioNode
): OscillatorNode => {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(dest);
    return osc;
};

// ══════════════════════════════════════════
// Sound Effects
// ══════════════════════════════════════════

/** Bow draw — real recorded sound */
export const playAim = async () => {
    await preloadAll();
    const buf = audioBuffers[SOUNDS.aim];
    if (buf) playSample(buf, 0.6);
};

/** Arrow release + flight — real whoosh recording */
export const playRelease = async () => {
    await preloadAll();
    const buf = audioBuffers[SOUNDS.whoosh];
    if (buf) playSample(buf, 0.5, 1.2); // slightly faster for snappy release feel
};

/** Arrow flight — same whoosh, lower volume, normal speed */
export const playFlight = async (_duration: number = 0.8) => {
    await preloadAll();
    const buf = audioBuffers[SOUNDS.whoosh];
    if (buf) playSample(buf, 0.3);
};

/** Arrow impact — real hit sound + ring-based bonus
 * @param score 0=miss, 1-7=outer, 8-9=inner, 10=bullseye */
export const playImpact = async (score: number) => {
    await preloadAll();

    if (score === 0) {
        // Miss — play a muted thud + synth sad tone
        const buf = audioBuffers[SOUNDS.hit];
        if (buf) playSample(buf, 0.2, 0.7); // lower pitch = dull miss

        const ac = getCtx();
        const t = ac.currentTime;
        const sadGain = createGain(ac, 0.05);
        sadGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        const sad = createOsc(ac, 'sine', 280, sadGain);
        sad.frequency.exponentialRampToValueAtTime(140, t + 0.3);
        sad.start(t + 0.05);
        sad.stop(t + 0.35);
        return;
    }

    // Normal hit
    const buf = audioBuffers[SOUNDS.hit];
    if (buf) {
        // Closer to center = crisper (higher playback rate)
        const rate = 0.85 + (score / 10) * 0.4;
        playSample(buf, 0.5, rate);
    }

    // Bullseye bonus — play the cartoon hit sound
    if (score === 10) {
        const bullBuf = audioBuffers[SOUNDS.bullseye];
        if (bullBuf) playSample(bullBuf, 0.4, 1.0);
    }
};

/** Score pop — real click sound */
export const playScorePop = async (score: number) => {
    await preloadAll();
    const buf = audioBuffers[SOUNDS.click];
    if (buf) {
        const rate = score >= 8 ? 1.3 : score >= 5 ? 1.1 : 0.9;
        playSample(buf, 0.4, rate);
    }
};

/** Match end — real win/fail sound */
export const playMatchEnd = async () => {
    await preloadAll();
    const buf = audioBuffers[SOUNDS.win];
    if (buf) playSample(buf, 0.5);
};
