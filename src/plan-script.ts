import { createHash } from 'node:crypto';

// The one script a plan may run. It is owned by planny, injected into plan
// responses only, and allowed by the CSP hash below. Plan-authored scripts are
// still removed by the sanitiser.
export const PLAN_SCRIPT = `(function () {
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacyCopy(text)); });
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
    button.textContent = 'Copy';
    if (!head) {
      button.style.position = 'absolute';
      button.style.top = '8px';
      button.style.right = '8px';
    }
    var timer = 0;
    button.addEventListener('click', function () {
      copyText(code.innerText || code.textContent || '').then(function (ok) {
        if (!ok) return;
        button.textContent = 'Copied';
        clearTimeout(timer);
        timer = setTimeout(function () { button.textContent = 'Copy'; }, 1500);
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
