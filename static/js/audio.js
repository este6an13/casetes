/**
 * audio.js — Global audio player and radio mode for the music library.
 *
 * Depends on: Utils (utils.js)
 * Communicates with Library via callbacks set during init.
 */
const AudioPlayer = (function () {
    'use strict';

    let allTracks = [];
    let globalAudio = null;
    let currentPlayingId = null;
    let isRadioMode = false;
    let radioHistory = [];

    /* ── Callbacks (set by Library) ── */
    let onStopCallback = null;   // called when audio stops entirely

    /* ── Initialization ── */
    function init(tracks, opts = {}) {
        allTracks = tracks;
        if (opts.onStop) onStopCallback = opts.onStop;

        globalAudio = document.getElementById('global-audio');
        if (globalAudio) {
            globalAudio.addEventListener('play', updateGlobalAudioUI);
            globalAudio.addEventListener('pause', updateGlobalAudioUI);
            globalAudio.addEventListener('ended', () => {
                updateGlobalAudioUI();
                if (isRadioMode) {
                    playNextRadioTrack();
                } else {
                    stopGlobalAudio();
                }
            });
        }
    }

    /* ── Play Track ──
     * Tries the embedded preview_url first. If playback fails (e.g. URL
     * expired), falls back to fetching a fresh URL from the API.
     */
    async function playTrack(deezerId) {
        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track) {
            console.warn("Track not found in library.");
            return;
        }

        if (currentPlayingId === deezerId) {
            toggleGlobalPlay();
            return;
        }

        currentPlayingId = deezerId;

        // Update Now Playing bar UI eagerly
        document.getElementById('np-title').textContent = track.title;
        document.getElementById('np-artist').textContent = track.artist;
        const imgBase = window.IMAGE_BASE_URL || '/';
        document.getElementById('np-cover').src = track.cover ? imgBase + track.cover : '';
        document.getElementById('now-playing-bar').classList.add('active');

        // Show loading indicator
        const npIcon = document.getElementById('np-play-icon');
        if (npIcon) npIcon.textContent = 'hourglass_empty';

        if (!track.preview_url) {
            // No URL at all — try fetching a fresh one from the API
            const freshUrl = await fetchFreshPreviewUrl(deezerId);
            if (freshUrl) {
                track.preview_url = freshUrl;
            } else {
                if (isRadioMode) {
                    playNextRadioTrack(true);
                } else {
                    alert("No preview is available for this track.");
                    stopGlobalAudio();
                }
                return;
            }
        }

        // Attempt 1: Use the embedded/cached preview URL
        globalAudio.src = track.preview_url;
        try {
            await globalAudio.play();
        } catch (e) {
            console.warn("Embedded preview URL failed, fetching fresh URL...", e.message);

            // Attempt 2: Fetch a fresh preview URL from the API
            const freshUrl = await fetchFreshPreviewUrl(deezerId);
            if (freshUrl) {
                track.preview_url = freshUrl;
                globalAudio.src = freshUrl;
                try {
                    await globalAudio.play();
                } catch (e2) {
                    console.error("Fresh preview URL also failed:", e2);
                    if (isRadioMode) {
                        playNextRadioTrack(true);
                    } else {
                        alert("Could not play song preview.");
                        stopGlobalAudio();
                    }
                    return;
                }
            } else {
                if (isRadioMode) {
                    playNextRadioTrack(true);
                } else {
                    alert("Could not load song preview from Deezer.");
                    stopGlobalAudio();
                }
                return;
            }
        }

        // Push to radio history
        if (radioHistory[radioHistory.length - 1] !== deezerId) {
            radioHistory.push(deezerId);
        }
        updateGlobalAudioUI();
    }

    /* ── Fetch a fresh preview URL from the API (fallback) ── */
    async function fetchFreshPreviewUrl(deezerId) {
        try {
            const resp = await fetch('/api/fetch-track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deezer_id: deezerId })
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            return data.preview_url || null;
        } catch (e) {
            console.error("Error fetching fresh preview URL:", e);
            return null;
        }
    }

    /* ── Global Audio Controls ── */
    function toggleGlobalPlay() {
        if (!globalAudio || !globalAudio.src) return;
        if (globalAudio.paused) {
            globalAudio.play();
        } else {
            globalAudio.pause();
        }
        updateGlobalAudioUI();
    }

    function stopGlobalAudio() {
        globalAudio.pause();
        globalAudio.currentTime = 0;
        currentPlayingId = null;
        isRadioMode = false;

        // Hide bar
        document.getElementById('now-playing-bar').classList.remove('active');
        document.getElementById('now-playing-bar').classList.remove('is-playing');

        // Reset all grid buttons
        document.querySelectorAll('.card-play-btn .material-symbols-outlined').forEach(icon => {
            icon.textContent = 'play_arrow';
        });
        // Reset modal button if open
        const modalIcon = document.getElementById('detail-play-icon');
        if (modalIcon) modalIcon.textContent = 'play_arrow';

        if (onStopCallback) onStopCallback();
    }

    function toggleDetailPreview(deezerId) {
        if (!deezerId) {
            if (!currentPlayingId) return;
            toggleGlobalPlay();
            return;
        }
        isRadioMode = false;
        playTrack(deezerId);
    }

    function toggleInlinePlay(deezerId, btn) {
        // Clicking a track in the grid disables radio mode
        isRadioMode = false;
        playTrack(deezerId);
    }

    /* ── UI Updates ── */
    function updateGlobalAudioUI() {
        const isPaused = globalAudio.paused;
        const npIcon = document.getElementById('np-play-icon');
        const npBar = document.getElementById('now-playing-bar');

        if (npIcon) npIcon.textContent = isPaused ? 'play_arrow' : 'pause';
        if (isPaused) {
            npBar.classList.remove('is-playing');
        } else {
            npBar.classList.add('is-playing');
        }

        // Reset all secondary UI buttons
        document.querySelectorAll('.card-play-btn .material-symbols-outlined').forEach(icon => {
            icon.textContent = 'play_arrow';
        });
        const activeCardBtn = document.querySelector(`.card-play-btn[data-deezer-id="${currentPlayingId}"] .material-symbols-outlined`);
        if (activeCardBtn) activeCardBtn.textContent = isPaused ? 'play_arrow' : 'pause';

        const modalBtn = document.querySelector('.detail-play-btn');
        const modalIcon = document.getElementById('detail-play-icon');
        if (modalBtn && modalIcon) {
            const modalId = modalBtn.getAttribute('data-deezer-id');
            if (modalId === String(currentPlayingId) && !isPaused) {
                modalIcon.textContent = 'pause';
            } else {
                modalIcon.textContent = 'play_arrow';
            }
        } else if (modalIcon) {
            modalIcon.textContent = isPaused ? 'play_arrow' : 'pause';
        }
    }

    /* ── Radio Mode ── */
    function startRadioMode() {
        const playableTracks = allTracks.filter(t => t.preview_url);
        if (!playableTracks || playableTracks.length === 0) {
            alert("Library has no playable songs (no previews available). Cannot start radio.");
            return;
        }
        isRadioMode = true;
        if (currentPlayingId) {
            alert("Radio mode activated from current track.");
            return;
        }
        let startIndex = Math.floor(Math.random() * playableTracks.length);
        playTrack(playableTracks[startIndex].deezer_id);
    }

    function playPrevRadioTrack() {
        if (radioHistory.length > 1) {
            radioHistory.pop();
            const prevId = radioHistory[radioHistory.length - 1];
            playTrack(prevId);
            isRadioMode = true;
        } else {
            globalAudio.currentTime = 0;
            globalAudio.play();
        }
    }

    function playNextRadioTrack(manualSkip = false) {
        if (!isRadioMode && !manualSkip) return;
        isRadioMode = true;

        const currentTrack = allTracks.find(t => t.deezer_id === currentPlayingId);

        const recentHistory = radioHistory.slice(-10);
        const candidatePool = allTracks.filter(t => t.preview_url && !recentHistory.includes(t.deezer_id));

        if (candidatePool.length === 0) {
            radioHistory = [currentPlayingId];
            const fallbackPool = allTracks.filter(t => t.preview_url && t.deezer_id !== currentPlayingId);
            if (fallbackPool.length > 0) {
                const idx = Math.floor(Math.random() * fallbackPool.length);
                playTrack(fallbackPool[idx].deezer_id);
            } else {
                stopGlobalAudio();
            }
            return;
        }

        // Build recent-artist list for anti-clustering
        const recentArtists = radioHistory.slice(-5).map(id => {
            const t = allTracks.find(tr => tr.deezer_id === id);
            return t ? t.artist : null;
        }).filter(Boolean);

        // Score each candidate with mild affinity + anti-clustering
        const scored = candidatePool.map(candidate => {
            let score = 1; // base — everyone has a chance

            if (currentTrack) {
                // Mild tag affinity
                if (currentTrack.tags && candidate.tags) {
                    const commonTags = currentTrack.tags.filter(tag => candidate.tags.includes(tag));
                    score += commonTags.length * 0.5;
                }
                // Mild era affinity
                if (currentTrack.release_year && candidate.release_year) {
                    const diff = Math.abs(currentTrack.release_year - candidate.release_year);
                    if (diff <= 5) score += 0.5;
                }
            }

            // Anti-clustering: heavily penalize artists heard recently
            const artistRecentCount = recentArtists.filter(a => a === candidate.artist).length;
            if (artistRecentCount > 0) {
                score *= Math.pow(0.15, artistRecentCount);
            }

            return { id: candidate.deezer_id, score: Math.max(score, 0.01) };
        });

        // Weighted random selection (not argmax)
        const totalScore = scored.reduce((sum, s) => sum + s.score, 0);
        let roll = Math.random() * totalScore;
        let nextTrackId = scored[scored.length - 1].id;
        for (const entry of scored) {
            roll -= entry.score;
            if (roll <= 0) {
                nextTrackId = entry.id;
                break;
            }
        }

        playTrack(nextTrackId);
    }

    /* ── Getters ── */
    function getCurrentPlayingId() {
        return currentPlayingId;
    }

    function isPlaying() {
        return globalAudio && !globalAudio.paused;
    }

    /* ── Public Interface ── */
    return {
        init,
        playTrack,
        toggleGlobalPlay,
        stopGlobalAudio,
        toggleDetailPreview,
        toggleInlinePlay,
        startRadioMode,
        playPrevRadioTrack,
        playNextRadioTrack,
        getCurrentPlayingId,
        isPlaying,
    };
})();
