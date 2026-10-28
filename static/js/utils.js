/**
 * utils.js — Shared utility functions for the music library.
 */
const Utils = (function () {
    'use strict';

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

    function downloadBlob(content, filename, mimeType) {
        const a = document.createElement('a');
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        a.setAttribute('href', url);
        a.setAttribute('download', filename);
        a.click();
        URL.revokeObjectURL(url);
    }

    /* Post-it colour for a tag, from a hash of its name, so a tag looks the
       same everywhere (song details, tag cards, mixtape labels). */
    const POSTIT_COLORS = ['yellow', 'pink', 'green', 'blue', 'orange'];
    function tagColor(tag) {
        let hash = 0;
        for (const ch of tag) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
        return POSTIT_COLORS[Math.abs(hash) % POSTIT_COLORS.length];
    }

    return { escapeHtml, escapeAttr, downloadBlob, tagColor };
})();
