import { useEffect, useRef, useState } from 'react';
import { eventsUrl } from './api.js';

// Subscribes to the server's SSE stream and exposes the live poll state plus the
// most recent 'result' and 'tally' messages. Also tracks clock skew so the
// countdown timer can align to the server's clock, not the browser's.
export function useSse() {
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null); // last { type:'result', ... }
  const [tally, setTally] = useState(null); // last { type:'tally', ... }
  const [connected, setConnected] = useState(false);
  const skewRef = useRef(0); // Date.now() - server.serverNow

  useEffect(() => {
    const es = new EventSource(eventsUrl);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('state', (e) => {
      const { state: s } = JSON.parse(e.data);
      if (s?.serverNow) skewRef.current = Date.now() - s.serverNow;
      setState(s);
    });
    es.addEventListener('result', (e) => setResult(JSON.parse(e.data)));
    es.addEventListener('tally', (e) => setTally(JSON.parse(e.data)));

    return () => es.close();
  }, []);

  return { state, result, tally, connected, skewRef, setState };
}
