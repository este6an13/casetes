/**
 * Library.js — Client-side rendering engine for the music library.
 * Handles grid rendering, search, tag filtering, grouping (artist / year / tag),
 * and track detail modal from an in-memory tracks array.
 */
const Library = (function () {
    'use strict';

    let allTracks = [];
    let currentTracks = [];
    let currentQuery = '';
    let currentTag = '';
    let currentGroup = 'none'; // 'none' | 'artist' | 'year' | 'tag'

    /* ── Initialization ── */
    function init(tracks) {
        allTracks = tracks;
        applyFiltersAndRender();
    }

    /* ── Filtering & Grouping Pipeline ── */
    function applyFiltersAndRender() {
        let filtered = allTracks.slice();

        // Tag filter
        if (currentTag) {
            filtered = filtered.filter(t =>
                t.tags && t.tags.some(tag => tag.toLowerCase() === currentTag.toLowerCase())
            );
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

        // Sort by added_at descending (newest first)
        filtered.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));

        currentTracks = filtered;
        renderGrid(filtered);
        updateTrackCount(filtered.length);
    }

    /* ── Grid Rendering ── */
    function renderGrid(tracks) {
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

        // Build groups
        const groups = buildGroups(tracks);
        let html = '';

        const groupKeys = Object.keys(groups);
        groupKeys.forEach((key, gi) => {
            const groupTracks = groups[key];

            if (currentGroup !== 'none') {
                html += '<div class="group-section">';
                html += '<h2 class="group-header">' + escapeHtml(key) + ' <span style="font-size: 0.7em; font-family: var(--font-sans); font-weight: 300; color: var(--text-muted);">' + groupTracks.length + '</span></h2>';
            }

            html += '<div class="track-grid">';
            groupTracks.forEach((track, ti) => {
                const delay = Math.min(ti * 0.04, 0.5);
                html += '<div class="track-card skeleton-loading" data-deezer-id="' + escapeAttr(track.deezer_id) + '" onclick="Library.openDetail(\'' + escapeAttr(track.deezer_id) + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
                html += '<div class="track-cover-wrapper">';
                if (track.cover) {
                    html += '<img class="track-cover" src="/' + escapeAttr(track.cover) + '" alt="' + escapeAttr(track.title) + '" loading="lazy" onload="this.closest(\'.track-card\').classList.remove(\'skeleton-loading\')">';
                } else {
                    html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
                }
                html += '<div class="track-overlay"></div>';
                html += '</div>';
                html += '<div class="track-card-info">';
                html += '<div class="track-card-title">' + escapeHtml(track.title) + '</div>';
                html += '<div class="track-card-artist">' + escapeHtml(track.artist) + '</div>';
                html += '</div></div>';
            });
            html += '</div>';

            if (currentGroup !== 'none') {
                html += '</div>';
            }
        });

        container.innerHTML = html;
    }

    function buildGroups(tracks) {
        if (currentGroup === 'none') {
            return { 'All': tracks };
        }

        const groups = {};
        tracks.forEach(t => {
            let keys = [];
            if (currentGroup === 'artist') {
                keys = [t.artist || 'Unknown'];
            } else if (currentGroup === 'year') {
                keys = [t.release_year ? String(t.release_year) : 'Unknown'];
            } else if (currentGroup === 'tag') {
                keys = (t.tags && t.tags.length > 0) ? t.tags : ['Untagged'];
            }
            keys.forEach(k => {
                if (!groups[k]) groups[k] = [];
                groups[k].push(t);
            });
        });

        // Sort group keys
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'Unknown' || a === 'Untagged') return 1;
            if (b === 'Unknown' || b === 'Untagged') return -1;
            if (currentGroup === 'year') return parseInt(b) - parseInt(a);
            return a.localeCompare(b);
        });

        const sorted = {};
        sortedKeys.forEach(k => sorted[k] = groups[k]);
        return sorted;
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

        // Tags
        if (track.tags && track.tags.length > 0) {
            html += '<div class="detail-tags">';
            track.tags.forEach(tag => {
                html += '<button class="detail-tag" onclick="event.stopPropagation(); Library.setTag(\'' + escapeAttr(tag) + '\'); closeModal();">' + escapeHtml(tag) + '</button>';
            });
            html += '</div>';
        }

        // Links
        html += '<div class="detail-links">';
        html += '<a href="https://www.deezer.com/track/' + escapeAttr(track.deezer_id) + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();">';
        html += '<span class="material-symbols-outlined" style="font-size:1rem;">open_in_new</span> Deezer</a>';
        html += '<button class="detail-delete" onclick="event.stopPropagation(); Library.deleteTrack(\'' + escapeAttr(track.deezer_id) + '\')">';
        html += '<span class="material-symbols-outlined" style="font-size:1rem;">delete</span> Remove</button>';
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
        if (audio.paused) {
            audio.play();
            icon.textContent = 'pause';
        } else {
            audio.pause();
            icon.textContent = 'play_arrow';
        }
        audio.onended = () => { icon.textContent = 'play_arrow'; };
    }

    /* ── Delete Track ── */
    async function deleteTrack(deezerId) {
        if (!confirm('Remove this song from your library?')) return;
        try {
            const resp = await fetch('/api/track/' + deezerId, { method: 'DELETE' });
            if (resp.ok) {
                allTracks = allTracks.filter(t => t.deezer_id !== deezerId);
                closeModal();
                applyFiltersAndRender();
            } else {
                alert('Failed to remove track.');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    }

    /* ── Search ── */
    function search(query) {
        currentQuery = query.trim();
        applyFiltersAndRender();
    }

    /* ── Tag Filter ── */
    function setTag(tagName) {
        currentTag = tagName;
        currentQuery = '';

        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';

        // Show tag chip
        const indicator = document.getElementById('active-tag-indicator');
        const text = document.getElementById('active-tag-text');
        if (indicator && text) {
            text.textContent = tagName;
            indicator.style.display = 'inline-flex';
        }

        applyFiltersAndRender();
    }

    function clearTag() {
        if (!currentTag) return;
        currentTag = '';

        const indicator = document.getElementById('active-tag-indicator');
        if (indicator) indicator.style.display = 'none';

        applyFiltersAndRender();
    }

    /* ── Grouping ── */
    function groupBy(mode) {
        if (currentGroup === mode) mode = 'none';
        currentGroup = mode;

        // Update button states
        ['artist', 'year', 'tag'].forEach(m => {
            const btn = document.getElementById('group-' + m + '-btn');
            if (btn) btn.classList.toggle('active', m === mode);
        });

        // Show/hide group indicator
        const indicator = document.getElementById('active-group-indicator');
        const text = document.getElementById('active-group-text');
        const icon = document.getElementById('group-icon');

        if (indicator && text) {
            if (mode !== 'none') {
                const labels = { artist: 'Artist', year: 'Year', tag: 'Tag' };
                const icons = { artist: 'person', year: 'calendar_month', tag: 'label' };
                text.textContent = 'by ' + labels[mode];
                if (icon) icon.textContent = icons[mode];
                indicator.style.display = 'inline-flex';
            } else {
                indicator.style.display = 'none';
            }
        }

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
        openDetail,
        toggleDetailPreview,
        deleteTrack,
    };
})();
