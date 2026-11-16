(function (root) {
  'use strict';

  const symbolPath = '/assets/saudi-riyal-symbol.png';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
  }

  function symbolMarkup() {
    return `<img class="thanarah-currency-symbol" src="${symbolPath}" alt="رمز الريال السعودي" style="display:inline-block;width:1em;height:1em;object-fit:contain;vertical-align:-.16em;margin-inline-start:.18em">`;
  }

  function valueMarkup(amount, currencyCode = 'SAR') {
    const suffix = currencyCode === 'SAR'
      ? symbolMarkup()
      : ` ${escapeHtml(currencyCode)}`;
    return `<bdi class="thanarah-currency-value" dir="ltr">${escapeHtml(amount)}${suffix}</bdi>`;
  }

  root.ThanarahCurrency = Object.freeze({ symbolMarkup, valueMarkup });
})(window);
