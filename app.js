/* Ender Radio - play audio from YouTube videos */

// ---------- CONFIG ----------
// The YouTube IFrame API script is loaded from the official Google domain.
const YT_API_URL = 'https://www.youtube.com/iframe_api';

// Storage keys (localStorage saves your queue between visits)
const STORAGE_KEY = 'ender_radio_queue';

// ---------- STATE ----------
let player = null;          // YouTube IFrame API player
let currentIndex = -1;      // index of the currently loaded song in queue
let isShuffle = false;
let queue = [];             // array of { id, title, channel }
let shuffleOrder = [];      // shuffled indexes for play order
let shufflePos = 0;

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const urlInput = $('#urlInput');
const addButton = $('#addButton');
const errorBox = $('#errorBox');
const trackTitle = $('#trackTitle');
const trackChannel = $('#trackChannel');
const art = $('#art');
const playButton = $('#playButton');
const prevButton = $('#prevButton');
const nextButton = $('#nextButton');
const shuffleButton = $('#shuffleButton');
const seekBar = $('#seekBar');
const currentTimeEl = $('#currentTime');
const durationTimeEl = $('#durationTime');
const volumeBar = $('#volumeBar');
const volumeValue = $('#volumeValue');
const queueList = $('#queueList');
const emptyQueue = $('#emptyQueue');
const queueCount = $('#queueCount');

// ---------- YOUTUBE API ----------
let ytReady = false;
let pendingVideoId = null;

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    onYouTubeIframeAPIReady();
    return;
  }
  const tag = document.createElement('script');
  tag.src = YT_API_URL;
  document.head.appendChild(tag);
}

// Called automatically by the YouTube API script when it is ready
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  createPlayer();
};

function createPlayer() {
  player = new YT.Player('playerIFrame', {
    height: '0',
    width: '0',
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
}

function onPlayerReady(event) {
  if (pendingVideoId) {
    event.target.loadVideoById(pendingVideoId);
    pendingVideoId = null;
  } else if (currentIndex >= 0) {
    loadTrack(currentIndex);
  }
}

// ---------- VIDEO ID EXTRACTION ----------
function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    // youtube.com/watch?v=...
    if (parsed.hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    // youtu.be/...
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.substring(1);
    }
    // youtube.com/embed/...
    if (parsed.pathname.startsWith('/embed/')) {
      return parsed.pathname.split('/')[2];
    }
    // youtube.com/shorts/...
    if (parsed.pathname.startsWith('/shorts/')) {
      return parsed.pathname.split('/')[2];
    }
    // Live streams: youtube.com/live/VIDEO_ID
    if (parsed.pathname.startsWith('/live/')) {
      return parsed.pathname.split('/')[2];
    }
  } catch (e) {
    return null;
  }
  return null;
}

function validateUrl(url) {
  if (!url || !url.trim()) return 'Please enter a YouTube URL.';
  const id = extractVideoId(url);
  if (!id) return 'That does not look like a valid YouTube URL.';
  return id;
}

// ---------- METADATA ----------
async function fetchMetadata(videoId) {
  const cached = getCache(videoId);
  if (cached) return cached;

  try {
    // Use the public oEmbed endpoint (no API key required)
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        'https://www.youtube.com/watch?v=' + videoId
      )}&format=json`
    );
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    const meta = {
      title: data.title || 'YouTube video',
      channel: data.author_name || 'Unknown channel',
    };
    setCache(videoId, meta);
    return meta;
  } catch (e) {
    // Fall back to a generic label
    return { title: 'YouTube video', channel: 'Unknown channel' };
  }
}

// Simple in-memory + localStorage cache for metadata
function getCache(id) {
  try {
    const store = JSON.parse(localStorage.getItem('ender_radio_meta') || '{}');
    return store[id] || null;
  } catch (e) {
    return null;
  }
}

function setCache(id, meta) {
  try {
    const store = JSON.parse(localStorage.getItem('ender_radio_meta') || '{}');
    store[id] = meta;
    localStorage.setItem('ender_radio_meta', JSON.stringify(store));
  } catch (e) {
    /* ignore storage errors */
  }
}

// ---------- QUEUE MANAGEMENT ----------
function saveQueue() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    /* ignore */
  }
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      queue = JSON.parse(raw);
    }
  } catch (e) {
    queue = [];
  }
  currentIndex = -1;
}

function renderQueue() {
  queueList.innerHTML = '';
  queueCount.textContent = queue.length + (queue.length === 1 ? ' song' : ' songs');
  emptyQueue.classList.toggle('hidden', queue.length > 0);

  queue.forEach((track, i) => {
    const li = document.createElement('li');
    if (i === currentIndex) li.classList.add('playing');

    const indexSpan = document.createElement('span');
    indexSpan.className = 'queue-index';
    indexSpan.textContent = (i + 1) + '.';

    const info = document.createElement('div');
    info.className = 'queue-info';
    const title = document.createElement('div');
    title.className = 'queue-title';
    title.textContent = track.title;
    const channel = document.createElement('div');
    channel.className = 'queue-channel';
    channel.textContent = track.channel;
    info.appendChild(title);
    info.appendChild(channel);

    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    const playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.title = 'Play';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playTrack(i);
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Remove';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTrack(i);
    });
    actions.appendChild(playBtn);
    actions.appendChild(delBtn);

    li.appendChild(indexSpan);
    li.appendChild(info);
    li.appendChild(actions);

    li.addEventListener('click', () => playTrack(i));

    queueList.appendChild(li);
  });
}

async function addTrackFromInput() {
  errorBox.classList.add('hidden');
  const url = urlInput.value.trim();
  const id = validateUrl(url);

  if (!isVideoId(id)) {
    // Not a valid id => validateUrl returned an error message
    errorBox.textContent = id;
    errorBox.classList.remove('hidden');
    return;
  }

  // Prevent duplicates
  if (queue.some((t) => t.id === id)) {
    errorBox.textContent = 'This video is already in your queue.';
    errorBox.classList.remove('hidden');
    return;
  }

  const meta = await fetchMetadata(id);
  queue.push({ id, title: meta.title, channel: meta.channel });
  saveQueue();
  renderQueue();
  urlInput.value = '';

  // If nothing is playing yet, start this song
  if (currentIndex < 0) {
    playTrack(queue.length - 1);
  }
}

function isVideoId(s) {
  // A valid YouTube video id is 11 chars
  return /^[A-Za-z0-9_-]{11}$/.test(s);
}

function removeTrack(index) {
  queue.splice(index, 1);
  // Fix currentIndex if needed
  if (index < currentIndex) {
    currentIndex -= 1;
  } else if (index === currentIndex) {
    currentIndex = -1;
    pausePlayer();
    resetPlayerUI();
  }
  saveQueue();
  renderQueue();
  if (queue.length === 0) {
    trackTitle.textContent = 'Nothing playing';
    trackChannel.textContent = '';
    art.textContent = '🎵';
    playButton.textContent = '▶';
  }
}

// ---------- PLAYBACK ----------
function playTrack(index) {
  if (index < 0 || index >= queue.length) return;
  currentIndex = index;
  loadTrack(index);
  renderQueue();
}

function loadTrack(index) {
  const track = queue[index];
  trackTitle.textContent = track.title;
  trackChannel.textContent = track.channel;
  art.textContent = '🎵';
  seekBar.value = 0;
  currentTimeEl.textContent = '0:00';
  durationTimeEl.textContent = '0:00';

  if (!player) {
    pendingVideoId = track.id;
    return;
  }
  player.loadVideoById(track.id);
}

function playPause() {
  if (queue.length === 0) return;
  if (currentIndex < 0) {
    playTrack(0);
    return;
  }
  const state = player ? player.getPlayerState() : -1;
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

function nextTrack() {
  if (queue.length === 0) return;
  let next;
  if (isShuffle) {
    shufflePos += 1;
    if (shufflePos >= shuffleOrder.length) {
      shuffleOrder = buildShuffleOrder();
      shufflePos = 0;
    }
    next = shuffleOrder[shufflePos];
  } else {
    next = (currentIndex + 1) % queue.length;
  }
  playTrack(next);
}

function prevTrack() {
  if (queue.length === 0) return;
  if (currentIndex > 0) {
    playTrack(currentIndex - 1);
  } else {
    playTrack(queue.length - 1);
  }
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  shuffleButton.classList.toggle('active', isShuffle);
  shuffleButton.style.background = isShuffle ? '#e63946' : '';
  shuffleButton.style.color = isShuffle ? '#fff' : '';
  if (isShuffle && currentIndex >= 0) {
    shuffleOrder = buildShuffleOrder(currentIndex);
    shufflePos = 0;
  }
}

function buildShuffleOrder(startFromCurrent) {
  const arr = queue.map((_, i) => i);
  // simple shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (startFromCurrent !== undefined) {
    const pos = arr.indexOf(startFromCurrent);
    if (pos > 0) {
      arr.splice(pos, 1);
      arr.unshift(startFromCurrent);
    }
  }
  return arr;
}

function pausePlayer() {
  if (player) player.pauseVideo();
}

function resetPlayerUI() {
  seekBar.value = 0;
  currentTimeEl.textContent = '0:00';
  durationTimeEl.textContent = '0:00';
  playButton.textContent = '▶';
}

// ---------- PLAYER EVENTS ----------
function onPlayerStateChange(event) {
  const playing = event.data === YT.PlayerState.PLAYING;
  playButton.textContent = playing ? '⏸' : '▶';
  if (event.data === YT.PlayerState.ENDED) {
    nextTrack();
  }
}

function onPlayerError(event) {
  errorBox.textContent = 'Could not play that video (it may be unavailable or blocked).';
  errorBox.classList.remove('hidden');
  setTimeout(() => {
    nextTrack();
  }, 800);
}

// ---------- TIME & PROGRESS ----------
setInterval(() => {
  if (!player || currentIndex < 0) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED) {
    const dur = player.getDuration() || 0;
    const cur = player.getCurrentTime() || 0;
    if (dur > 0) {
      seekBar.max = dur;
      seekBar.value = cur;
      currentTimeEl.textContent = formatTime(cur);
      durationTimeEl.textContent = formatTime(dur);
    }
  }
}, 500);

function formatTime(sec) {
  sec = Math.floor(sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// ---------- USER INPUT ----------
seekBar.addEventListener('input', () => {
  if (player && currentIndex >= 0) {
    player.seekTo(parseFloat(seekBar.value), true);
  }
});

volumeBar.addEventListener('input', () => {
  const v = parseInt(volumeBar.value, 10);
  volumeValue.textContent = v + '%';
  if (player) player.setVolume(v);
});

addButton.addEventListener('click', addTrackFromInput);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTrackFromInput();
});
playButton.addEventListener('click', playPause);
nextButton.addEventListener('click', nextTrack);
prevButton.addEventListener('click', prevTrack);
shuffleButton.addEventListener('click', toggleShuffle);

// ---------- INIT ----------
loadQueue();
renderQueue();
loadYouTubeAPI();
