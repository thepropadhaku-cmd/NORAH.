import { cn } from "@/lib/utils";

export type OrbState = "idle" | "summon" | "listening" | "thinking" | "speaking" | "dismiss";

/**
 * NORAH's summoned presence — a small black glass orb with thin
 * luminous filaments, plus a translucent "living film" (the ambient
 * aura) that rises from the bottom of the viewport.
 *
 * `state` drives only the small orb's own color/filament/halo — it is
 * allowed to reflect composing/thinking/etc. as a subtle local tint.
 *
 * `speaking` is a SEPARATE, explicit flag that drives the aura (the
 * big film). It must be true only while assistant speech/TTS audio is
 * actually playing. Nothing else may gate the aura: not keyboard
 * focus, not textarea/input state, not a generic "active" state, and
 * not `state` itself — composing text sets `state="listening"` for
 * the small orb's tint, and that alone must never show the aura.
 * Callers that don't pass `speaking` get no aura at all, so every
 * existing decorative orb instance (message avatars, list icons)
 * stays exactly as before by default.
 */
const FILM_ELIGIBLE_MIN_SIZE = 24;

export function NorahOrb({
  state,
  size = 44,
  speaking = false,
  className,
  onAnimationEnd,
}: {
  state: OrbState;
  size?: number;
  /** True only while assistant speech/TTS audio is actually playing. Drives the aura exclusively. */
  speaking?: boolean;
  className?: string;
  onAnimationEnd?: () => void;
}) {
  const showFilm = size >= FILM_ELIGIBLE_MIN_SIZE && speaking;

  return (
    <div
      className={cn("norah-orb", className)}
      data-state={state}
      style={{ width: size, height: size }}
      onAnimationEnd={onAnimationEnd}
      role="img"
      aria-label={
        state === "thinking" ? "Norah is thinking" :
        state === "speaking" ? "Norah is speaking" :
        state === "listening" ? "Norah is listening" :
        "Norah"
      }
    >
      <div className="norah-orb__halo" />
      <div className="norah-orb__glass">
        <div className="norah-orb__filament norah-orb__filament--a" />
        <div className="norah-orb__filament norah-orb__filament--b" />
        <div className="norah-orb__sheen" />
      </div>

      {showFilm && (
        <div className="norah-film" aria-hidden="true">
          <div className="norah-film__body" />
          <div className="norah-film__crest norah-film__crest--a" />
          <div className="norah-film__crest norah-film__crest--b" />
          <div className="norah-film__crest norah-film__crest--c" />
        </div>
      )}
    </div>
  );
}
