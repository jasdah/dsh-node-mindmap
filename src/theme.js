/* ------------------------------------------------------------------ *
 * dsh-node-mindmap · theme
 * Rounded-rectangle nodes. mind-elixir paints node shape from the
 * `--root-radius` / `--main-radius` CSS variables; the default theme is a
 * pill, so we clone it and square the corners while keeping the palette.
 * ------------------------------------------------------------------ */

function roundedTheme(MindElixir) {
  var base = (MindElixir && MindElixir.THEME) || {}
  var cssVar = Object.assign({}, base.cssVar || {}, {
    '--root-radius': '10px',
    '--main-radius': '8px',
    '--root-color': '#ffffff',
    '--root-bgcolor': '#3f4f74',
    '--root-border-color': 'rgba(126, 160, 255, 0.45)',
    '--main-border': '1px solid #3b4250',
    '--main-color': '#e7eaf1',
    '--main-bgcolor': '#232730',
    '--main-bgcolor-transparent': 'rgba(35, 39, 48, 0.94)',
    '--topic-padding': '5px 10px',
    '--color': '#8d95a8',
    '--bgcolor': '#171a20',
    '--selected': '#4dc4ff',
    '--accent-color': '#5b8cff',
    '--panel-color': '#e2e6ee',
    '--panel-bgcolor': '#232730',
    '--panel-border-color': '#3b4250',
    '--map-padding': '40px 64px',
    '--node-gap-x': '30px',
    '--node-gap-y': '12px',
    '--main-gap-x': '54px',
    '--main-gap-y': '38px'
  })
  return {
    name: 'DSH Rounded',
    type: 'dark',
    palette: base.palette || [],
    cssVar: cssVar
  }
}
