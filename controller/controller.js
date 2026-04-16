const form = document.getElementById('controlForm');
const statusEl = document.getElementById('status');

const videoUrlEl = document.getElementById('videoUrl');
const tickerTextEl = document.getElementById('tickerText');
const tickerBgEl = document.getElementById('tickerBg');
const tickerColorEl = document.getElementById('tickerColor');
const tickerBgTextEl = document.getElementById('tickerBgText');
const tickerColorTextEl = document.getElementById('tickerColorText');
const supabaseConfig = window.SUPABASE_CONFIG || null;
const sbClient =
  supabaseConfig && window.supabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

function isHexColor(value) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value || '');
}

function pairColorInputs(colorInput, textInput) {
  colorInput.addEventListener('input', () => {
    textInput.value = colorInput.value;
  });

  textInput.addEventListener('input', () => {
    if (isHexColor(textInput.value.trim())) {
      colorInput.value = textInput.value.trim();
    }
  });
}

async function loadCurrentState() {
  if (sbClient) {
    try {
      const { data, error } = await sbClient
        .from(supabaseConfig.table)
        .select('*')
        .eq('id', supabaseConfig.rowId)
        .single();

      if (error) throw error;
      if (!data) return;

      videoUrlEl.value = data.video_url || '';
      tickerTextEl.value = data.ticker_text || '';

      if (isHexColor(data.ticker_bg)) {
        tickerBgEl.value = data.ticker_bg;
        tickerBgTextEl.value = data.ticker_bg;
      }

      if (isHexColor(data.ticker_color)) {
        tickerColorEl.value = data.ticker_color;
        tickerColorTextEl.value = data.ticker_color;
      }
      return;
    } catch (err) {
      statusEl.textContent = 'Kunne ikke hente state fra Supabase. Prøver lokal server...';
    }
  }

  try {
    const res = await fetch('/state', { cache: 'no-store' });
    if (!res.ok) return;

    const data = await res.json();
    videoUrlEl.value = data.videoUrl || '';
    tickerTextEl.value = data.tickerText || '';

    if (isHexColor(data.tickerBg)) {
      tickerBgEl.value = data.tickerBg;
      tickerBgTextEl.value = data.tickerBg;
    }

    if (isHexColor(data.tickerColor)) {
      tickerColorEl.value = data.tickerColor;
      tickerColorTextEl.value = data.tickerColor;
    }
  } catch (err) {
    statusEl.textContent = 'Kunne ikke hente nuværende TV-indstillinger.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    videoUrl: videoUrlEl.value.trim(),
    tickerText: tickerTextEl.value.trim(),
    tickerBg: tickerBgTextEl.value.trim(),
    tickerColor: tickerColorTextEl.value.trim()
  };

  if (!isHexColor(payload.tickerBg) || !isHexColor(payload.tickerColor)) {
    statusEl.textContent = 'Farver skal være gyldige hex-værdier, fx #ffffff.';
    return;
  }

  statusEl.textContent = 'Sender opdatering...';

  try {
    if (sbClient) {
      const { error } = await sbClient
        .from(supabaseConfig.table)
        .upsert({
          id: supabaseConfig.rowId,
          video_url: payload.videoUrl,
          ticker_text: payload.tickerText,
          ticker_bg: payload.tickerBg,
          ticker_color: payload.tickerColor,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
      statusEl.textContent = 'TV opdateret (Supabase).';
      return;
    }

    const res = await fetch('/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error('Request failed');
    }

    statusEl.textContent = 'TV opdateret.';
  } catch (err) {
    statusEl.textContent = 'Fejl: Kunne ikke opdatere TV.';
  }
});

pairColorInputs(tickerBgEl, tickerBgTextEl);
pairColorInputs(tickerColorEl, tickerColorTextEl);
loadCurrentState();
