// Customer pages: the open branches (cities). While only one branch is open the pages stay exactly
// as they are. With two or more, the city text names them all, registration asks for the city, and
// a visitor who is not signed in picks a city in the header to browse its stores. For a signed-in
// customer the server always uses the account's own branch, whatever is sent here.
(function () {
  var base = window.location.protocol + '//' + window.location.host;
  var CITY_KEY = 'serveNowCity';
  var BROWSE = /^\/api\/(stores(\/(live-promotions|global-delivery-status|customer-flash-message))?|products|orders\/delivery-fee-config)$/;

  var baseFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var city = localStorage.getItem(CITY_KEY);
      if (city && typeof input === 'string') {
        var url = new URL(input, window.location.href);
        var method = String((init && init.method) || 'GET').toUpperCase();
        if (method === 'GET' && url.origin === window.location.origin && BROWSE.test(url.pathname) && !url.searchParams.has('branch_id')) {
          url.searchParams.set('branch_id', city);
          input = url.toString();
        }
      }
    } catch (_) { /* send the request as it was */ }
    return baseFetch(input, init);
  };

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function join(names) {
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function addHeaderPicker(list) {
    if (localStorage.getItem('serveNowToken')) return;
    var host = document.querySelector('.app-header .header-right');
    if (!host) return;
    var select = document.createElement('select');
    select.id = 'cityPicker';
    select.setAttribute('aria-label', 'Your city');
    list.forEach(function (b) {
      select.add(new Option(b.name, String(b.id)));
    });
    var city = localStorage.getItem(CITY_KEY);
    select.value = list.some(function (b) { return String(b.id) === city; }) ? city : String(list[0].id);
    select.addEventListener('change', function () {
      var cart = [];
      try { cart = JSON.parse(localStorage.getItem('serveNowCart')) || []; } catch (_) { /* treated as empty */ }
      if (cart.length && !window.confirm('Your cart will be emptied, because stores differ by city. Continue?')) {
        select.value = localStorage.getItem(CITY_KEY) || String(list[0].id);
        return;
      }
      localStorage.removeItem('serveNowCart');
      localStorage.setItem(CITY_KEY, select.value);
      window.location.reload();
    });
    host.insertBefore(select, host.firstChild);
  }

  function fillRegistration(list) {
    var field = document.getElementById('branchField');
    var select = document.getElementById('branchSelect');
    if (!field || !select) return;
    var choose = document.createElement('option');
    choose.value = '';
    choose.textContent = 'Choose your city';
    select.appendChild(choose);
    list.forEach(function (b) {
      var option = document.createElement('option');
      option.value = String(b.id);
      option.textContent = b.name;
      select.appendChild(option);
    });
    var city = localStorage.getItem(CITY_KEY);
    if (city) select.value = city;
    select.disabled = false;
    select.required = true;
    field.hidden = false;
  }

  baseFetch(base + '/api/branches')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var list = (data && data.branches) || [];
      if (list.length < 2) {
        localStorage.removeItem(CITY_KEY);
        return;
      }

      var cities = join(list.map(function (b) { return b.name; }));

      document.querySelectorAll('[data-branch-text]').forEach(function (el) {
        el.textContent = el.getAttribute('data-branch-text').replace('{cities}', cities);
      });
      document.querySelectorAll('[data-branch-html]').forEach(function (el) {
        el.innerHTML = el.getAttribute('data-branch-html').replace('{cities}', esc(cities));
      });
      document.querySelectorAll('[data-branch-placeholder]').forEach(function (el) {
        el.setAttribute('placeholder', el.getAttribute('data-branch-placeholder'));
      });

      addHeaderPicker(list);
      fillRegistration(list);
    })
    .catch(function () { /* the pages work without it */ });
})();
