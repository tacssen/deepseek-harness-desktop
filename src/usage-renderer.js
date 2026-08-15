(() => {
  const $ = (id) => document.getElementById(id);
  const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value);
  const number = (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0);
  const money = (value, currency = 'USD') => value == null ? '—' : `${currency} ${Number(value).toFixed(6)}`;
  const message = (value, kind = '') => { $('message').textContent = value; $('message').className = kind; };
  function aggregateCard(title, value) {
    return `<article class="card"><span class="period">${title}</span><div class="value">${number(value.totalTokens)} tokens</div><div class="meta">${number(value.requests)} requests · ${money(value.estimatedCost, value.currency)}<br>in ${number(value.promptTokens)} · out ${number(value.completionTokens)} · reasoning ${number(value.reasoningTokens)}</div></article>`;
  }
  function render(data) {
    const currency = data.pricing?.currency || 'USD';
    const balance = data.balance || {};
    $('balanceStatus').textContent = balance.status === 'official-unavailable' ? '官方余额接口不可用' : text(balance.status);
    $('balanceMessage').textContent = text(balance.message, '请打开 DeepSeek Billing 页面查看真实余额。');
    $('paths').textContent = data.paths?.dataDir ? `本地数据：${data.paths.dataDir}` : '';
    $('cards').innerHTML = [aggregateCard('Today', data.today || {}), aggregateCard('Last 7 days', data.last7Days || {}), aggregateCard('This month', data.month || {}), aggregateCard('Current session', data.session || {})].join('');
    const rows = Array.isArray(data.records) ? data.records : [];
    $('empty').hidden = rows.length > 0;
    $('records').innerHTML = rows.map((record) => `<tr><td>${text(record.requestAt)}</td><td>${text(record.provider)}<br>${text(record.model)}</td><td>${text(record.sessionId, 'connection')}</td><td>${number(record.promptTokens)}</td><td>${number(record.completionTokens)}</td><td>${number(record.totalTokens)}</td><td>${money(record.estimatedCost, currency)}</td></tr>`).join('');
  }
  async function load() { try { render(await window.usage.load()); } catch (error) { message(error.message, 'warn'); } }
  $('refresh').addEventListener('click', load);
  $('billing').addEventListener('click', async () => { try { await window.usage.billing(); message('已打开官方 Billing 页面。', 'good'); } catch (error) { message(error.message, 'warn'); } });
  $('close').addEventListener('click', () => window.usage.close());
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.usage.close(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); load(); } });
  load();
})();
