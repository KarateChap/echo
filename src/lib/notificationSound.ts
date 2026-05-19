/**
 * Premium notification chime synthesized with Web Audio API.
 * Produces a bright, two-tone ascending chime reminiscent of
 * high-end fintech payment confirmations.
 */

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function playPaymentReceivedSound() {
  try {
    const ctx = getContext();

    // Resume if suspended (autoplay policy)
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Master gain
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.35, now);
    master.connect(ctx.destination);

    // --- Tone 1: lower note (C6 = 1046.5 Hz) ---
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.6, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // --- Tone 2: higher note (E6 = 1318.5 Hz), slightly delayed ---
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1318.5, now + 0.1);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.5, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.6);

    // --- Tone 3: highest note (G6 = 1568 Hz), final sparkle ---
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(1568, now + 0.2);
    gain3.gain.setValueAtTime(0, now);
    gain3.gain.linearRampToValueAtTime(0.35, now + 0.22);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc3.connect(gain3);
    gain3.connect(master);
    osc3.start(now + 0.2);
    osc3.stop(now + 0.8);

    // --- Soft harmonic overtone on the final note for shimmer ---
    const osc4 = ctx.createOscillator();
    const gain4 = ctx.createGain();
    osc4.type = "triangle";
    osc4.frequency.setValueAtTime(3136, now + 0.2); // G7 (octave above)
    gain4.gain.setValueAtTime(0, now);
    gain4.gain.linearRampToValueAtTime(0.08, now + 0.25);
    gain4.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc4.connect(gain4);
    gain4.connect(master);
    osc4.start(now + 0.2);
    osc4.stop(now + 0.9);

    // Fade master out smoothly at the end
    master.gain.setValueAtTime(0.35, now + 0.7);
    master.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
  } catch {
    // Silently fail — sound is non-critical
  }
}
