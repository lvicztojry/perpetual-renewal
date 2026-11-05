/** User-controlled output gain, independent of the scene's final fade. */
export const BELL_VOLUME = 0.85;

/** Deep bronze modes, a hard clapper and a diffuse hall tail. */
export function createGiantBellSound(
  context: BaseAudioContext,
  { muted, reducedMotion }: { muted: boolean; reducedMotion: boolean }
): GainNode {
  const now = context.currentTime;
  const end = now + (reducedMotion ? 0.8 : 5);
  const mix = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 10;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.18;
  const limiter = context.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = 0.94 * Math.tanh((i / (curve.length - 1) * 2 - 1) * 1.6);
  limiter.curve = curve;
  limiter.oversample = "4x";
  const sceneEnvelope = context.createGain();
  sceneEnvelope.gain.setValueAtTime(1, now);
  sceneEnvelope.gain.setValueAtTime(1, end - (reducedMotion ? 0.3 : 0.65));
  sceneEnvelope.gain.linearRampToValueAtTime(0, end);
  const master = context.createGain();
  master.gain.value = muted ? 0 : BELL_VOLUME;
  mix.connect(compressor).connect(limiter).connect(sceneEnvelope).connect(master).connect(context.destination);

  // Seeded noise gives reproducible clapper and reverb timbres on every replay.
  let seed = 0x531ea;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const reverb = context.createConvolver();
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 1.8), context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const samples = impulse.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate;
      samples[i] = noise() * Math.exp(-3.8 * t) * Math.min(1, t / 0.025);
    }
  }
  reverb.buffer = impulse;
  const wet = context.createGain();
  wet.gain.value = 0.38;
  reverb.connect(wet).connect(mix);

  // The hum gives scale; stronger upper modes remain audible on laptop speakers.
  const modes = [
    [0.5, 0.23, 5.5], [1, 0.55, 5], [1.19, 0.38, 4.6], [1.5, 0.25, 4],
    [2, 0.72, 4.2], [2.76, 0.38, 3.3], [4.07, 0.25, 2.6],
    [5.43, 0.17, 2], [8.21, 0.09, 1.3], [12.17, 0.08, 0.8]
  ];
  for (const delay of reducedMotion ? [0] : [0, 2.15]) {
    const start = now + delay;
    const strength = delay === 0 ? 1 : 0.94;
    for (const [ratio, amplitude, decay] of modes) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const frequency = 73.416 * ratio;
      oscillator.frequency.setValueAtTime(frequency * 1.006, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + 0.13);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(amplitude * strength, start + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      oscillator.connect(envelope);
      envelope.connect(mix);
      envelope.connect(reverb);
      oscillator.start(start);
      oscillator.stop(Math.min(start + decay + 0.02, end));
    }

    const clapper = context.createBufferSource();
    const impact = context.createBuffer(1, Math.ceil(context.sampleRate * 0.12), context.sampleRate);
    const samples = impact.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = noise();
    clapper.buffer = impact;
    const metal = context.createBiquadFilter();
    metal.type = "bandpass";
    metal.frequency.value = 1400;
    metal.Q.value = 0.7;
    const attack = context.createGain();
    attack.gain.setValueAtTime(0, start);
    attack.gain.linearRampToValueAtTime(0.3 * strength, start + 0.001);
    attack.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
    clapper.connect(metal).connect(attack);
    attack.connect(mix);
    attack.connect(reverb);
    clapper.start(start);
    clapper.stop(start + 0.12);
  }
  return master;
}
