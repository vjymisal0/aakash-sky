// Pass prediction is ~1M SGP4 calls for 7 days of bright satellites, so it runs off the main thread.
import { json2satrec } from 'satellite.js';
import { toOmm, type RawSat } from './core/catalog';
import { darkWindows, findVisiblePasses, type Observer, type Pass } from './core/sky';

export interface PassRequest {
  id: number;
  sats: RawSat[];
  observer: Observer;
  from: number;
  days: number;
}

export interface PassResponse {
  id: number;
  passes: Pass[];
  done: boolean;
}

self.onmessage = (e: MessageEvent<PassRequest>) => {
  const { id, sats, observer, from, days } = e.data;
  const windows = darkWindows(observer, new Date(from), new Date(from + days * 86_400_000));
  const all: Pass[] = [];
  let lastPost = performance.now();

  for (const raw of sats) {
    try {
      all.push(...findVisiblePasses(json2satrec(toOmm(raw)), raw[1], observer, windows));
    } catch {
      // Malformed or decayed elements: skip this satellite, keep the rest.
    }
    // Stream partial results so the hero card fills in quickly.
    if (performance.now() - lastPost > 400) {
      post(id, all, false);
      lastPost = performance.now();
    }
  }
  post(id, all, true);
};

function post(id: number, passes: Pass[], done: boolean) {
  const sorted = [...passes].sort((a, b) => a.start.time.getTime() - b.start.time.getTime());
  self.postMessage({ id, passes: sorted, done } satisfies PassResponse);
}
