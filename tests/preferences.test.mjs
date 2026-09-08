/* eslint-disable @typescript-eslint/no-deprecated -- Test doubles intentionally replace browser APIs; merged DOM/Worker overloads flag these fixture properties. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import translations from '../lib/translations.json' with { type: 'json' };
import { readPreferences, translate, translateMessage } from '../lib/i18n.ts';

test('preferences restore valid choices and survive corrupt or blocked storage', () => {
  assert.deepEqual(readPreferences({ getItem: () => '{"locale":"en","theme":"dark"}' }, 'fr-FR', false), { locale: 'en', theme: 'dark' });
  assert.deepEqual(readPreferences({ getItem: () => '{broken' }, 'fr-CA', true), { locale: 'fr', theme: 'dark' });
  assert.deepEqual(readPreferences({ getItem: () => '{"locale":"xx","theme":"invalid"}' }, 'de-DE', false), { locale: 'en', theme: 'light' });
  assert.deepEqual(readPreferences({ getItem() { throw new Error('Blocked'); } }, 'en-GB', true), { locale: 'en', theme: 'dark' });
});

test('all scanner errors and UI translation keys have English translations', async () => {
  for (const file of ['app/page.tsx', 'components/image-editor.tsx', 'components/share-app.tsx', 'components/perspective-cropper.tsx', 'lib/document.ts', 'lib/image-geometry.ts', 'lib/image-pixels.ts', 'lib/pdf.ts', 'hooks/use-local-draft.ts', 'hooks/use-pdf-export.ts', 'hooks/use-scanner.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(Object.hasOwn(translations, node.arguments[0].text), node.arguments[0].text);
      }
      if (ts.isNewExpression(node) && node.expression.getText(tree) === 'Error' && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(Object.hasOwn(translations, node.arguments[0].text), node.arguments[0].text);
      }
      if (ts.isJsxText(node)) assert.ok(!/[éèà’]/.test(node.text), `Untranslated JSX in ${file}: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.equal(translate('en', 'Saisissez un nombre entier entre 1 et {max}.', { max: 200 }), 'Enter a whole number between 1 and 200.');
  assert.equal(translateMessage('en', 'La page 2 doit être préparée. Sélectionnez-la pour réessayer.'), 'Page 2 needs processing. Select it to try again.');
});

test('theme bootstrap follows device settings and honors a saved override before paint', async () => {
  const script = await readFile(new URL('../public/preferences-init.js', import.meta.url), 'utf8');
  for (const [stored, systemDark, expected] of [[null, true, true], ['{"theme":"light"}', true, false], ['{"theme":"dark"}', false, true], ['broken', false, false]]) {
    let actual;
    runInNewContext(script, {
      window: { matchMedia: () => ({ matches: systemDark }) },
      localStorage: { getItem: () => stored },
      document: { documentElement: { classList: { toggle: (name, value) => { assert.equal(name, 'dark'); actual = value; } } } },
    });
    assert.equal(actual, expected);
  }
});

test('preference controls persist choices and update language and theme together', async t => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const require = createRequire(import.meta.url);
  const React = await import('react');
  const { create, act } = await import('react-test-renderer');
  let source = await readFile(new URL('../components/preferences.tsx', import.meta.url), 'utf8');
  source = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const specifier of ['react', 'react/jsx-runtime', 'lucide-react']) {
    source = source.replaceAll(`from "${specifier}"`, `from '${pathToFileURL(require.resolve(specifier)).href}'`).replaceAll(`from '${specifier}'`, `from '${pathToFileURL(require.resolve(specifier)).href}'`);
  }
  source = source.replace("from '@/lib/i18n'", `from '${new URL('../lib/i18n.ts', import.meta.url).href}'`);
  const { PreferencesProvider, usePreferences } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let stored = '{"locale":"en","theme":"dark"}', dark, api;
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = { localStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } }, matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: { lang: 'fr', classList: { toggle: (_, value) => { dark = value; } } }, querySelector: () => null };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  function Probe() { const value = usePreferences(); React.useLayoutEffect(() => { api = value; }); return null; }
  await act(async () => { root = create(React.createElement(PreferencesProvider, null, React.createElement(Probe))); });
  assert.equal(api.t('Rogner'), 'Crop');
  assert.equal(dark, true);
  await act(async () => { api.setLocale('fr'); api.setTheme('light'); });
  assert.equal(api.t('Rogner'), 'Rogner');
  assert.equal(document.documentElement.lang, 'fr');
  assert.equal(dark, false);
  assert.deepEqual(JSON.parse(stored), { locale: 'fr', theme: 'light' });
});
