const fs = require('fs')
const path = require('path')
const root = __dirname
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const iife = read('vendor/MindElixir.iife.js')
const css = read('vendor/MindElixir.css')
const core = read('src/core.js')
const theme = read('src/theme.js')
const app = read('src/app.js')
const entry = read('src/entry.js')

const out = `window.__ModuleLoader__.load({
	id: "dsh-node-mindmap",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");

		/* ---- vendored mind-elixir@5.15.1 (MIT, see vendor/LICENSE) ---- */
${iife}
		globalThis.MindElixir = MindElixir;
		/* ---- end vendored mind-elixir ---- */

		const NM_CSS = ${JSON.stringify(css)};

${core}
${theme}
${app}
${entry}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
`
fs.writeFileSync(path.join(root, 'lib/client.js'), out)
console.log('built lib/client.js', fs.statSync(path.join(root, 'lib/client.js')).size, 'bytes')
