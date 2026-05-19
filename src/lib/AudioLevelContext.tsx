import { createContext, useContext, useRef, useMemo, useCallback, type ReactNode, type MutableRefObject } from "react";

interface AudioLevelCtx {
  audioLevelRef: MutableRefObject<number>;
  setAudioLevel: (v: number) => void;
}

const AudioLevelContext = createContext<AudioLevelCtx>({
  audioLevelRef: { current: 0 },
  setAudioLevel: () => {},
});

export function AudioLevelProvider({ children }: { children: ReactNode }) {
  const audioLevelRef = useRef(0);
  const setAudioLevel = useCallback((v: number) => { audioLevelRef.current = v; }, []);
  const value = useMemo(() => ({ audioLevelRef, setAudioLevel }), [setAudioLevel]);
  return (
    <AudioLevelContext.Provider value={value}>
      {children}
    </AudioLevelContext.Provider>
  );
}

export function useAudioLevelContext() {
  return useContext(AudioLevelContext);
}
