import { createHash } from 'node:crypto';

// The one script a plan may run. It is owned by planny, injected into plan
// responses only, and allowed by the CSP hash below. Plan-authored scripts are
// still removed by the sanitiser.
export const PLAN_SCRIPT = `(function () {
  var COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a1 1 0 0 1 1-1h9"></path></svg>';
  var CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"></path></svg>';
  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacyCopy(text)); });
          return;
        }
      } catch (error) {
        resolve(legacyCopy(text));
        return;
      }
      resolve(legacyCopy(text));
    });
  }
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.left = '-1000px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function status(block, message) {
    var live = block.querySelector('.code-copy-status');
    if (!live) {
      live = document.createElement('span');
      live.className = 'code-copy-status';
      live.setAttribute('aria-live', 'polite');
      live.style.position = 'absolute';
      live.style.width = '1px';
      live.style.height = '1px';
      live.style.margin = '-1px';
      live.style.padding = '0';
      live.style.overflow = 'hidden';
      live.style.clip = 'rect(0 0 0 0)';
      live.style.whiteSpace = 'nowrap';
      live.style.border = '0';
      block.appendChild(live);
    }
    live.textContent = message;
  }
  function enhance(block) {
    if (block.getAttribute('data-copy-ready') === 'true') return;
    var code = block.querySelector('pre code') || block.querySelector('pre');
    if (!code) return;
    block.setAttribute('data-copy-ready', 'true');
    var head = block.querySelector('.code-head');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.setAttribute('aria-label', 'Copy code');
    button.innerHTML = COPY_ICON;
    if (!head) {
      button.style.position = 'absolute';
      button.style.top = '4px';
      button.style.right = '4px';
      button.style.width = '32px';
      button.style.height = '32px';
      button.style.padding = '0';
      button.style.border = '0';
      button.style.background = 'transparent';
      button.style.color = '#a1a1a1';
    }
    var timer = 0;
    button.addEventListener('click', function () {
      copyText(code.innerText || code.textContent || '').then(function (ok) {
        if (!ok) return;
        button.innerHTML = CHECK_ICON;
        status(block, 'Copied');
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.innerHTML = COPY_ICON;
          status(block, '');
        }, 1500);
      });
    });
    if (head) head.appendChild(button);
    else block.appendChild(button);
  }
  var blocks = document.querySelectorAll('.code-block');
  for (var i = 0; i < blocks.length; i++) enhance(blocks[i]);
})();`;

export const PLAN_SCRIPT_TAG = `<script>${PLAN_SCRIPT}</script>`;

export const PLAN_SCRIPT_HASH = createHash('sha256').update(PLAN_SCRIPT).digest('base64');
