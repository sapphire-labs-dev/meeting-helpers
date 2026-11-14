// Messages between the presenter window and the audience window. Both run in
// the same browser, so a BroadcastChannel is enough: nothing goes over the network.

export type PresentMessage =
  | { type: 'hello' }
  | { type: 'state'; deckId: string; page: number; ended: boolean }
  | { type: 'nav'; delta: number }
  | { type: 'bye' };

export const CHANNEL = 'sapphire-meet:present';

export function openChannel(onMessage: (m: PresentMessage) => void): (m: PresentMessage) => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<PresentMessage>) => onMessage(e.data);
  return (m) => ch.postMessage(m);
}

/** Keys that move between slides, shared by both windows (clickers send PageUp/PageDown). */
export function navDelta(e: KeyboardEvent): number {
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': return 1;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': return -1;
    default: return 0;
  }
}
