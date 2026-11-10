/* 只做源码与契约检查，不冒充微信开发者工具编译。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'tools') walk(p);
    } else files.push(p);
  }
}
walk(root);
const errors = [];
function fail(file, message) {
  errors.push(path.relative(root, file) + ': ' + message);
}
let scripts = 0,
  jsons = 0,
  templates = 0,
  handlers = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.js')) {
    scripts++;
    try {
      new vm.Script(text, { filename: file });
    } catch (e) {
      fail(file, e.message);
    }
    for (const m of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (!m[1].startsWith('.')) {
        fail(file, '原生包不接受未构建的 npm require: ' + m[1]);
        continue;
      }
      const target = path.resolve(path.dirname(file), m[1]);
      if (!target.startsWith(root + path.sep)) fail(file, 'require 跨越微信项目根目录');
      if (
        ![target, target + '.js', path.join(target, 'index.js')].some(
          (p) => fs.existsSync(p) && fs.statSync(p).isFile()
        )
      )
        fail(file, 'require 路径不存在: ' + m[1]);
    }
    if (/\b(?:window|document|localStorage)\s*[.[]/.test(text)) fail(file, '微信工程出现浏览器专属对象');
    if (file.includes(path.sep + 'pages' + path.sep) && /\bwx\./.test(text))
      fail(file, '业务页面绕过平台适配层');
  }
  if (file.endsWith('.json')) {
    jsons++;
    try {
      JSON.parse(text);
    } catch (e) {
      fail(file, e.message);
    }
  }
  if (file.endsWith('.wxml')) {
    templates++;
    for (const m of text.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g))
      if (!m[1].startsWith('{{') || !m[1].endsWith('}}')) fail(file, '动态控制属性缺少 {{}}: ' + m[0]);
    const script = file.replace(/\.wxml$/, '.js');
    let page;
    try {
      vm.runInNewContext(
        fs.readFileSync(script, 'utf8'),
        {
          require: (spec) => require(path.resolve(path.dirname(script), spec)),
          getApp: () => ({ globalData: {} }),
          Page: (v) => {
            page = v;
          },
          Component: (v) => {
            page = v.methods;
          },
          console
        },
        { filename: script }
      );
    } catch (e) {
      fail(file, '页面初始化失败: ' + e.message);
    }
    for (const m of text.matchAll(/\b(?:bind|catch)(?::)?[\w-]+="([a-zA-Z_$][\w$]*)"/g)) {
      handlers++;
      if (!page || typeof page[m[1]] !== 'function') fail(file, '事件函数不存在: ' + m[1]);
    }
  }
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
for (const route of app.pages)
  for (const ext of ['.js', '.json', '.wxml'])
    if (!fs.existsSync(path.join(root, route + ext)))
      fail(path.join(root, 'app.json'), '路由文件缺失 ' + route + ext);
for (const item of app.tabBar.list)
  if (!app.pages.includes(item.pagePath))
    fail(path.join(root, 'app.json'), 'Tab 路由未注册 ' + item.pagePath);
const result = {
  check: 'native-source-static',
  passed: !errors.length,
  scripts,
  jsons,
  templates,
  handlers,
  pages: app.pages.length,
  errors,
  notVerified: [
    'WeChat DevTools compiler',
    'WXML runtime rendering',
    'real device',
    'real WeChat login',
    'production domain'
  ]
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
