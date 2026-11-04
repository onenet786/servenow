// Turns every <select> on the page into a box you can type in to filter its list.
//
// The real <select> stays in the page, only hidden, so its id, value, change handlers, form
// submit and validation all work as before. Selects added later are picked up by themselves,
// and options loaded or values set by other scripts show up here without any change to them.
// To leave one alone: <select data-no-search>.
(function () {
    if (window.__snSelect) return;
    window.__snSelect = true;

    const MAX_SHOWN = 300;
    const combos = new WeakMap();
    let openCombo = null;
    let seq = 0;

    const style = document.createElement('style');
    style.textContent = `
.sn-combo-native { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important;
  margin:0 !important; border:0 !important; opacity:0 !important; overflow:hidden !important; pointer-events:none !important; }
.sn-combo-input { box-sizing:border-box; min-width:130px; text-overflow:ellipsis; cursor:pointer; padding-right:30px !important;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%2364748b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E") !important;
  background-repeat:no-repeat !important; background-position:right 10px center !important; }
.app-sidebar .sn-combo-input, .sidebar .sn-combo-input, aside .sn-combo-input { min-width:0; padding-left:7px !important; padding-right:20px !important;
  background-position:right 6px center !important; }
.sn-combo-input:disabled { cursor:not-allowed; opacity:.65; }
.sn-combo-input.is-open { cursor:text; }
.sn-combo-panel { position:fixed; z-index:2147483000; background:#fff; color:#0f172a; border:1px solid #cbd5e1; border-radius:8px;
  box-shadow:0 10px 28px rgba(15,23,42,.18); max-height:280px; overflow-y:auto; padding:4px; font-size:14px; }
.sn-combo-group { padding:7px 10px 3px; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.03em; }
.sn-combo-option { padding:8px 10px; border-radius:6px; cursor:pointer; white-space:normal; overflow-wrap:anywhere; line-height:1.3; }
.sn-combo-option.is-active { background:#e8f5ee; }
.sn-combo-option.is-selected { font-weight:600; color:#166534; }
.sn-combo-option.is-disabled { color:#94a3b8; cursor:not-allowed; }
.sn-combo-empty { padding:10px; color:#64748b; }
.sn-combo-more { padding:7px 10px; color:#64748b; font-size:12px; border-top:1px solid #e2e8f0; margin-top:3px; }
.sn-list-search { box-sizing:border-box; width:100%; margin-bottom:6px; }`;
    document.head.appendChild(style);

    const words = (text) => String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (label, typed) => {
        const hay = String(label || '').toLowerCase();
        return typed.every((w) => hay.includes(w));
    };
    const optionLabel = (option) => String(option.label || option.textContent || '').replace(/\s+/g, ' ').trim();

    function sync(combo) {
        const { select, input } = combo;
        if (!select.isConnected) {
            input.remove();
            return;
        }
        if (select.nextElementSibling !== input) select.after(input);
        input.disabled = select.disabled;
        // A script or stylesheet class hiding the select hides the box too.
        input.hidden = select.hidden;
        input.style.display = select.style.display === 'none' ? 'none' : combo.display;
        input.title = select.title || '';
        if (combo !== openCombo) {
            const chosen = select.options[select.selectedIndex];
            const text = chosen ? optionLabel(chosen) : '';
            if (input.value !== text) input.value = text;
            input.placeholder = chosen ? '' : 'Select...';
        }
    }

    function scheduleSync(select) {
        const combo = combos.get(select);
        if (!combo || combo.pending) return;
        combo.pending = true;
        queueMicrotask(() => {
            combo.pending = false;
            sync(combo);
            if (combo === openCombo) renderList(combo);
        });
    }

    // Scripts set select.value and option.selected directly, which fires no event.
    function watchProperty(proto, name, selectOf) {
        const original = Object.getOwnPropertyDescriptor(proto, name);
        if (!original || !original.set) return;
        Object.defineProperty(proto, name, {
            ...original,
            set(value) {
                original.set.call(this, value);
                const select = selectOf(this);
                if (select) scheduleSync(select);
            },
        });
    }
    watchProperty(HTMLSelectElement.prototype, 'value', (el) => el);
    watchProperty(HTMLSelectElement.prototype, 'selectedIndex', (el) => el);
    watchProperty(HTMLOptionElement.prototype, 'selected', (el) => el.closest('select'));

    function close(keepFocus) {
        const combo = openCombo;
        if (!combo) return;
        openCombo = null;
        combo.panel.remove();
        combo.input.classList.remove('is-open');
        combo.input.setAttribute('aria-expanded', 'false');
        combo.input.removeAttribute('aria-activedescendant');
        sync(combo);
        if (keepFocus) combo.input.focus({ preventScroll: true });
    }

    function place(combo) {
        const { input, panel } = combo;
        const box = input.getBoundingClientRect();
        const width = Math.max(box.width, 220);
        panel.style.width = `${width}px`;
        panel.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
        const roomBelow = window.innerHeight - box.bottom - 8;
        const height = Math.min(panel.scrollHeight, 280);
        if (roomBelow < height && box.top > roomBelow) {
            panel.style.top = `${Math.max(8, box.top - height - 4)}px`;
        } else {
            panel.style.top = `${box.bottom + 4}px`;
        }
    }

    function setActive(combo, node) {
        combo.panel.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active'));
        combo.active = node || null;
        if (!node) {
            combo.input.removeAttribute('aria-activedescendant');
            return;
        }
        node.classList.add('is-active');
        combo.input.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
    }

    function renderList(combo) {
        const { select, panel, input } = combo;
        const typed = combo.typing ? words(input.value) : [];
        const fragment = document.createDocumentFragment();
        let shown = 0;
        let hidden = 0;
        let firstUsable = null;
        let selectedNode = null;
        let lastGroup = null;
        Array.from(select.options).forEach((option, index) => {
            if (option.hidden) return;
            const label = optionLabel(option);
            const group = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
            if (typed.length && !matches(`${label} ${group ? group.label : ''}`, typed)) return;
            if (shown >= MAX_SHOWN) {
                hidden += 1;
                return;
            }
            if (group && group !== lastGroup) {
                const head = document.createElement('div');
                head.className = 'sn-combo-group';
                head.textContent = group.label;
                fragment.appendChild(head);
            }
            lastGroup = group;
            const unusable = option.disabled || (group && group.disabled);
            const node = document.createElement('div');
            node.className = 'sn-combo-option';
            node.id = `${panel.id}-o${index}`;
            node.setAttribute('role', 'option');
            node.dataset.index = String(index);
            node.textContent = label || ' ';
            if (unusable) node.classList.add('is-disabled');
            if (index === select.selectedIndex) {
                node.classList.add('is-selected');
                node.setAttribute('aria-selected', 'true');
                if (!unusable) selectedNode = node;
            }
            if (!unusable && !firstUsable) firstUsable = node;
            fragment.appendChild(node);
            shown += 1;
        });
        panel.replaceChildren(fragment);
        if (!shown) {
            const none = document.createElement('div');
            none.className = 'sn-combo-empty';
            none.textContent = 'No match';
            panel.appendChild(none);
        }
        if (hidden) {
            const more = document.createElement('div');
            more.className = 'sn-combo-more';
            more.textContent = `${hidden} more. Keep typing to narrow the list.`;
            panel.appendChild(more);
        }
        setActive(combo, typed.length ? firstUsable : selectedNode || firstUsable);
        place(combo);
    }

    function open(combo) {
        if (combo === openCombo || combo.select.disabled) return;
        close(false);
        openCombo = combo;
        combo.typing = false;
        combo.input.classList.add('is-open');
        combo.input.setAttribute('aria-expanded', 'true');
        document.body.appendChild(combo.panel);
        renderList(combo);
        combo.input.select();
    }

    function choose(combo, node) {
        if (!node || node.classList.contains('is-disabled')) return;
        const { select } = combo;
        const index = Number(node.dataset.index);
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index;
        close(true);
        if (changed) {
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function move(combo, step) {
        const nodes = Array.from(combo.panel.querySelectorAll('.sn-combo-option:not(.is-disabled)'));
        if (!nodes.length) return;
        const at = nodes.indexOf(combo.active);
        setActive(combo, nodes[at < 0 ? 0 : (at + step + nodes.length) % nodes.length]);
    }

    function labelFor(select) {
        if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
        const label = select.closest('label') || (select.id && document.querySelector(`label[for="${CSS.escape(select.id)}"]`))
            || select.closest('.form-group, .filter-group')?.querySelector('label');
        return label ? label.textContent.trim() : select.title || 'Choose';
    }

    function enhance(select) {
        if (combos.has(select) || select.multiple || select.size > 1 || 'noSearch' in select.dataset) return;
        if (select.classList.contains('sn-select-mirrored') || select.closest('[data-no-search]')) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        // A script may copy an already upgraded select (cloneNode), and the copy keeps our hidden marker.
        select.classList.remove('sn-combo-native');
        input.className = `${select.className} sn-combo-input`.trim();
        const inlineStyle = select.getAttribute('style');
        if (inlineStyle) input.setAttribute('style', inlineStyle.replace(/display\s*:\s*none\s*;?/i, ''));
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-label', labelFor(select));

        seq += 1;
        const panel = document.createElement('div');
        panel.className = 'sn-combo-panel';
        panel.id = `sn-combo-${seq}`;
        panel.setAttribute('role', 'listbox');
        input.setAttribute('aria-controls', panel.id);

        const combo = { select, input, panel, active: null, typing: false, pending: false, display: input.style.display || '' };
        combos.set(select, combo);

        select.classList.add('sn-combo-native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        select.after(input);

        // Some screens load a list only when its select is touched (focus or mousedown): pass that on.
        const touch = () => {
            if (combo === openCombo) return;
            select.dispatchEvent(new FocusEvent('focus'));
            select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        };
        // Like a normal dropdown: the list opens on a click, typing or an arrow key, never just because a
        // script put the cursor here (a form focusing its first field must not cover the fields below).
        input.addEventListener('focus', touch);
        input.addEventListener('mousedown', () => { touch(); open(combo); });
        input.addEventListener('input', () => {
            open(combo);
            combo.typing = true;
            renderList(combo);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (combo !== openCombo) open(combo);
                else move(combo, event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
                if (combo !== openCombo) return;
                event.preventDefault();
                choose(combo, combo.active);
            } else if (event.key === 'Escape' && combo === openCombo) {
                event.stopPropagation();
                close(false);
                input.blur();
            } else if (event.key === 'Tab') {
                close(false);
            }
        });
        // mousedown so the input does not lose focus before the pick lands.
        panel.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const node = event.target.closest('.sn-combo-option');
            if (node) choose(combo, node);
        });
        panel.addEventListener('mousemove', (event) => {
            const node = event.target.closest('.sn-combo-option:not(.is-disabled)');
            if (node && node !== combo.active) {
                combo.panel.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active'));
                node.classList.add('is-active');
                combo.active = node;
            }
        });

        // A label click, or a script calling select.focus(), lands on the box.
        select.addEventListener('focus', (event) => { if (event.isTrusted) input.focus(); });
        select.addEventListener('change', () => scheduleSync(select));
        select.addEventListener('invalid', () => input.focus());

        new MutationObserver(() => scheduleSync(select)).observe(select, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['disabled', 'hidden', 'style', 'label'],
        });
        sync(combo);
    }

    // Long ticked lists (customers to notify and so on) cannot drop down, so they get a filter box.
    function enhanceList(select) {
        if (!select.multiple || combos.has(select) || 'noSearch' in select.dataset) return;
        combos.set(select, { select, input: null });
        const filter = document.createElement('input');
        filter.type = 'search';
        filter.autocomplete = 'off';
        filter.placeholder = 'Type to filter this list...';
        filter.className = 'form-control sn-list-search';
        filter.setAttribute('aria-label', `Filter ${labelFor(select)}`);
        select.before(filter);
        filter.addEventListener('input', () => {
            const typed = words(filter.value);
            Array.from(select.options).forEach((option) => {
                option.hidden = !option.selected && typed.length > 0 && !matches(optionLabel(option), typed);
            });
        });
    }

    function scan(root) {
        if (root.nodeType !== 1) return;
        const found = root.matches('select') ? [root] : root.querySelectorAll('select');
        found.forEach((select) => {
            if (select.multiple) enhanceList(select);
            else enhance(select);
        });
    }

    function start() {
        scan(document.body);
        new MutationObserver((records) => {
            for (const record of records) {
                record.addedNodes.forEach(scan);
                record.removedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    const removed = node.matches('select') ? [node] : node.querySelectorAll('select');
                    removed.forEach((select) => {
                        const combo = combos.get(select);
                        if (combo && combo.input) {
                            // A select that was only moved is back in the page by the next tick.
                            setTimeout(() => {
                                if (!select.isConnected) {
                                    const wasOpen = combo === openCombo;
                                    if (wasOpen) close(false);
                                    combo.input.remove();
                                    // A screen that swaps in a fuller copy of the list while it is open: carry on there.
                                    const fresh = wasOpen && select.id ? document.getElementById(select.id) : null;
                                    const next = fresh && combos.get(fresh);
                                    if (next?.input) setTimeout(() => { next.input.focus(); open(next); }, 0);
                                } else sync(combo);
                            }, 0);
                        }
                    });
                });
            }
        }).observe(document.body, { childList: true, subtree: true });

        document.addEventListener('mousedown', (event) => {
            if (openCombo && event.target !== openCombo.input && !openCombo.panel.contains(event.target)) close(false);
        }, true);
        document.addEventListener('reset', (event) => {
            setTimeout(() => event.target.querySelectorAll('select').forEach(scheduleSync), 0);
        });
        const follow = (event) => {
            if (openCombo && !(event.target instanceof Node && openCombo.panel.contains(event.target))) place(openCombo);
        };
        window.addEventListener('scroll', follow, true);
        window.addEventListener('resize', follow);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
