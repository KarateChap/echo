import { createContext, useContext, useState, type ReactNode } from "react";

interface AudioLevelCtx {
  audioLevel: number;
  setAudioLevel: (v: number) => void;
}

const AudioLevelContext = createContext<AudioLevelCtx>({
  audioLevel: 0,
  setAudioLevel: () => {},
});

export function AudioLevelProvider({ children }: { children: ReactNode }) {
  const [audioLevel, setAudioLevel] = useState(0);
  return (
    <AudioLevelContext.Provider value={{ audioLevel, setAudioLevel }}>
      {children}
    </AudioLevelContext.Provider>
  );
}

export function useAudioLevelContext() {
  return useContext(AudioLevelContext);
}
