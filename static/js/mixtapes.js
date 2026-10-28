/**
 * mixtapes.js — Generated mixtapes (groups of ~12 songs).
 *
 * Tapes are themed by one tag or a pair of tags, plus pure-random
 * "wildcard" tapes. Two sets are dealt: a short shelf on the library page
 * and a full tape box (the "tapes" browse mode), both fresh each time.
 * Opening a tape shows its tracklist; playing it queues the songs in order
 * through AudioPlayer.
 *
 * Depends on: Utils (utils.js), AudioPlayer (audio.js)
 */
const Mixtapes = (function () {
    'use strict';

    const TAPE_LENGTH = 12;
    const MIN_TAG_SONGS = 8;
    const MIN_TAPE_SONGS = 8;
    const MAX_PER_ARTIST = 2;

    const SHELF_TOPICS = 5;
    const BOX_TOPICS = 22;
    const BOX_WILDCARDS = 2;
    const TAPES_PER_CUBBY = 6;

    let allTracks = [];
    let tapesById = {};
    let nextId = 0;
    let shelfIds = [];
    let boxIds = [];

    /* ── Initialization ── */
    function init(tracks) {
        allTracks = tracks.filter(t => t.preview_url);
        deal();
    }

    /* ── Helpers ── */
    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // Pick up to TAPE_LENGTH songs, at most MAX_PER_ARTIST per artist
    function pickSongs(pool) {
        const perArtist = {};
        const picked = [];
        for (const t of shuffle(pool)) {
            const n = perArtist[t.artist] || 0;
            if (n >= MAX_PER_ARTIST) continue;
            perArtist[t.artist] = n + 1;
            picked.push(t);
            if (picked.length === TAPE_LENGTH) break;
        }
        return picked;
    }

    function tracksWithTags(tags) {
        return allTracks.filter(t => t.tags && tags.every(tag => t.tags.includes(tag)));
    }

    function tapeMinutes(tape) {
        const secs = tape.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        return Math.round(secs / 60);
    }

    /* ── Building tapes ──
     * Candidates are single tags and pairs of tags that narrow a topic
     * (both with enough songs). Singles and pairs alternate so a set mixes
     * broad and specific tapes.
     */
    function buildTapes(topicCount, wildcardCount) {
        const counts = {};
        allTracks.forEach(t => (t.tags || []).forEach(tag => {
            counts[tag] = (counts[tag] || 0) + 1;
        }));
        const usable = Object.keys(counts).filter(tag => counts[tag] >= MIN_TAG_SONGS);

        const singles = shuffle(usable.map(tag => [tag]));
        const pairs = [];
        usable.forEach((a, i) => usable.slice(i + 1).forEach(b => {
            const both = tracksWithTags([a, b]).length;
            if (both >= MIN_TAG_SONGS && both < Math.min(counts[a], counts[b])) pairs.push([a, b]);
        }));
        const shuffledPairs = shuffle(pairs).map(shuffle);

        const tapes = [];
        let turn = 0;
        while (tapes.length < topicCount && (singles.length || shuffledPairs.length)) {
            const fromPairs = (turn++ % 2 === 1 && shuffledPairs.length) || !singles.length;
            const tags = fromPairs ? shuffledPairs.pop() : singles.pop();
            const tracks = pickSongs(tracksWithTags(tags));
            if (tracks.length < MIN_TAPE_SONGS) continue;
            tapes.push({ name: tags.join(' + '), tags: tags, tracks: tracks, color: Utils.tagColor(tags[0]) });
        }

        for (let i = 0; i < wildcardCount; i++) {
            tapes.push({ name: 'wildcard', tags: [], tracks: pickSongs(allTracks), color: 'white' });
        }
        return tapes;
    }

    // Replace a set's tapes in the registry and return the new ids
    function register(oldIds, tapes) {
        oldIds.forEach(id => { delete tapesById[id]; });
        return tapes.map(tape => {
            tape.id = nextId++;
            tapesById[tape.id] = tape;
            return tape.id;
        });
    }

    /* ── Library shelf ── */
    function deal() {
        shelfIds = register(shelfIds, buildTapes(SHELF_TOPICS, 1));
        renderShelf();
    }

    function renderShelf() {
        const shelf = document.getElementById('mixtape-shelf-tapes');
        if (!shelf) return;

        const imgBase = window.IMAGE_BASE_URL || '/';
        let html = '';
        shelfIds.forEach(id => {
            const tape = tapesById[id];
            html += '<button type="button" class="mixtape" onclick="Mixtapes.open(' + id + ')" title="Open ' + Utils.escapeAttr(tape.name) + ' tape">';
            html += '<span class="mixtape-label postit-' + tape.color + '">';
            html += '<span class="mixtape-name">' + Utils.escapeHtml(tape.name) + '</span>';
            html += '<span class="mixtape-meta">' + tape.tracks.length + ' songs · ' + tapeMinutes(tape) + ' min</span>';
            html += '</span>';
            html += '<span class="mixtape-window"><span class="mixtape-reel"></span><span class="mixtape-reel"></span></span>';
            html += '<span class="mixtape-covers">';
            tape.tracks.slice(0, 4).forEach(t => {
                if (t.cover) html += '<img src="' + imgBase + Utils.escapeAttr(t.cover) + '" alt="" loading="lazy">';
            });
            html += '</span>';
            html += '</button>';
        });
        shelf.innerHTML = html;
    }

    function setVisible(visible) {
        const shelf = document.getElementById('mixtape-shelf');
        if (shelf) shelf.style.display = visible ? '' : 'none';
    }

    /* ── Tape box (browse mode) ──
     * Cubbies of tapes lying flat, spines out. Each spine gets a small
     * random offset so the stacks look hand-placed.
     */
    function dealBox() {
        boxIds = register(boxIds, shuffle(buildTapes(BOX_TOPICS, BOX_WILDCARDS)));
        boxIds.forEach(id => { tapesById[id].shift = Math.round(Math.random() * 10 - 5); });
        renderBox(document.getElementById('track-grid'));
    }

    function renderBox(container) {
        if (!container) return;

        let html = '<div class="tape-box-header">';
        html += '<span class="tape-box-count">' + boxIds.length + ' tapes</span>';
        html += '<button type="button" class="mixtape-deal-btn" onclick="Mixtapes.dealBox()" title="Deal new tapes">';
        html += '<span class="material-symbols-outlined">shuffle</span> deal new tapes</button>';
        html += '</div>';

        html += '<div class="tape-box">';
        for (let i = 0; i < boxIds.length; i += TAPES_PER_CUBBY) {
            html += '<div class="tape-cubby">';
            boxIds.slice(i, i + TAPES_PER_CUBBY).forEach(id => {
                const tape = tapesById[id];
                html += '<button type="button" class="tape-spine" style="--shift: ' + tape.shift + 'px;" onclick="Mixtapes.open(' + id + ')" title="Open ' + Utils.escapeAttr(tape.name) + ' tape">';
                html += '<span class="tape-spine-label postit-' + tape.color + '">';
                html += '<span class="tape-spine-name">' + Utils.escapeHtml(tape.name) + '</span>';
                html += '<span class="tape-spine-meta">' + tape.tracks.length + ' · ' + tapeMinutes(tape) + '\'</span>';
                html += '</span></button>';
            });
            html += '</div>';
        }
        html += '</div>';

        container.innerHTML = html;
    }

    /* ── Tracklist (J-card) ── */
    function open(id) {
        const tape = tapesById[id];
        if (!tape) return;

        const imgBase = window.IMAGE_BASE_URL || '/';
        const half = Math.ceil(tape.tracks.length / 2);

        let html = '<div class="detail-card tape-card">';
        html += '<button class="detail-close" onclick="closeModal()" aria-label="Close">&#10005;</button>';
        html += '<div class="tape-card-header">';
        html += '<div class="tape-card-postit postit-' + tape.color + '">' + Utils.escapeHtml(tape.name) + '</div>';
        html += '<div class="tape-card-meta">' + tape.tracks.length + ' songs · ' + tapeMinutes(tape) + ' min</div>';
        html += '<button type="button" class="btn btn-primary tape-play-btn" onclick="Mixtapes.play(' + id + ', 0)">';
        html += '<span class="material-symbols-outlined">play_arrow</span> Play tape</button>';
        html += '</div>';

        html += '<div class="tape-tracklist">';
        tape.tracks.forEach((t, i) => {
            if (i === 0 || i === half) {
                html += '<div class="tape-side">side ' + (i === 0 ? 'A' : 'B') + '</div>';
            }
            html += '<button type="button" class="tape-track" data-deezer-id="' + Utils.escapeAttr(t.deezer_id) + '" onclick="Mixtapes.play(' + id + ', ' + i + ')">';
            html += '<span class="tape-track-num">' + (i + 1) + '</span>';
            html += t.cover ? '<img class="tape-track-cover" src="' + imgBase + Utils.escapeAttr(t.cover) + '" alt="">' : '<span class="tape-track-cover"></span>';
            html += '<span class="tape-track-text"><span class="tape-track-title">' + Utils.escapeHtml(t.title) + '</span>';
            html += '<span class="tape-track-artist">' + Utils.escapeHtml(t.artist) + '</span></span>';
            html += '</button>';
        });
        html += '</div></div>';

        document.getElementById('modal-content').innerHTML = html;
        document.getElementById('track-modal').classList.add('active');
        document.body.classList.add('modal-open');
        AudioPlayer.refreshUI();
    }

    function play(id, startAt) {
        const tape = tapesById[id];
        if (!tape) return;
        AudioPlayer.playQueue(tape.tracks.map(t => t.deezer_id), startAt, tape.name + ' tape');
    }

    /* ── Public Interface ── */
    return {
        init,
        deal,
        dealBox,
        renderBox,
        open,
        play,
        setVisible,
    };
})();
