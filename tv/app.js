const POLL_MS = 2000;

const videoContainer = document.getElementById('videoContainer');
const ticker = document.getElementById('ticker');
const tickerText = document.getElementById('tickerText');
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const tickerTrack = document.querySelector('.ticker-track');
const supabaseConfig = window.SUPABASE_CONFIG || null;
const sbClient =
  supabaseConfig && window.supabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

let lastVideoUrl = null;
let pollTimer = null;
let renderToken = 0;
const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
const API_BASE = IS_GITHUB_PAGES ? null : window.location.origin;

function apiUrl(pathnameWithQuery) {
  if (!API_BASE) return null;
  const normalized = pathnameWithQuery.startsWith('/')
    ? pathnameWithQuery
    : `/${pathnameWithQuery}`;
  return `${API_BASE}${normalized}`;
}

function mapSupabaseRowToState(row) {
  if (!row) return null;
  return {
    videoUrl: row.video_url || '',
    tickerText: row.ticker_text || '',
    tickerBg: row.ticker_bg || '#d90429',
    tickerColor: row.ticker_color || '#ffffff'
  };
}

function updateClock() {
  const now = new Date();

  timeEl.textContent = new Intl.DateTimeFormat('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);

  dateEl.textContent = new Intl.DateTimeFormat('da-DK', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(now);
}

function normalizeYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');

    if (host === 'youtu.be') {
      return u.pathname.slice(1);
    }

    if (host.includes('youtube.com')) {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v');
      }
      if (u.pathname.startsWith('/shorts/')) {
        return u.pathname.split('/')[2];
      }
      if (u.pathname.startsWith('/embed/')) {
        return u.pathname.split('/')[2];
      }
    }
  } catch (err) {
    return null;
  }

  return null;
}

function inferPlayerType(url) {
  if (!url) {
    return { type: 'none' };
  }

  const ytId = normalizeYoutubeUrl(url);
  if (ytId) {
    return {
      type: 'youtube',
      src: `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1`
    };
  }

  const lower = url.toLowerCase();
  if (/\.(mp4|webm|ogg)(\?|#|$)/.test(lower)) {
    return { type: 'html5video', src: url };
  }

  if (lower.includes('dr.dk') || lower.includes('drtv.dk')) {
    if (/\.(mp4|m3u8)(\?|#|$)/.test(lower)) {
      return { type: 'html5video', src: url };
    }
    return { type: 'dr-page', src: url };
  }

  return { type: 'iframe', src: url };
}

async function resolveDrVideo(url) {
  const endpoint = apiUrl(`/resolve-video?url=${encodeURIComponent(url)}`);
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || !payload.ok || !payload.resolvedUrl) return null;
    return payload.resolvedUrl;
  } catch (err) {
    return null;
  }
}

function renderIframe(src) {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  iframe.referrerPolicy = 'origin';
  iframe.allowFullscreen = true;
  videoContainer.appendChild(iframe);
}

function renderHtml5Video(src, loop = false, onError = null) {
  const video = document.createElement('video');
  video.src = src;
  video.autoplay = true;
  video.controls = false;
  video.loop = loop;
  video.muted = true;
  video.playsInline = true;

  if (typeof onError === 'function') {
    video.addEventListener('error', onError, { once: true });
  }

  videoContainer.appendChild(video);
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

async function renderVideo(videoUrl) {
  const currentToken = ++renderToken;

  if (videoUrl === lastVideoUrl) {
    return;
  }

  lastVideoUrl = videoUrl;
  videoContainer.innerHTML = '';

  const mode = inferPlayerType(videoUrl);

  if (mode.type === 'none') {
    return;
  }

  if (mode.type === 'dr-page') {
    const resolved = await resolveDrVideo(videoUrl);
    if (currentToken !== renderToken) return;

    if (resolved) {
      renderHtml5Video(resolved, false, () => {
        videoContainer.innerHTML = '';
        renderIframe(videoUrl);
      });
      return;
    }

    // Fall back to iframe when direct stream is unavailable (e.g. DRM/protected content).
    renderIframe(videoUrl);
    return;
  }

  if (mode.type === 'youtube' || mode.type === 'iframe') {
    renderIframe(mode.src);
    return;
  }

  if (mode.type === 'html5video') {
    renderHtml5Video(mode.src, true);
  }
}

function applyTickerSettings(data) {
  tickerText.textContent = data.tickerText || '';
  document.documentElement.style.setProperty('--ticker-bg', data.tickerBg || '#d90429');
  document.documentElement.style.setProperty('--ticker-color', data.tickerColor || '#ffffff');

  // Restart animation so changed text starts scrolling immediately from the right.
  tickerTrack.style.animation = 'none';
  void tickerTrack.offsetWidth;
  tickerTrack.style.animation = '';
}

async function syncState() {
  if (sbClient) {
    try {
      const { data, error } = await sbClient
        .from(supabaseConfig.table)
        .select('*')
        .eq('id', supabaseConfig.rowId)
        .single();
      if (error) throw error;

      const mapped = mapSupabaseRowToState(data);
      if (mapped) {
        await renderVideo((mapped.videoUrl || '').trim());
        applyTickerSettings(mapped);
        return;
      }
    } catch (err) {
      // Fall through to local API fallback.
    }
  }

  const stateEndpoint = apiUrl('/state');
  if (!stateEndpoint) {
    return;
  }

  try {
    const res = await fetch(stateEndpoint, { cache: 'no-store' });
    if (!res.ok) return;

    const data = await res.json();
    await renderVideo((data.videoUrl || '').trim());
    applyTickerSettings(data);
  } catch (err) {
    // Keep UI running even when network hiccups happen.
  }
}

function applyState(data) {
  void renderVideo((data.videoUrl || '').trim());
  applyTickerSettings(data);
}

function startPolling() {
  if (pollTimer) return;
  syncState();
  pollTimer = setInterval(syncState, POLL_MS);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function startRealtime() {
  if (sbClient) {
    const channel = sbClient
      .channel('tv-state')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: supabaseConfig.table,
          filter: `id=eq.${supabaseConfig.rowId}`
        },
        (payload) => {
          const row = payload.new || payload.old;
          const mapped = mapSupabaseRowToState(row);
          if (!mapped) return;
          applyState(mapped);
          stopPolling();
        }
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
          startPolling();
        }
      });

    // Ensure initial state load even before realtime fires.
    syncState();
    return channel;
  }

  if (!('EventSource' in window)) {
    startPolling();
    return;
  }

  const eventsEndpoint = apiUrl('/events');
  if (!eventsEndpoint) {
    return;
  }

  const es = new EventSource(eventsEndpoint);
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      applyState(data);
      stopPolling();
    } catch (err) {
      // Ignore malformed event payloads.
    }
  };

  es.onerror = () => {
    // Fall back to polling while realtime channel is unavailable.
    startPolling();
  };
}

updateClock();
setInterval(updateClock, 1000);

startRealtime();
startPolling();
