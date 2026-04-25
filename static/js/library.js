/**
 * Library.js — Core orchestrator for the music library.
 * Handles state, filtering, grid rendering, browse mode, detail modal,
 * tags, search, and sync. Delegates to AudioPlayer, Playlist, and Utils.
 *
 * Depends on: Utils (utils.js), AudioPlayer (audio.js), Playlist (playlist.js)
 */
const Library = (function () {
    'use strict';

    let allTracks = [];
    let currentTracks = [];
    let currentQuery = '';
    let currentTag = '';
    let browseMode = 'none';     // 'none' | 'artist' | 'year' | 'tag' | 'album'
    let browseFilter = null;     // { mode: 'artist', value: 'Daft Punk' } when drilled in

    /* ── Edit Tags State ── */
    let activeEditDeezerId = null;
    let activeEditTags = [];

    /* ── Initialization ── */
    function init(tracks) {
        allTracks = tracks;

        // Initialize sub-modules, passing shared track array and callbacks
        AudioPlayer.init(allTracks, {
            onStop: function () { /* nothing extra needed */ }
        });

        Playlist.init(allTracks, {
            onRerenderGrid: rerenderCurrentGrid,
            onCloseModal: function () { window.closeModal(); }
        });

        applyFiltersAndRender();
    }

    /* ── Re-render helper (used as callback from sub-modules) ── */
    function rerenderCurrentGrid() {
        if (browseMode !== 'none' && !browseFilter) {
            renderBrowseGrid(browseMode);
        } else {
            renderTrackGrid(currentTracks);
        }
    }

    /* ── Filtering & Rendering Pipeline ── */
    function applyFiltersAndRender() {
        let filtered = allTracks.slice();

        // Tag filter
        if (currentTag) {
            filtered = filtered.filter(t =>
                t.tags && t.tags.some(tag => tag.toLowerCase() === currentTag.toLowerCase())
            );
        }

        // Browse drill-in filter
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

        // 1 in 6 chance: sort by cover color (rainbow gradient), otherwise random shuffle
        var isColorSort = Math.random() < 1 / 6;
        if (isColorSort) {
            // Random hue offset so the rainbow starts at a different color each time
            var hueOffset = Math.floor(Math.random() * 360);
            // Random direction: forward or reversed rainbow
            var direction = Math.random() < 0.5 ? 1 : -1;
            filtered.sort(function (a, b) {
                var ac = a.cover_color || [0, 0, 0];
                var bc = b.cover_color || [0, 0, 0];
                // Group low-saturation (grayscale) covers at the end
                var aGray = ac[1] < 10 ? 1 : 0;
                var bGray = bc[1] < 10 ? 1 : 0;
                if (aGray !== bGray) return aGray - bGray;
                // Sort by shifted hue, then by lightness
                var aHue = (ac[0] + hueOffset) % 360;
                var bHue = (bc[0] + hueOffset) % 360;
                if (aHue !== bHue) return (aHue - bHue) * direction;
                return (ac[2] - bc[2]) * direction;
            });
        } else {
            // Shuffle (Fisher-Yates)
            for (var i = filtered.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var temp = filtered[i];
                filtered[i] = filtered[j];
                filtered[j] = temp;
            }
        }

        // Show/hide color sort hint
        var hint = document.getElementById('color-sort-hint');
        if (hint) {
            hint.classList.toggle('visible', isColorSort);
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

        const currentPlayingId = AudioPlayer.getCurrentPlayingId();

        let html = '<div class="track-grid">';
        tracks.forEach((track, ti) => {
            const delay = Math.min(ti * 0.04, 0.5);
            const isSelected = Playlist.isSelected(track.deezer_id);
            const selectedClass = isSelected ? ' selected' : '';
            html += '<div class="track-card skeleton-loading' + selectedClass + '" data-deezer-id="' + Utils.escapeAttr(track.deezer_id) + '" onclick="Library.openDetail(\'' + Utils.escapeAttr(track.deezer_id) + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
            html += '<div class="track-cover-wrapper">';
            if (track.cover) {
                const imgBase = window.IMAGE_BASE_URL || '/';
                html += '<img class="track-cover" src="' + imgBase + Utils.escapeAttr(track.cover) + '" alt="' + Utils.escapeAttr(track.title) + '" loading="lazy" onload="this.closest(\'.track-card\').classList.remove(\'skeleton-loading\')">';
            } else {
                html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
            }

            // Checkbox overlay for playlist mode
            html += '<div class="playlist-checkbox ' + (isSelected ? 'checked' : '') + '">';
            html += '<span class="material-symbols-outlined check-icon">check_circle</span>';
            html += '</div>';

            html += '<div class="track-overlay"></div>';
            if (track.preview_url) {
                html += '<button class="card-play-btn" data-deezer-id="' + Utils.escapeAttr(track.deezer_id) + '" onclick="event.stopPropagation(); Library.toggleInlinePlay(\'' + Utils.escapeAttr(track.deezer_id) + '\', this)" title="Play preview">';
                html += '<span class="material-symbols-outlined">' + (currentPlayingId === track.deezer_id ? 'pause' : 'play_arrow') + '</span>';
                html += '</button>';
            }
            html += '</div>';
            html += '<div class="track-card-info">';
            html += '<div class="track-card-title">' + Utils.escapeHtml(track.title) + '</div>';
            html += '<div class="track-card-artist">' + Utils.escapeHtml(track.artist) + '</div>';
            html += '</div></div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    /* ── Browse Mode (category cards) ── */
    function renderBrowseGrid(mode) {
        const container = document.getElementById('track-grid');
        if (!container) return;

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
                const date = t.added_at || '';
                if (date > categories[key].newestDate) {
                    categories[key].newestDate = date;
                    categories[key].cover = t.cover;
                }
            });
        });

        const sorted = Object.values(categories).sort((a, b) => {
            if (a.name === 'Unknown' || a.name === 'Untagged') return 1;
            if (b.name === 'Unknown' || b.name === 'Untagged') return -1;
            if (mode === 'year') return parseInt(b.name) - parseInt(a.name);
            return b.count - a.count;
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
            const escapedName = Utils.escapeAttr(cat.name.replace(/'/g, "\\'"));
            html += '<div class="browse-card" onclick="Library.selectBrowseItem(\'' + escapedName + '\')" role="button" tabindex="0" style="animation-delay: ' + delay + 's;">';
            html += '<div class="browse-cover-wrapper">';
            if (cat.cover) {
                const imgBase = window.IMAGE_BASE_URL || '/';
                html += '<img class="browse-cover" src="' + imgBase + Utils.escapeAttr(cat.cover) + '" alt="' + Utils.escapeAttr(cat.name) + '" loading="lazy">';
            } else {
                html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);">♪</div>';
            }
            html += '</div>';
            html += '<div class="browse-card-info">';
            html += '<div class="browse-card-name">' + Utils.escapeHtml(cat.name) + '</div>';
            html += '<div class="browse-card-count">' + cat.count + ' song' + (cat.count !== 1 ? 's' : '') + '</div>';
            html += '</div></div>';
        });
        html += '</div>';

        container.innerHTML = html;
        updateTrackCount(allTracks.length);
    }

    /* ── Browse Mode Toggle ── */
    function groupBy(mode) {
        if (browseMode === mode && !browseFilter) {
            exitBrowse();
            return;
        }

        if (browseFilter && browseFilter.mode === mode) {
            browseFilter = null;
            clearFilterUI();
        }

        browseMode = mode;
        browseFilter = null;

        currentTag = '';
        currentQuery = '';
        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';
        clearTagUI();
        clearFilterUI();

        updateBrowseButtons(mode);

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
        if (Playlist.isPlaylistMode()) {
            Playlist.toggleTrackSelection(deezerId);
            return;
        }

        const track = currentTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;

        let html = '<div class="detail-card">';
        html += '<button class="detail-close" onclick="closeModal()" aria-label="Close">&#10005;</button>';

        // Cover
        html += '<div class="detail-cover-wrapper">';
        if (track.cover) {
            const imgBase = window.IMAGE_BASE_URL || '/';
            html += '<img class="detail-cover" src="' + imgBase + Utils.escapeAttr(track.cover) + '" alt="' + Utils.escapeAttr(track.title) + '">';
        }
        if (track.preview_url) {
            html += '<button class="detail-play-btn" data-deezer-id="' + Utils.escapeAttr(track.deezer_id) + '" onclick="Library.toggleDetailPreview(\'' + Utils.escapeAttr(track.deezer_id) + '\')" title="Play preview">';
            const isThisTrackPlaying = (AudioPlayer.getCurrentPlayingId() === track.deezer_id && AudioPlayer.isPlaying());
            html += '<span class="material-symbols-outlined" id="detail-play-icon">' + (isThisTrackPlaying ? 'pause' : 'play_arrow') + '</span>';
            html += '</button>';
        }
        html += '</div>';

        // Info
        html += '<div class="detail-info">';
        html += '<h2 class="detail-title">' + Utils.escapeHtml(track.title) + '</h2>';
        html += '<p class="detail-artist">' + Utils.escapeHtml(track.artist) + '</p>';

        html += '<div class="detail-meta">';
        html += '<div class="detail-meta-row"><span class="detail-meta-label">Album</span><span class="detail-meta-value">' + Utils.escapeHtml(track.album) + '</span></div>';
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

        const brandIcons = {
            deezer: `<svg class="platform-icon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><title>Deezer</title><path d="M.693 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807C.312 4.41 0 5.666 0 7.217s.312 2.808.693 2.808ZM21.038 1.56c-.364 0-.684.805-.91 2.096C19.765 1.446 19.184 0 18.526 0c-.78 0-1.464 2.036-1.784 5-.312-2.158-.788-3.536-1.325-3.536-.745 0-1.386 2.704-1.62 6.472-.442-1.932-1.083-3.145-1.793-3.145s-1.35 1.213-1.793 3.145c-.242-3.76-.874-6.463-1.628-6.463-.537 0-1.013 1.378-1.325 3.535C6.938 2.036 6.262 0 5.474 0c-.658 0-1.247 1.447-1.602 3.665-.217-1.291-.546-2.105-.91-2.105-.675 0-1.221 2.807-1.221 6.272 0 3.466.546 6.273 1.221 6.273.277 0 .537-.476.736-1.273.32 2.928.996 4.938 1.776 4.938.606 0 1.143-1.204 1.507-3.11.251 3.622.875 6.195 1.602 6.195.46 0 .875-1.023 1.187-2.677C10.142 21.6 11 24 12.004 24c1.005 0 1.863-2.4 2.235-5.822.312 1.654.727 2.677 1.186 2.677.728 0 1.352-2.573 1.603-6.195.364 1.906.9 3.11 1.507 3.11.78 0 1.455-2.01 1.775-4.938.208.797.46 1.273.737 1.273.675 0 1.22-2.807 1.22-6.273-.008-3.457-.553-6.272-1.23-6.272ZM23.307 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807-.381 0-.693 1.256-.693 2.807s.312 2.808.693 2.808Z"/></svg>`,
            spotify: `<svg class="platform-icon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><title>Spotify</title><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
            apple: `<svg class="platform-icon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><title>Apple Music</title><path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"/></svg>`,
            youtube: `<svg class="platform-icon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><title>YouTube Music</title><path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z"/></svg>`
        };

        html += '<a href="https://www.deezer.com/track/' + Utils.escapeAttr(track.deezer_id) + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Open in Deezer">';
        html += brandIcons.deezer + '<span class="detail-link-text">Deezer</span></a>';

        html += '<a href="https://open.spotify.com/search/' + queryStr + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on Spotify">';
        html += brandIcons.spotify + '<span class="detail-link-text">Spotify</span></a>';

        const appleQuery = encodeURIComponent(track.title + ' ' + track.artist);
        html += '<a href="https://music.apple.com/WebObjects/MZStore.woa/wa/search?term=' + appleQuery + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on Apple Music">';
        html += brandIcons.apple + '<span class="detail-link-text">Apple Music</span></a>';

        html += '<a href="https://music.youtube.com/search?q=' + appleQuery + '" target="_blank" rel="noopener" class="detail-link" onclick="event.stopPropagation();" title="Search on YouTube Music">';
        html += brandIcons.youtube + '<span class="detail-link-text">YouTube Music</span></a>';
        html += '</div>';

        html += '<div class="detail-links" style="margin-top: auto; border-top: 1px solid var(--border-hover); padding-top: 0.8rem; justify-content: space-between;">';
        if (window.__ADMIN_MODE) {
            html += '<button class="detail-link" onclick="event.stopPropagation(); Library.refetchTrack(\'' + Utils.escapeAttr(track.deezer_id) + '\')" title="Refetch Data" style="color: var(--text-primary);">';
            html += '<span class="material-symbols-outlined" style="font-size:1.1rem;">sync</span><span class="detail-link-text">Refetch</span></button>';

            html += '<button class="detail-delete" onclick="event.stopPropagation(); Library.deleteTrack(\'' + Utils.escapeAttr(track.deezer_id) + '\')" title="Remove from Library">';
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

    /* ── Admin Actions ── */
    async function deleteTrack(deezerId) {
        if (!confirm('Remove this song from your library?')) return;
        try {
            const resp = await fetch('/api/track/' + deezerId, { method: 'DELETE' });
            if (resp.ok) {
                allTracks = allTracks.filter(t => t.deezer_id !== deezerId);
                window.closeModal();
                rerenderCurrentGrid();
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

                allTracks = allTracks.map(t => t.deezer_id === deezerId ? updatedTrack : t);
                currentTracks = currentTracks.map(t => t.deezer_id === deezerId ? updatedTrack : t);

                openDetail(deezerId);

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

    /* ── Edit Tags ── */
    function renderTagsUI(track) {
        let html = '<div class="detail-tags" style="display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;">';
        if (track.tags && track.tags.length > 0) {
            track.tags.forEach(tag => {
                html += '<button class="detail-tag" onclick="event.stopPropagation(); Library.setTag(\'' + Utils.escapeAttr(tag) + '\'); window.closeModal();">' + Utils.escapeHtml(tag) + '</button>';
            });
        }

        if (window.__ADMIN_MODE) {
            html += '<button class="detail-tag detail-tag-edit" onclick="event.stopPropagation(); Library.toggleEditTags(\'' + Utils.escapeAttr(track.deezer_id) + '\')" title="Edit tags" style="padding: 0.2rem 0.5rem; background: var(--bg-hover);"><span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">edit</span></button>';
        }
        html += '</div>';
        return html;
    }

    function toggleEditTags(deezerId) {
        const track = allTracks.find(t => t.deezer_id === deezerId);
        if (!track) return;

        activeEditDeezerId = deezerId;
        activeEditTags = [...(track.tags || [])];

        renderTagEditor();

        setTimeout(() => {
            const input = document.getElementById('edit-tag-input-field');
            if (input) input.focus();
        }, 50);
    }

    function renderTagEditor() {
        const container = document.getElementById('detail-tags-container');
        if (!container) return;

        let html = '<div class="tag-edit-area" style="margin-top: 0.5rem;">';

        html += '<div class="tag-input-container" id="inline-tag-input-container" style="background: var(--bg-secondary); border-color: var(--border-hover);">';

        activeEditTags.forEach((tag, index) => {
            html += `<div class="tag-chip" style="margin: 0.2rem;">
                        <span>${Utils.escapeHtml(tag)}</span>
                        <span style="cursor: pointer; font-size: 1.1rem; line-height: 1; color: var(--text-muted);" onclick="Library.removeEditTag(${index})">&times;</span>
                    </div>`;
        });

        html += '<input type="text" id="edit-tag-input-field" style="border: none; background: transparent; color: var(--text-primary); flex: 1; min-width: 100px; outline: none; font-family: inherit; font-size: 0.85rem;" placeholder="Add tag...">';
        html += '</div>';

        html += '<div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; justify-content: flex-end;">';
        html += `<button class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="Library.cancelEditTags('${Utils.escapeAttr(activeEditDeezerId)}')">Cancel</button>`;
        html += `<button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="Library.saveTags('${Utils.escapeAttr(activeEditDeezerId)}')">Save</button>`;
        html += '</div>';

        html += '</div>';

        container.innerHTML = html;

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

        cancelEditTags(deezerId);

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
        if (currentQuery && browseMode !== 'none' && !browseFilter) {
            exitBrowse();
        }
        applyFiltersAndRender();
    }

    /* ── Tag Filter ── */
    function setTag(tagName) {
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
        if (browseFilter) {
            browseFilter = null;
            clearFilterUI();
            renderBrowseGrid(browseMode);
            return;
        }

        if (browseMode !== 'none') {
            exitBrowse();
            return;
        }

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

    /* ── Sync Database ── */
    async function syncDatabase() {
        if (!confirm('Sync local data to Google Cloud Storage?')) return;

        const btn = document.getElementById('sync-db-btn');
        const icon = document.getElementById('sync-icon');
        const textSpan = btn ? btn.querySelector('.nav-link-text') : null;
        const oldText = textSpan ? textSpan.textContent : 'sync';
        let originalIcon = 'cloud_sync';

        if (textSpan) textSpan.textContent = 'syncing...';
        if (icon) {
            originalIcon = icon.textContent;
            icon.textContent = 'sync';
            icon.style.animation = 'spin 1s linear infinite';
        }

        try {
            const resp = await fetch('/api/sync', { method: 'POST' });
            if (resp.ok) {
                const data = await resp.json();
                alert(data.message);
            } else {
                const errorData = await resp.json();
                alert('Failed to sync: ' + (errorData.detail || 'Unknown error'));
            }
        } catch (e) {
            alert('Error syncing: ' + e.message);
        } finally {
            if (textSpan) textSpan.textContent = oldText;
            if (icon) {
                icon.textContent = originalIcon;
                icon.style.animation = 'none';
            }
        }
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
        // Delegate to AudioPlayer
        toggleDetailPreview: function (id) { AudioPlayer.toggleDetailPreview(id); },
        toggleGlobalPlay: function () { AudioPlayer.toggleGlobalPlay(); },
        stopGlobalAudio: function () { AudioPlayer.stopGlobalAudio(); },
        startRadioMode: function () { AudioPlayer.startRadioMode(); },
        playNextRadioTrack: function (s) { AudioPlayer.playNextRadioTrack(s); },
        playPrevRadioTrack: function () { AudioPlayer.playPrevRadioTrack(); },
        toggleInlinePlay: function (id, btn) { AudioPlayer.toggleInlinePlay(id, btn); },
        // Delegate to Playlist
        togglePlaylistMode: function () { Playlist.togglePlaylistMode(); },
        toggleTrackSelection: function (id) { Playlist.toggleTrackSelection(id); },
        clearPlaylist: function () { Playlist.clearPlaylist(); },
        exportPlaylist: function (fmt) { Playlist.exportPlaylist(fmt); },
        openRandomPlaylistModal: function () { Playlist.openRandomPlaylistModal(); },
        addRandomMixArtist: function () { Playlist.addRandomMixArtist(); },
        generateRandomPlaylist: function () { Playlist.generateRandomPlaylist(); },
        // Admin
        deleteTrack,
        refetchTrack,
        toggleEditTags,
        removeEditTag,
        cancelEditTags,
        saveTags,
        syncDatabase
    };
})();
