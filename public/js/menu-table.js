// ── Shared Asset Table JS ─────────────────────────────────────
// Handles search + filter for vendor and student modes.
// Vendor-specific JS (status tracking, batch ops, etc.)
// should be loaded AFTER this file in a separate inline script.

(function() {
  var searchEl = document.getElementById('import-search');
  var filterBtns = document.querySelectorAll('.filter-btn');

  window.__menuTable = {
    searchEl: searchEl,
    filterBtns: filterBtns,
    reviewMode: false
  };

  window.__menuTable.applyFilters = function() {
    var q = searchEl ? searchEl.value.toLowerCase().trim() : '';
    var activeBtn = document.querySelector('.filter-btn.is-active');
    var filter = activeBtn ? activeBtn.getAttribute('data-filter') : 'all';
    var rows = document.querySelectorAll('#import-table tbody tr');
    var rMode = window.__menuTable.reviewMode;

    rows.forEach(function(row) {
      if (row.classList.contains('row--deleted')) return;
      var show = true;

      if (q) {
        var text = row.textContent.toLowerCase();
        if (text.indexOf(q) === -1) show = false;
      }

      if (show && filter !== 'all') {
        if (filter === 'ready') {
          var status = row.getAttribute('data-status');
          if (status !== 'ready') show = false;
        } else if (filter === 'available') {
          if (row.getAttribute('data-available') !== 'true') show = false;
        } else if (filter === 'unavailable') {
          if (row.getAttribute('data-available') === 'true') show = false;
        }
      }

      if (show && rMode && filter !== 'ready') {
        if (row.getAttribute('data-status') === 'ready') show = false;
      }

      row.classList.toggle('is-hidden', !show);
    });
  };

  var applyFilters = window.__menuTable.applyFilters;

  if (searchEl) {
    searchEl.addEventListener('input', applyFilters);
  }

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(function(b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      window.__menuTable.reviewMode = false;
      applyFilters();
    });
  });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      if (searchEl) searchEl.focus();
    }
  });
})();
