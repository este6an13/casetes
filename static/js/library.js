/**
 * Library.js — Client-side rendering engine for the music library.
 * Handles grid rendering, search, tag filtering, browse-mode categories
 * (artist / year / tag / album), and track detail modal.
 */
const Library = (function () {
    'use strict';

    let allTracks = [];
    let currentTracks = [];
    let currentQuery = '';
    let currentTag = '';
    let browseMode = 'none';     // 'none' | 'artist' | 'year' | 'tag' | 'album'
    let browseFilter = null;     // { mode: 'artist', value: 'Daft Punk' } when drilled in

    /* ── Global Audio & Radio State ── */
    let globalAudio = null;
    let currentPlayingId = null;
    let isRadioMode = false;
    let radioHistory = [];    // Array of deezer_id strings
    let radioQueue = [];      // Future queue if needed, though we primarily generate next-up on the fly

    /* ── Playlist State ── */
    let playlistMode = false;
    let selectedPlaylistTracks = new Set(); // Stores deezer_id strings

    /* ── Initialization ── */
    function init(tracks) {
        allTracks = tracks;

        // Initialize Global Audio Events
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

        applyFiltersAndRender();
    }

    /* ── Filtering & Rendering Pipeline ── */
    function applyFiltersAndRender() {
        let filtered = allTracks.slice();

        // Tag filter (from tag chip click)
        if (currentTag) {
            filtered = filtered.filter(t =>
                t.tags && t.tags.some(tag => tag.toLowerCase() === currentTag.toLowerCase())
            );
        }

        // Browse drill-in filter (e.g., artist = "Daft Punk")
        if (browseFilter) {
            filtered = filtered.filter(t => {
                if (browseFilter.mode === 'artist') return t.artist === browseFilter.value;
                if (browseFilter.mode === 'album') return t.album === browseFilter.value;
                if (browseFilter.mode === 'year') return String(t.release_year || '') === browseFilter.value;
                if (browseFilter.mode === 'tag') return t.tags && t.tags.includes(browseFilter.value);
                return true;
            });
        }

        // Search filter
        if (currentQuery) {
            const q = currentQuery.toLowerCase();
            filtered = filtered.filter(t =>
                (t.title || '').toLowerCase().includes(q) ||
                (t.artist || '').toLowerCase().includes(q) ||
                (t.album || '').toLowerCase().includes(q) ||
                (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
            );
        }

        // Shuffle tracks randomly (Fisher-Yates)
        for (let i = filtered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = filtered[i];
            filtered[i] = filtered[j];
            filtered[j] = temp;
        }

        currentTracks = filtered;
        renderTrackGrid(filtered);
        updateTrackCount(filtered.length);
    }

    /* ── Track Grid Rendering ── */
    function renderTrackGrid(tracks) {
        const container = document.getElementById('track-grid');
        if (!container) return;

        if (tracks.length === 0) {
            container.innerHTML =
                '<div class="empty-state">' +
                '  <p class="empty-icon">♪</p>' +
                '  <p class="empty-title">No songs yet</p>' +
                '  <p class="empty-hint">' + (allTracks.length === 0
                    ? 'Add your first song to get started.'
                    : 'Try adjusting your search or filters.') + '</p>' +
                (allTracks.length === 0
                    ? '<a href="/add" class="btn btn-primary" style="margin-top: 1rem;">Add Song</a>'
                    : '') +
                '</div>';
            return;
        }

        let html = '<div class="track-grid">';
        tracks.forEach((track, ti) => {
            const delay = Math.min(ti * 0.04, 0.5);
            const isSelected = selectedPlaylistTracks.has(String(track.deezer_id));
            const selectedClass = isSelected ? ' selected' : '';
            html += '<div class="track-card skeleton-loading' + selectedClass + '" data-deezer-id="' + escapeAttr(track.deezer_id) + '" onclick="Library.openDetail(\'' + escapeAttr(track.deezer_id) + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
            html += '<div class="track-cover-wrapper">';
            if (track.cover) {
                html += '<img class="track-cover" src="/' + escapeAttr(track.cover) + '" alt="' + escapeAttr(track.title) + '" loading="lazy" onload="this.closest(\'.track-card\').classList.remove(\'skeleton-loading\')">';
            } else {
                html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
            }
            
            // Checkbox overlay for playlist mode
            html += '<div class="playlist-checkbox ' + (isSelected ? 'checked' : '') + '">';
            html += '<span class="material-symbols-outlined check-icon">check_circle</span>';
            html += '</div>';

            html += '<div class="track-overlay"></div>';
            if (track.preview_url) {
                html += '<button class="card-play-btn" data-deezer-id="' + escapeAttr(track.deezer_id) + '" onclick="event.stopPropagation(); Library.toggleInlinePlay(\'' + escapeAttr(track.deezer_id) + '\', this)" title="Play preview">';
                html += '<span class="material-symbols-outlined">' + (currentPlayingId === track.deezer_id ? 'pause' : 'play_arrow') + '</span>';
                html += '</button>';
            }
            html += '</div>';
            html += '<div class="track-card-info">';
            html += '<div class="track-card-title">' + escapeHtml(track.title) + '</div>';
            html += '<div class="track-card-artist">' + escapeHtml(track.artist) + '</div>';
            html += '</div></div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    /* ── Browse Mode (category cards like photo-gallery albums) ── */
    function renderBrowseGrid(mode) {
        const container = document.getElementById('track-grid');
        if (!container) return;

        // Build category data from all tracks
        const categories = {};
        allTracks.forEach(t => {
            let keys = [];
            if (mode === 'artist') {
                keys = [t.artist || 'Unknown'];
            } else if (mode === 'album') {
                keys = [t.album || 'Unknown'];
            } else if (mode === 'year') {
                keys = [t.release_year ? String(t.release_year) : 'Unknown'];
            } else if (mode === 'tag') {
                keys = (t.tags && t.tags.length > 0) ? t.tags : ['Untagged'];
            }

            keys.forEach(key => {
                if (!categories[key]) {
                    categories[key] = { name: key, count: 0, cover: null, newestDate: '' };
                }
                categories[key].count++;
                // Use newest track's cover as the category cover
                const date = t.added_at || '';
                if (date > categories[key].newestDate) {
                    categories[key].newestDate = date;
                    categories[key].cover = t.cover;
                }
            });
        });

        // Sort categories
        const sorted = Object.values(categories).sort((a, b) => {
            if (a.name === 'Unknown' || a.name === 'Untagged') return 1;
            if (b.name === 'Unknown' || b.name === 'Untagged') return -1;
            if (mode === 'year') return parseInt(b.name) - parseInt(a.name);
            return b.count - a.count; // Most songs first
        });

        if (sorted.length === 0) {
            container.innerHTML =
                '<div class="empty-state">' +
                '  <p class="empty-icon">📁</p>' +
                '  <p class="empty-title">Nothing here</p>' +
                '  <p class="empty-hint">Add some songs to browse by ' + mode + '.</p>' +
                '</div>';
            return;
        }

        let html = '<div class="browse-grid">';
        sorted.forEach((cat, i) => {
            const delay = Math.min(i * 0.04, 0.5);
            const escapedName = escapeAttr(cat.name.replace(/'/g, "\\'"));
            html += '<div class="browse-card" onclick="Library.selectBrowseItem(\'' + escapedName + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
            html += '<div class="browse-cover-wrapper">';
            if (cat.cover) {
                html += '<img class="browse-cover" src="/' + escapeAttr(cat.cover) + '" alt="' + escapeAttr(cat.name) + '" loading="lazy">';
            } else {
                html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
            }
            html += '</div>';
            html += '<div class="browse-card-info">';
            html += '<div class="browse-card-name">' + escapeHtml(cat.name) + '</div>';
            html += '<div class="browse-card-count">' + cat.count + ' song' + (cat.count !== 1 ? 's' : '') + '</div>';
            html += '</div></div>';
        });
        html += '</div>';

        container.innerHTML = html;
        updateTrackCount(allTracks.length);
    }

    /* ── Browse Mode Toggle ── */
    function groupBy(mode) {
        // If clicking the same mode while browsing, exit browse mode
        if (browseMode === mode && !browseFilter) {
            exitBrowse();
            return;
        }

        // If we have a filter active for this mode, clear it and show browse cards again
        if (browseFilter && browseFilter.mode === mode) {
            browseFilter = null;
            clearFilterUI();
        }

        browseMode = mode;
        browseFilter = null;

        // Clear other filters
        currentTag = '';
        currentQuery = '';
        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';
        clearTagUI();
        clearFilterUI();

        // Update button states
        updateBrowseButtons(mode);

        // Show browse indicator
        const indicator = document.getElementById('active-group-indicator');
        const text = document.getElementById('active-group-text');
        const icon = document.getElementById('group-icon');
        if (indicator && text) {
            const labels = { artist: 'Artist', year: 'Year', tag: 'Tag', album: 'Album' };
            const icons = { artist: 'person', year: 'calendar_month', tag: 'label', album: 'album' };
            text.textContent = 'by ' + labels[mode];
            if (icon) icon.textContent = icons[mode];
            indicator.style.display = 'inline-flex';
        }

        renderBrowseGrid(mode);
    }

    function selectBrowseItem(value) {
        browseFilter = { mode: browseMode, value: value };

        // Show filter chip
        const indicator = document.getElementById('active-tag-indicator');
        const text = document.getElementById('active-tag-text');
        if (indicator && text) {
            text.textContent = value;
            indicator.style.display = 'inline-flex';
        }

        applyFiltersAndRender();
    }

    function exitBrowse() {
        browseMode = 'none';
        browseFilter = null;
        updateBrowseButtons('none');
        clearFilterUI();

        const groupIndicator = document.getElementById('active-group-indicator');
        if (groupIndicator) groupIndicator.style.display = 'none';

        applyFiltersAndRender();
    }

    function updateBrowseButtons(activeMode) {
        ['artist', 'year', 'tag', 'album'].forEach(m => {
            const btn = document.getElementById('group-' + m + '-btn');
            if (btn) btn.classList.toggle('active', m === activeMode);
        });
    }

    function clearFilterUI() {
        const tagIndicator = document.getElementById('active-tag-indicator');
        if (tagIndicator) tagIndicator.style.display = 'none';
    }

    function clearTagUI() {
        clearFilterUI();
    }

    /* ── Track Detail Modal or Playlist Selection ── */
    function openDetail(deezerId) {
        if (playlistMode) {
            toggleTrackSelection(deezerId);
            return;
        }

        const track = currentTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;

        let html = '<div class="detail-card">';
        html += '<button class="detail-close" onclick="closeModal()" aria-label="Close">&#10005;</button>';

        // Cover
        html += '<div class="detail-cover-wrapper">';
        if (track.cover) {
            html += '<img class="detail-cover" src="/' + escapeAttr(track.cover) + '" alt="' + escapeAttr(track.title) + '">';
        }
        if (track.preview_url) {
            html += '<button class="detail-play-btn" onclick="Library.toggleDetailPreview()" title="Play preview">';
            html += '<span class="material-symbols-outlined" id="detail-play-icon">play_arrow</span>';
            html += '</button>';
            html += '<audio id="detail-audio" src="' + escapeAttr(track.preview_url) + '" preload="none"></audio>';
        }
        html += '</div>';

        // Info
        html += '<div class="detail-info">';
        html += '<h2 class="detail-title">' + escapeHtml(track.title) + '</h2>';
        html += '<p class="detail-artist">' + escapeHtml(track.artist) + '</p>';

        html += '<div class="detail-meta">';
        html += '<div class="detail-meta-row"><span class="detail-meta-label">Album</span><span class="detail-meta-value">' + escapeHtml(track.album) + '</span></div>';
        if (track.release_year) {
            html += '<div class="detail-meta-row"><span class="detail-meta-label">Year</span><span class="detail-meta-value">' + track.release_year + '</span></div>';
        }
        if (track.duration) {
            const mins = Math.floor(track.duration / 60);
            const secs = track.duration % 60;
            html += '<div class="detail-meta-row"><span class="detail-meta-label">Duration</span><span class="detail-meta-value">' + mins + ':' + String(secs).padStart(2, '0') + '</span></div>';
        }
        html += '</div>';

        // Tags Container
        html += '<div class="detail-tags-container" id="detail-tags-container">';
        html += renderTagsUI(track);
        html += '</div>';

        // Links
        html += '<div class="detail-links">';
        
        let queryStr = encodeURIComponent(track.artist + ' ' + track.title);
        if (track.isrc) {
             queryStr = "isrc:" + track.isrc;
        }

        html += '<a href="https://www.deezer.com/track/' + escapeAttr(track.deezer_id) + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Open in Deezer">';
        html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">graphic_eq</span><span class="detail-link-text">Deezer</span></a>';
        
        html += '<a href="https://open.spotify.com/search/' + queryStr + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on Spotify">';
        html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">headphones</span><span class="detail-link-text">Spotify</span></a>';

        const appleQuery = encodeURIComponent(track.title + ' ' + track.artist);
        html += '<a href="https://music.apple.com/WebObjects/MZStore.woa/wa/search?term=' + appleQuery + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on Apple Music">';
        html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">music_note</span><span class="detail-link-text">Apple</span></a>';

        html += '<a href="https://music.youtube.com/search?q=' + appleQuery + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on YouTube Music">';
        html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">play_circle</span><span class="detail-link-text">YouTube</span></a>';
        html += '</div>';

        html += '<div class="detail-links" style="margin-top: auto; border-top: 1px solid var(--border-hover); padding-top: 0.8rem; justify-content: space-between;">';
        if (window.__ADMIN_MODE) {
            html += '<button class="detail-link" onclick="event.stopPropagation(); Library.refetchTrack(\'' + escapeAttr(track.deezer_id) + '\')" title="Refetch Data" style="color: var(--text-primary);">';
            html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">sync</span><span class="detail-link-text">Refetch</span></button>';

            html += '<button class="detail-delete" onclick="event.stopPropagation(); Library.deleteTrack(\'' + escapeAttr(track.deezer_id) + '\')" title="Remove from Library">';
            html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span><span class="detail-link-text">Remove</span></button>';
        }
        html += '</div>';

        html += '</div></div>';

        document.getElementById('modal-content').innerHTML = html;
        document.getElementById('track-modal').classList.add('active');
        document.body.classList.add('modal-open');
    }

    function openRandomSong() {
        if (!allTracks || allTracks.length === 0) {
            alert("Your library is empty. Add some tracks first!");
            return;
        }
        const randomIndex = Math.floor(Math.random() * allTracks.length);
        const randomTrack = allTracks[randomIndex];
        openDetail(randomTrack.deezer_id);
    }

    function toggleDetailPreview() {
        if (!currentPlayingId) return;
        toggleGlobalPlay();
    }

    /* ── Global Audio Player Logic ── */
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
    }

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
        
        // Eagerly update UI
        document.getElementById('np-title').textContent = track.title;
        document.getElementById('np-artist').textContent = track.artist;
        if (track.cover) {
            document.getElementById('np-cover').src = '/' + track.cover;
        } else {
            document.getElementById('np-cover').src = '';
        }
        document.getElementById('now-playing-bar').classList.add('active');
        
        // Show loading state while fetching fresh URL (optional UI flair, or simply enforce play icon)
        const npIcon = document.getElementById('np-play-icon');
        if (npIcon) npIcon.textContent = 'hourglass_empty';

        try {
            const resp = await fetch('/api/fetch-track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deezer_id: deezerId })
            });
            if (!resp.ok) throw new Error("Network request failed");
            const freshData = await resp.json();
            
            if (!freshData.preview_url) {
                alert("No preview is available for this track on Deezer.");
                stopGlobalAudio();
                return;
            }
            // Update the stored url so next time it might work without fetch if played immediately (though we always fetch)
            track.preview_url = freshData.preview_url;
            
            globalAudio.src = freshData.preview_url;
            await globalAudio.play();
        } catch (e) {
            console.error("Error loading fresh preview:", e);
            alert("Could not load song preview from Deezer.");
            stopGlobalAudio();
            return;
        }

        // Push to history if we're naturally navigating or starting
        if (radioHistory[radioHistory.length - 1] !== deezerId) {
            radioHistory.push(deezerId);
        }
        updateGlobalAudioUI();
    }

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

        const modalIcon = document.getElementById('detail-play-icon');
        if (modalIcon) modalIcon.textContent = isPaused ? 'play_arrow' : 'pause';
    }



    function toggleInlinePlay(deezerId, btn) {
        // If user clicks a track in the grid, disable radio mode so it doesn't auto-skip when ended.
        isRadioMode = false; 
        playTrack(deezerId);
    }

    /* ── Autoplay Radio Engine ── */
    function startRadioMode() {
        if (!allTracks || allTracks.length === 0) {
            alert("Library is empty. Cannot start radio.");
            return;
        }
        isRadioMode = true;
        // Start with a totally random track if not already playing
        let startIndex = Math.floor(Math.random() * allTracks.length);
        if (currentPlayingId) {
            // Already playing something, just ensure radio mode is active and we continue.
            alert("Radio mode activated from current track.");
            return;
        }
        playTrack(allTracks[startIndex].deezer_id);
    }

    function playPrevRadioTrack() {
        if (radioHistory.length > 1) {
            // pop current
            radioHistory.pop();
            // get previous
            const prevId = radioHistory[radioHistory.length - 1];
            playTrack(prevId);
            isRadioMode = true; // ensure it stays on
        } else {
            // Just restart current song
            globalAudio.currentTime = 0;
            globalAudio.play();
        }
    }

    function playNextRadioTrack(manualSkip = false) {
        if (!isRadioMode && !manualSkip) return; // shouldn't happen via organic ended event but safety check
        isRadioMode = true; // force if manual skip
        
        const currentTrack = allTracks.find(t => t.deezer_id === currentPlayingId);
        let bestScore = -1;
        let nextTrackId = null;

        // Ensure we only select from tracks possessing a preview URL and not recently played
        const recentHistory = radioHistory.slice(-10); // Don't repeat last 10 songs
        
        const candidatePool = allTracks.filter(t => t.preview_url && !recentHistory.includes(t.deezer_id));
        
        if (candidatePool.length === 0) {
            // We exhausted the pool or the library is very small. Clear history and pick randomly.
            radioHistory = [currentPlayingId];
            const fallbackPool = allTracks.filter(t => t.preview_url && t.deezer_id !== currentPlayingId);
            if (fallbackPool.length > 0) {
                nextTrackId = fallbackPool[Math.floor(Math.random() * fallbackPool.length)].deezer_id;
            } else {
                stopGlobalAudio();
                return; // Nothing else to play
            }
        } else {
            // Score candidates
            candidatePool.forEach(candidate => {
                let score = 0;
                if (currentTrack) {
                    // +5 matching artist
                    if (currentTrack.artist === candidate.artist) score += 5;
                    // +2 per matching tag
                    if (currentTrack.tags && candidate.tags) {
                        const commonTags = currentTrack.tags.filter(tag => candidate.tags.includes(tag));
                        score += (commonTags.length * 2);
                    }
                    // +3 within 3 years, +1 within 10 years
                    if (currentTrack.release_year && candidate.release_year) {
                        const diff = Math.abs(currentTrack.release_year - candidate.release_year);
                        if (diff <= 3) score += 3;
                        else if (diff <= 10) score += 1;
                    }
                }
                
                // Add Temperature (0.0 to 3.0 points) to break deterministic loops
                score += (Math.random() * 3.0);
                
                if (score > bestScore) {
                    bestScore = score;
                    nextTrackId = candidate.deezer_id;
                }
            });
        }
        
        if (nextTrackId) {
            playTrack(nextTrackId);
        } else {
            stopGlobalAudio();
        }
    }

    async function deleteTrack(deezerId) {
        if (!confirm('Remove this song from your library?')) return;
        try {
            const resp = await fetch('/api/track/' + deezerId, { method: 'DELETE' });
            if (resp.ok) {
                allTracks = allTracks.filter(t => t.deezer_id !== deezerId);
                window.closeModal();
                // If in browse view after delete, re-render the browse grid
                if (browseMode !== 'none' && !browseFilter) {
                    renderBrowseGrid(browseMode);
                } else {
                    applyFiltersAndRender();
                }
            } else {
                alert('Failed to remove track.');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    async function refetchTrack(deezerId) {
        try {
            const resp = await fetch('/api/track/' + deezerId + '/refetch', { method: 'POST' });
            if (resp.ok) {
                const data = await resp.json();
                const updatedTrack = data.track;
                
                // Update track in allTracks and currentTracks
                allTracks = allTracks.map(t => t.deezer_id === deezerId ? updatedTrack : t);
                currentTracks = currentTracks.map(t => t.deezer_id === deezerId ? updatedTrack : t);

                // Update detail modal UI
                openDetail(deezerId);
                
                // Refresh grid to reflect potentially new cover
                if (browseMode !== 'none' || browseFilter) {
                    applyFiltersAndRender();
                } else {
                    renderTrackGrid(currentTracks);
                }
            } else {
                const errorData = await resp.json();
                alert('Failed to refetch data: ' + (errorData.detail || 'Unknown error'));
            }
        } catch (e) {
            alert('Error refetching: ' + e.message);
        }
    }

    /* ── Edit Tags (Inline inside Detail Modal) ── */
    function renderTagsUI(track) {
        let html = '<div class="detail-tags" style="display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;">';
        if (track.tags && track.tags.length > 0) {
            track.tags.forEach(tag => {
                html += '<button class="detail-tag" onclick="event.stopPropagation(); Library.setTag(\'' + escapeAttr(tag) + '\'); window.closeModal();">' + escapeHtml(tag) + '</button>';
            });
        }
        
        // Only show edit button if in Admin Mode
        if (window.__ADMIN_MODE) {
            html += '<button class="detail-tag detail-tag-edit" onclick="event.stopPropagation(); Library.toggleEditTags(\'' + escapeAttr(track.deezer_id) + '\')" title="Edit tags" style="padding: 0.2rem 0.5rem; background: var(--bg-hover);"><span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">edit</span></button>';
        }
        html += '</div>';
        return html;
    }

    // Temporary state while editing
    let activeEditDeezerId = null;
    let activeEditTags = [];

    function toggleEditTags(deezerId) {
        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;

        activeEditDeezerId = deezerId;
        activeEditTags = [...(track.tags || [])];

        renderTagEditor();
        
        // Focus input automatically
        setTimeout(() => {
            const input = document.getElementById('edit-tag-input-field');
            if (input) input.focus();
        }, 50);
    }

    function renderTagEditor() {
        const container = document.getElementById('detail-tags-container');
        if (!container) return;

        let html = '<div class="tag-edit-area" style="margin-top: 0.5rem;">';
        
        // Chip container
        html += '<div class="tag-input-container" id="inline-tag-input-container" style="background: var(--bg-secondary); border-color: var(--border-hover);">';
        
        activeEditTags.forEach((tag, index) => {
            html += `<div class="tag-chip" style="margin: 0.2rem;">
                        <span>${escapeHtml(tag)}</span>
                        <span style="cursor: pointer; font-size: 1.1rem; line-height: 1; color: var(--text-muted);" onclick="Library.removeEditTag(${index})">&times;</span>
                    </div>`;
        });

        // Input field for new tags
        html += '<input type="text" id="edit-tag-input-field" style="border: none; background: transparent; color: var(--text-primary); flex: 1; min-width: 100px; outline: none; font-family: inherit; font-size: 0.85rem;" placeholder="Add tag...">';
        html += '</div>';

        // Actions
        html += '<div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; justify-content: flex-end;">';
        html += `<button class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="Library.cancelEditTags('${escapeAttr(activeEditDeezerId)}')">Cancel</button>`;
        html += `<button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="Library.saveTags('${escapeAttr(activeEditDeezerId)}')">Save</button>`;
        html += '</div>';
        
        html += '</div>';

        container.innerHTML = html;

        // Attach event listeners
        const input = document.getElementById('edit-tag-input-field');
        const inputContainer = document.getElementById('inline-tag-input-container');

        if (inputContainer && input) {
            inputContainer.addEventListener('click', () => input.focus());
            input.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const val = input.value.trim().replace(/,/g, '');
                    if (val && !activeEditTags.includes(val)) {
                        activeEditTags.push(val);
                        renderTagEditor();
                    }
                } else if (e.key === 'Backspace' && input.value === '' && activeEditTags.length > 0) {
                    activeEditTags.pop();
                    renderTagEditor();
                }
            });
        }
    }

    function removeEditTag(index) {
        if (index >= 0 && index < activeEditTags.length) {
            activeEditTags.splice(index, 1);
            renderTagEditor();
        }
    }

    function cancelEditTags(deezerId) {
        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;
        
        activeEditDeezerId = null;
        activeEditTags = [];
        
        const container = document.getElementById('detail-tags-container');
        if (container) {
            container.innerHTML = renderTagsUI(track);
        }
    }

    async function saveTags(deezerId) {
        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;

        track.tags = [...activeEditTags];
        
        // Revert UI to display mode with new tags
        cancelEditTags(deezerId);

        // Update grid if needed
        if (browseMode !== 'none' || browseFilter) {
            applyFiltersAndRender();
        } else {
            renderTrackGrid(currentTracks);
        }

        try {
            await fetch('/api/track/' + deezerId + '/tags', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: track.tags })
            });
        } catch (e) {
            console.error("Failed to update tags:", e);
        }
    }

    /* ── Search ── */
    function search(query) {
        currentQuery = query.trim();
        // If searching, exit browse mode but keep filter if drilled in
        if (currentQuery && browseMode !== 'none' && !browseFilter) {
            exitBrowse();
        }
        applyFiltersAndRender();
    }

    /* ── Tag Filter (from detail modal tag click) ── */
    function setTag(tagName) {
        // Exit browse mode
        if (browseMode !== 'none') exitBrowse();

        currentTag = tagName;
        currentQuery = '';

        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';

        const indicator = document.getElementById('active-tag-indicator');
        const text = document.getElementById('active-tag-text');
        if (indicator && text) {
            text.textContent = tagName;
            indicator.style.display = 'inline-flex';
        }

        applyFiltersAndRender();
    }

    function clearTag() {
        // If we're in a browse drill-in, go back to browse cards
        if (browseFilter) {
            browseFilter = null;
            clearFilterUI();
            renderBrowseGrid(browseMode);
            return;
        }

        // If in browse mode top-level, exit browse
        if (browseMode !== 'none') {
            exitBrowse();
            return;
        }

        // Normal tag clear
        if (!currentTag) return;
        currentTag = '';
        clearFilterUI();
        applyFiltersAndRender();
    }

    /* ── Track Count ── */
    function updateTrackCount(count) {
        const el = document.getElementById('track-count');
        if (el) {
            el.textContent = count + ' song' + (count !== 1 ? 's' : '');
        }
    }

    /* ── Playlist Functionality ── */
    function togglePlaylistMode() {
        playlistMode = !playlistMode;
        const btn = document.getElementById('playlist-mode-btn');
        const panel = document.getElementById('playlist-panel');
        
        if (playlistMode) {
            btn.classList.add('active');
            panel.style.display = 'flex';
            document.body.classList.add('playlist-active');
        } else {
            btn.classList.remove('active');
            panel.style.display = 'none';
            document.body.classList.remove('playlist-active');
            selectedPlaylistTracks.clear();
            updatePlaylistUI();
        }

        // Re-render grid to show/hide checkboxes
        if (browseMode !== 'none' && !browseFilter) {
            renderBrowseGrid(browseMode);
        } else {
            renderTrackGrid(currentTracks);
        }
    }

    function toggleTrackSelection(deezerId) {
        const idStr = String(deezerId);
        if (selectedPlaylistTracks.has(idStr)) {
            selectedPlaylistTracks.delete(idStr);
        } else {
            selectedPlaylistTracks.add(idStr);
        }
        
        // Update checkbox visually without re-rendering entire grid
        const card = document.querySelector(`.track-card[data-deezer-id="${idStr}"]`);
        if (card) {
            if (selectedPlaylistTracks.has(idStr)) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
            
            const checkbox = card.querySelector('.playlist-checkbox');
            if (checkbox) {
                if (selectedPlaylistTracks.has(idStr)) {
                    checkbox.classList.add('checked');
                } else {
                    checkbox.classList.remove('checked');
                }
            }
        }
        updatePlaylistUI();
    }

    function updatePlaylistUI() {
        const countSpan = document.getElementById('playlist-count');
        const container = document.getElementById('playlist-items-container');
        if (!countSpan || !container) return;

        countSpan.textContent = `${selectedPlaylistTracks.size} tracks selected`;

        if (selectedPlaylistTracks.size === 0) {
            container.innerHTML = `<div class="empty-state" style="padding: 1rem 0; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                Click on songs in the library to add them to your playlist.
            </div>`;
            return;
        }

        let html = '';
        const selectedIds = Array.from(selectedPlaylistTracks);
        
        // Match IDs back to track objects, maintaining insertion order
        const tracks = selectedIds.map(id => allTracks.find(t => String(t.deezer_id) === id)).filter(Boolean);

        tracks.forEach(track => {
            html += `<div class="playlist-item">
                        <div class="playlist-item-info">
                            <span class="playlist-item-title" title="${escapeAttr(track.title)}">${escapeHtml(track.title)}</span>
                            <span class="playlist-item-artist" title="${escapeAttr(track.artist)}">${escapeHtml(track.artist)}</span>
                        </div>
                        <button class="playlist-item-remove" onclick="Library.toggleTrackSelection('${escapeAttr(track.deezer_id)}')" title="Remove">
                            <span class="material-symbols-outlined" style="font-size: 1.2rem;">close</span>
                        </button>
                    </div>`;
        });
        
        container.innerHTML = html;
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    function clearPlaylist() {
        selectedPlaylistTracks.clear();
        updatePlaylistUI();
        
        // Remove 'checked' classes from grid
        document.querySelectorAll('.playlist-checkbox.checked').forEach(el => {
            el.classList.remove('checked');
        });
        document.querySelectorAll('.track-card.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }

    function exportPlaylist(format) {
        if (selectedPlaylistTracks.size === 0) {
            alert('Please select some tracks first.');
            return;
        }

        const input = document.getElementById('playlist-name-input');
        let filename = input ? input.value.trim() : '';
        if (!filename) filename = 'My Playlist';

        const selectedIds = Array.from(selectedPlaylistTracks);
        const tracks = selectedIds.map(id => allTracks.find(t => String(t.deezer_id) === id)).filter(Boolean);

        let content = '';
        let mimeType = 'text/plain';

        if (format === 'm3u') {
            content += '#EXTM3U\n';
            tracks.forEach(t => {
                const durationInfo = t.duration ? Math.round(t.duration) : -1;
                content += `#EXTINF:${durationInfo},${t.artist} - ${t.title}\n`;
                // M3U usually contains file paths. Since we only have Deezer IDs/URLs locally, 
                // we provide a Deezer link as the URI. TuneMyMusic can often parse these.
                content += `https://www.deezer.com/track/${t.deezer_id}\n`;
            });
            mimeType = 'audio/x-mpegurl';
            filename += '.m3u';
        } 
        else if (format === 'csv') {
            content += 'Track Name,Artist Name,Album,ISRC\n';
            tracks.forEach(t => {
                // Escape quotes
                const title = `"${(t.title || '').replace(/"/g, '""')}"`;
                const artist = `"${(t.artist || '').replace(/"/g, '""')}"`;
                const album = `"${(t.album || '').replace(/"/g, '""')}"`;
                const isrc = t.isrc || '';
                content += `${title},${artist},${album},${isrc}\n`;
            });
            mimeType = 'text/csv';
            filename += '.csv';
        }
        else if (format === 'txt') {
            // Simple artist - title format is very broadly compatible
            tracks.forEach(t => {
                content += `${t.artist} - ${t.title}\n`;
            });
            filename += '.txt';
        }

        downloadBlob(content, filename, mimeType);
    }

    function downloadBlob(content, filename, mimeType) {
        const a = document.createElement('a');
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        a.setAttribute('href', url);
        a.setAttribute('download', filename);
        a.click();
        URL.revokeObjectURL(url);
    }

    /* ── Random Mix Generator ── */
    function openRandomPlaylistModal() {
        if (!playlistMode) return;

        // Gather unique tags and artists
        const tagSet = new Set();
        const artistSet = new Set();
        allTracks.forEach(t => {
            if (t.tags) t.tags.forEach(tag => tagSet.add(tag));
            if (t.artist) artistSet.add(t.artist);
        });
        const uniqueTags = Array.from(tagSet).sort();
        const uniqueArtists = Array.from(artistSet).sort((a,b) => a.localeCompare(b));

        let html = '<div class="detail-card" style="padding: 1.5rem;">';
        html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">';
        html += '<h2 style="font-family: var(--font-serif); margin: 0; font-size: 1.4rem;">Random Mix</h2>';
        html += '<button class="nav-icon-btn" onclick="closeModal()" title="Close" style="color: var(--text-muted);"><span class="material-symbols-outlined">close</span></button>';
        html += '</div>';

        // Size slider
        html += '<div class="random-mix-section">';
        html += '<label class="random-mix-label">Number of Tracks: <span id="random-mix-size-val" class="random-mix-slider-val">20</span></label>';
        html += '<input type="range" id="random-mix-size" class="random-mix-slider" min="1" max="100" value="20" oninput="document.getElementById(\'random-mix-size-val\').innerText=this.value">';
        html += '</div>';

        // Artist Search
        html += '<div class="random-mix-section">';
        html += '<label class="random-mix-label">Include Artists (Optional)</label>';
        html += '<div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">';
        html += '<input type="text" id="random-artist-input" class="artist-search-input" list="random-artist-list" placeholder="Search artists..." onkeydown="if(event.key===\'Enter\'){ event.preventDefault(); Library.addRandomMixArtist(); }">';
        html += '<datalist id="random-artist-list">';
        uniqueArtists.forEach(a => html += `<option value="${escapeAttr(a)}">`);
        html += '</datalist>';
        html += '<button type="button" class="btn btn-secondary" onclick="Library.addRandomMixArtist()">Add</button>';
        html += '</div>';
        html += '<div id="random-artist-chips" class="random-chip-container"></div>';
        html += '</div>';

        // Tag Filters
        html += '<div class="random-mix-section">';
        html += '<label class="random-mix-label">Include Tags (Optional)</label>';
        html += '<div class="random-chip-container">';
        uniqueTags.forEach(tag => {
            html += `<button type="button" class="random-chip tag-filter-chip" onclick="this.classList.toggle('selected')">${escapeHtml(tag)}</button>`;
        });
        if (uniqueTags.length === 0) html += '<span style="color: var(--text-muted); font-size: 0.8rem;">No tags available</span>';
        html += '</div>';
        html += '<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; line-height: 1.4;">If no artists or tags are selected, the mix will be truly random across all songs. If filters are active, the pool will contain songs that match <strong>any</strong> selected artist OR tag.</p>';
        html += '</div>';

        // Actions
        html += '<div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;">';
        html += '<button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
        html += '<button type="button" class="btn btn-primary" onclick="Library.generateRandomPlaylist()">Generate</button>';
        html += '</div>';

        html += '</div>';

        const modalOverlay = document.getElementById('track-modal');
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = html;
        modalOverlay.classList.add('active');
    }

    function addRandomMixArtist() {
        const input = document.getElementById('random-artist-input');
        const val = input.value.trim();
        if (!val) return;
        
        const container = document.getElementById('random-artist-chips');
        // Check if already added
        const existing = Array.from(container.querySelectorAll('.random-chip')).map(el => el.textContent.replace(' ×', '').trim());
        if (existing.includes(val)) {
            input.value = '';
            return;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'random-chip artist-filter-chip selected';
        btn.innerHTML = `${escapeHtml(val)} &times;`;
        btn.onclick = function() { this.remove(); };
        container.appendChild(btn);
        
        input.value = '';
    }

    function generateRandomPlaylist() {
        // Collect filters
        const sizeInput = document.getElementById('random-mix-size');
        if (!sizeInput) return;
        const size = parseInt(sizeInput.value, 10);
        
        const artistChips = Array.from(document.querySelectorAll('#random-artist-chips .artist-filter-chip'));
        const targetArtists = new Set(artistChips.map(el => el.textContent.replace(' ×', '').trim()).filter(Boolean));
        
        const tagChips = Array.from(document.querySelectorAll('.tag-filter-chip.selected'));
        const targetTags = new Set(tagChips.map(el => el.textContent.trim()).filter(Boolean));

        const hasFilters = targetArtists.size > 0 || targetTags.size > 0;

        // Compute pool
        let pool = [];
        if (!hasFilters) {
            pool = allTracks.slice();
        } else {
            pool = allTracks.filter(t => {
                const matchesArtist = t.artist && targetArtists.has(t.artist);
                const matchesTag = t.tags && t.tags.some(tag => targetTags.has(tag));
                return matchesArtist || matchesTag;
            });
        }

        if (pool.length === 0) {
            alert('No tracks match your selected filters. Try broadening your selection.');
            return;
        }

        // Fisher-Yates shuffle the pool
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = pool[i];
            pool[i] = pool[j];
            pool[j] = temp;
        }

        const selectedSubset = pool.slice(0, size);

        // Update UI
        Library.clearPlaylist(); // Clear previous selections & UI
        
        selectedSubset.forEach(t => selectedPlaylistTracks.add(String(t.deezer_id)));
        
        closeModal();
        updatePlaylistUI();

        // Refresh the grid to show checked states
        if (browseMode !== 'none' && !browseFilter) {
            renderBrowseGrid(browseMode);
        } else {
            renderTrackGrid(currentTracks);
        }
    }

    /* ── Helpers ── */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ── Public Interface ── */
    return {
        init,
        search,
        setTag,
        clearTag,
        groupBy,
        selectBrowseItem,
        openDetail,
        openRandomSong,
        toggleDetailPreview,
        toggleGlobalPlay,
        stopGlobalAudio,
        startRadioMode,
        playNextRadioTrack,
        playPrevRadioTrack,
        toggleInlinePlay,
        deleteTrack,
        refetchTrack,
        toggleEditTags,
        removeEditTag,
        cancelEditTags,
        saveTags,
        togglePlaylistMode,
        toggleTrackSelection,
        clearPlaylist,
        exportPlaylist,
        openRandomPlaylistModal,
        addRandomMixArtist,
        generateRandomPlaylist
    };
})();
