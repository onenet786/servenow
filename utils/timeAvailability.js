/**
 * Utility functions for product time-based availability
 */

function formatTime12h(timeStr) {
    if (!timeStr) return '';
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return String(timeStr);
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1].slice(0, 2);
    if (isNaN(hours)) return String(timeStr);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
}

function normalizeTimeHHMM(timeStr) {
    if (!timeStr) return null;
    const s = String(timeStr).trim();
    if (!s) return null;
    // Matches HH:mm or HH:mm:ss
    const match = s.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
        const h = match[1].padStart(2, '0');
        const m = match[2];
        return `${h}:${m}`;
    }
    return null;
}

function checkProductTimeAvailability(availableFrom, availableTo, currentTime = null) {
    const from = normalizeTimeHHMM(availableFrom);
    const to = normalizeTimeHHMM(availableTo);

    // If both or either is not set, availability is unconstrained (24/7 all day)
    if (!from || !to) {
        return {
            isTimeAvailable: true,
            isRestricted: false,
            from: null,
            to: null,
            label: null,
            opensAt: null
        };
    }

    let cur = normalizeTimeHHMM(currentTime);
    if (!cur) {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        cur = `${hours}:${minutes}`;
    }

    let isTimeAvailable = false;
    if (from <= to) {
        // Standard daytime window (e.g. 07:00 to 12:00)
        isTimeAvailable = (cur >= from && cur <= to);
    } else {
        // Midnight wrap-around window (e.g. 22:00 to 03:00)
        isTimeAvailable = (cur >= from || cur <= to);
    }

    const label = `${formatTime12h(from)} - ${formatTime12h(to)}`;
    return {
        isTimeAvailable,
        isRestricted: true,
        from,
        to,
        label,
        opensAt: formatTime12h(from)
    };
}

module.exports = {
    formatTime12h,
    normalizeTimeHHMM,
    checkProductTimeAvailability
};
