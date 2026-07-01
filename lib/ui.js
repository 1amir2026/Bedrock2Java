'use strict';
const readline = require('readline');

// ---- Color palette (kept intentionally minimal: cyan/aqua, red, green, plain) ----
const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

const color = {
  cyan: (s) => c('36', s),
  aqua: (s) => c('96', s), // bright cyan
  red: (s) => c('31', s),
  green: (s) => c('32', s),
  dim: (s) => c('2', s),
  bold: (s) => c('1', s),
  reset: '\x1b[0m'
};

function ok(msg) {
  console.log(color.green('[OK]   ') + msg);
}
function err(msg) {
  console.log(color.red('[ERROR]') + ' ' + msg);
}
function info(msg) {
  console.log(color.aqua('[INFO] ') + msg);
}
function step(msg) {
  console.log(color.cyan('-> ') + msg);
}
function heading(msg) {
  console.log('');
  console.log(color.bold(color.aqua(msg)));
  console.log(color.cyan('='.repeat(msg.length)));
}

// ---- Progress bar: [#####---------] 11.5% ----
function renderProgressBar(current, total, label, width = 50) {
  const pct = total === 0 ? 100 : (current / total) * 100;
  const filled = Math.round((pct / 100) * width);
  const bar = '#'.repeat(Math.max(0, filled)) + '-'.repeat(Math.max(0, width - filled));
  const line = `[${bar}]  ${pct.toFixed(1)}%`;
  if (isTTY) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(color.cyan(line) + (label ? '  ' + color.dim(label) : ''));
  } else {
    process.stdout.write(line + (label ? '  ' + label : '') + '\n');
  }
}
function endProgress() {
  if (isTTY) process.stdout.write('\n');
}

// ---- Interactive prompt: navigate with Up/Down/PageUp/PageDown, Space to toggle (multi), Enter to confirm ----
// options: [{label, value, hint?}]
function selectPrompt({ question, options, multi = false, defaultIndex = 0, defaultChecked = false }) {
  return new Promise((resolve) => {
    if (!isTTY) {
      // Fallback for non-interactive environments: pick default(s)
      console.log(color.aqua('? ') + question);
      const chosen = multi ? (defaultChecked ? options.map((o) => o.value) : []) : [options[defaultIndex].value];
      console.log(color.dim('  (non-interactive shell: using default selection)'));
      resolve(multi ? chosen : chosen[0]);
      return;
    }

    let index = defaultIndex;
    const checked = new Set(multi && defaultChecked ? options.map((_, i) => i) : []);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    const render = (first = false) => {
      if (!first) {
        // move cursor up to redraw (options + header lines)
        readline.moveCursor(process.stdout, 0, -(options.length + 2));
        readline.cursorTo(process.stdout, 0);
      }
      console.log(color.aqua('? ') + color.bold(question));
      console.log(
        color.dim(
          multi
            ? '  (Up/Down or PgUp/PgDown to move, Space to toggle, Enter to confirm)'
            : '  (Up/Down or PgUp/PgDown to move, Enter to select)'
        )
      );
      options.forEach((opt, i) => {
        const cursor = i === index ? color.cyan('>') : ' ';
        let mark = '';
        if (multi) mark = checked.has(i) ? color.green('[x] ') : '[ ] ';
        const label = i === index ? color.cyan(opt.label) : opt.label;
        const hint = opt.hint ? color.dim('  - ' + opt.hint) : '';
        console.log(`  ${cursor} ${mark}${label}${hint}`);
      });
    };

    render(true);

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    };

    const onKey = (str, key) => {
      if (!key) return;
      if (key.name === 'up') {
        index = (index - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down') {
        index = (index + 1) % options.length;
        render();
      } else if (key.name === 'pageup') {
        index = Math.max(0, index - 5);
        render();
      } else if (key.name === 'pagedown') {
        index = Math.min(options.length - 1, index + 5);
        render();
      } else if (key.name === 'home') {
        index = 0;
        render();
      } else if (key.name === 'end') {
        index = options.length - 1;
        render();
      } else if (multi && key.name === 'space') {
        if (checked.has(index)) checked.delete(index);
        else checked.add(index);
        render();
      } else if (key.name === 'return') {
        cleanup();
        console.log('');
        if (multi) {
          const result = [...checked].sort((a, b) => a - b).map((i) => options[i].value);
          resolve(result);
        } else {
          resolve(options[index].value);
        }
      } else if (key.ctrl && key.name === 'c') {
        cleanup();
        console.log(color.red('\nAborted by user.'));
        process.exit(1);
      }
    };

    process.stdin.on('keypress', onKey);
  });
}

// ---- Simple free-text prompt (paths, names, etc.) ----
let sharedRl = null;
function getSharedRl() {
  if (!sharedRl) {
    sharedRl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedRl;
}
function closeTextPrompt() {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
  }
}

function textPrompt({ question, defaultValue = '', validate }) {
  return new Promise((resolve) => {
    const rl = getSharedRl();
    const suffix = defaultValue ? color.dim(` (${defaultValue})`) : '';
    const ask = () => {
      rl.question(color.aqua('? ') + color.bold(question) + suffix + ' ', (answer) => {
        const value = answer.trim() === '' ? defaultValue : answer.trim();
        if (validate) {
          const result = validate(value);
          if (result !== true) {
            console.log(color.red('  ' + result));
            return ask();
          }
        }
        resolve(value);
      });
    };
    ask();
  });
}

module.exports = {
  color,
  ok,
  err,
  info,
  step,
  heading,
  renderProgressBar,
  endProgress,
  selectPrompt,
  textPrompt,
  closeTextPrompt
};
