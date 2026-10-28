/**
 * mixtapes.js — A shelf of generated mixtapes (groups of ~12 songs).
 *
 * Each visit deals a fresh set: topic tapes built from one tag or a pair of
 * tags, plus a pure-random "wildcard". Opening a tape shows its tracklist;
 * playing it queues the songs in order through AudioPlayer.
 *
 * Depends on: Utils (utils.js), AudioPlayer (audio.js)
 */
const Mixtapes = (function () {
    'use strict';

    const TAPE_LENGTH = 12;
    const TOPIC_TAPES = 5;
    const MIN_TAG_SONGS = 8;
    const MIN_TAPE_SONGS = 8;
    const MAX_PER_ARTIST = 2;
    const POSTIT_COLORS = ['yellow', 'pink', 'green', 'blue', 'orange'];

    let allTracks = [];
    let tapes = [];

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

    function tagCounts() {
        const counts = {};
        allTracks.forEach(t => (t.tags || []).forEach(tag => {
            counts[tag] = (counts[tag] || 0) + 1;
        }));
        return counts;
    }

    /* ── Dealing tapes ── */
    function deal() {
        const counts = tagCounts();
        const usable = shuffle(Object.keys(counts).filter(tag => counts[tag] >= MIN_TAG_SONGS));
        const used = new Set();
        tapes = [];

        for (const tag of usable) {
            if (tapes.length >= TOPIC_TAPES) break;

            // Half the time, narrow the topic with a second tag
            let tags = [tag];
            if (Math.random() < 0.5) {
                const pool = tracksWithTags([tag]);
                const partners = shuffle(Object.keys(counts).filter(other => {
                    if (other === tag) return false;
                    const both = pool.filter(t => t.tags.includes(other)).length;
                    return both >= MIN_TAG_SONGS && both < pool.length;
                }));
                if (partners.length) tags = [tag, partners[0]];
            }

            // The per-artist cap can thin a topic out; fall back to the single tag
            let tracks = pickSongs(tracksWithTags(tags));
            if (tracks.length < MIN_TAPE_SONGS && tags.length > 1) {
                tags = [tag];
                tracks = pickSongs(tracksWithTags(tags));
            }
            if (tracks.length < MIN_TAPE_SONGS) continue;

            const key = tags.slice().sort().join('+');
            if (used.has(key)) continue;
            used.add(key);

            tapes.push({ name: tags.join(' + '), tags: tags, tracks: tracks });
        }

        tapes.push({ name: 'wildcard', tags: [], tracks: pickSongs(allTracks) });
        tapes.forEach((tape, i) => { tape.color = POSTIT_COLORS[i % POSTIT_COLORS.length]; });

        render();
    }

    function tapeMinutes(tape) {
        const secs = tape.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        return Math.round(secs / 60);
    }

    /* ── Shelf ── */
    function render() {
        const shelf = document.getElementById('mixtape-shelf-tapes');
        if (!shelf) return;

        const imgBase = window.IMAGE_BASE_URL || '/';
        let html = '';
        tapes.forEach((tape, i) => {
            html += '<button type="button" class="mixtape" onclick="Mixtapes.open(' + i + ')" title="Open ' + Utils.escapeAttr(tape.name) + ' tape">';
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

    /* ── Tracklist (J-card) ── */
    function open(index) {
        const tape = tapes[index];
        if (!tape) return;

        const imgBase = window.IMAGE_BASE_URL || '/';
        const half = Math.ceil(tape.tracks.length / 2);

        let html = '<div class="detail-card tape-card">';
        html += '<button class="detail-close" onclick="closeModal()" aria-label="Close">&#10005;</button>';
        html += '<div class="tape-card-header">';
        html += '<div class="tape-card-postit postit-' + tape.color + '">' + Utils.escapeHtml(tape.name) + '</div>';
        html += '<div class="tape-card-meta">' + tape.tracks.length + ' songs · ' + tapeMinutes(tape) + ' min</div>';
        html += '<button type="button" class="btn btn-primary tape-play-btn" onclick="Mixtapes.play(' + index + ', 0)">';
        html += '<span class="material-symbols-outlined">play_arrow</span> Play tape</button>';
        html += '</div>';

        html += '<div class="tape-tracklist">';
        tape.tracks.forEach((t, i) => {
            if (i === 0 || i === half) {
                html += '<div class="tape-side">side ' + (i === 0 ? 'A' : 'B') + '</div>';
            }
            html += '<button type="button" class="tape-track" data-deezer-id="' + Utils.escapeAttr(t.deezer_id) + '" onclick="Mixtapes.play(' + index + ', ' + i + ')">';
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

    function play(index, startAt) {
        const tape = tapes[index];
        if (!tape) return;
        AudioPlayer.playQueue(tape.tracks.map(t => t.deezer_id), startAt, tape.name + ' tape');
    }

    /* ── Public Interface ── */
    return {
        init,
        deal,
        open,
        play,
        setVisible,
    };
})();
