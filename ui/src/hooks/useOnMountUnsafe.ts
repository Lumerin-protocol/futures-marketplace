import { type EffectCallback, useEffect, useRef } from "react";

export function useOnMountUnsafe(effect: EffectCallback) {
  const initialized = useRef(false);

  // Running exactly once on mount is the entire purpose of this hook, so
  // `effect` must stay out of the dependency list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      effect();
    }
  }, []);
}
