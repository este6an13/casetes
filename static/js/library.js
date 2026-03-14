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
    let inlineAudio = null;
    let inlinePlayingId = null;

    /* ── Initialization ── */
    function init(tracks) {
        allTracks = tracks;
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
            html += '<div class="track-card skeleton-loading" data-deezer-id="' + escapeAttr(track.deezer_id) + '" onclick="Library.openDetail(\'' + escapeAttr(track.deezer_id) + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
            html += '<div class="track-cover-wrapper">';
            if (track.cover) {
                html += '<img class="track-cover" src="/' + escapeAttr(track.cover) + '" alt="' + escapeAttr(track.title) + '" loading="lazy" onload="this.closest(\'.track-card\').classList.remove(\'skeleton-loading\')">';
            } else {
                html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
            }
            html += '<div class="track-overlay"></div>';
            if (track.preview_url) {
                html += '<button class="card-play-btn" data-deezer-id="' + escapeAttr(track.deezer_id) + '" onclick="event.stopPropagation(); Library.toggleInlinePlay(\'' + escapeAttr(track.deezer_id) + '\', this)" title="Play preview">';
                html += '<span class="material-symbols-outlined">' + (inlinePlayingId === track.deezer_id ? 'pause' : 'play_arrow') + '</span>';
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

    /* ── Track Detail Modal ── */
    function openDetail(deezerId) {
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

        html += '<button class="detail-delete" onclick="event.stopPropagation(); Library.deleteTrack(\'' + escapeAttr(track.deezer_id) + '\')" title="Remove from Library">';
        html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span><span class="detail-link-text">Remove</span></button>';
        html += '</div>';

        html += '</div></div>';

        document.getElementById('modal-content').innerHTML = html;
        document.getElementById('track-modal').classList.add('active');
        document.body.classList.add('modal-open');
    }

    function toggleDetailPreview() {
        const audio = document.getElementById('detail-audio');
        const icon = document.getElementById('detail-play-icon');
        if (!audio) return;

        stopInlineAudio();

        if (audio.paused) {
            audio.play();
            icon.textContent = 'pause';
        } else {
            audio.pause();
            icon.textContent = 'play_arrow';
        }
        audio.onended = () => { icon.textContent = 'play_arrow'; };
    }

    /* ── Inline Play (on track cards) ── */
    function stopInlineAudio() {
        if (inlineAudio) {
            inlineAudio.pause();
            inlineAudio.currentTime = 0;
            const oldBtn = document.querySelector('.card-play-btn[data-deezer-id="' + inlinePlayingId + '"] .material-symbols-outlined');
            if (oldBtn) oldBtn.textContent = 'play_arrow';
            inlineAudio = null;
            inlinePlayingId = null;
        }
    }

    function toggleInlinePlay(deezerId, btn) {
        const icon = btn.querySelector('.material-symbols-outlined');

        if (inlinePlayingId === deezerId && inlineAudio && !inlineAudio.paused) {
            stopInlineAudio();
            return;
        }

        stopInlineAudio();

        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track || !track.preview_url) return;

        inlineAudio = new Audio(track.preview_url);
        inlinePlayingId = deezerId;
        icon.textContent = 'pause';

        inlineAudio.play();
        inlineAudio.onended = () => {
            icon.textContent = 'play_arrow';
            inlinePlayingId = null;
            inlineAudio = null;
        };
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

    /* ── Edit Tags (Inline inside Detail Modal) ── */
    function renderTagsUI(track) {
        let html = '<div class="detail-tags" style="display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;">';
        if (track.tags && track.tags.length > 0) {
            track.tags.forEach(tag => {
                html += '<button class="detail-tag" onclick="event.stopPropagation(); Library.setTag(\'' + escapeAttr(tag) + '\'); window.closeModal();">' + escapeHtml(tag) + '</button>';
            });
        }
        
        // Always show the edit button
        html += '<button class="detail-tag detail-tag-edit" onclick="event.stopPropagation(); Library.toggleEditTags(\'' + escapeAttr(track.deezer_id) + '\')" title="Edit tags" style="padding: 0.2rem 0.5rem; background: var(--bg-hover);"><span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">edit</span></button>';
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
        toggleDetailPreview,
        toggleInlinePlay,
        deleteTrack,
        toggleEditTags,
        removeEditTag,
        cancelEditTags,
        saveTags,
    };
})();
