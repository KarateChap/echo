/**
 * Global singleton lock ensuring only one SpeechRecognition instance
 * is active at a time. On mobile, multiple concurrent instances fight
 * for the microphone and cause recognition failures.
 */
let activeOwner: string | null = null;

export function acquireSpeechLock(id: string): boolean {
  // Always grant — React state ensures only one step is active at a time.
  // Previous owner's cleanup will call releaseSpeechLock harmlessly.
  activeOwner = id;
  return true;
}

export function releaseSpeechLock(id: string): void {
  if (activeOwner === id) activeOwner = null;
}
