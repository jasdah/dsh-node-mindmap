const fs = require('fs')
const vm = require('vm')
const assert = require('assert')

const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(__dirname + '/../src/core.js', 'utf8') + '\nthis.parseMarkdown = parseMarkdown;', sandbox)
const parse = sandbox.parseMarkdown

// 1. headings + ordered list + nested list
const tree1 = parse('## 结论\n\n1. 甲\n2. 乙\n   - 乙一\n   - 乙二\n3. 丙\n').root
assert.strictEqual(tree1.topic, '结论')
assert.strictEqual(tree1.children.length, 3)
assert.strictEqual(tree1.children[1].children.length, 2)
assert.strictEqual(tree1.children[1].children[1].topic, '乙二')

// 2. fenced code (``` and ~~~) never becomes nodes
const tree2 = parse('## A\n\n```\n## 假标题\n- 假列表\n```\n~~~\n- 波浪线里\n~~~\n- 真列表\n').root
assert.strictEqual(tree2.children.length, 1)
assert.strictEqual(tree2.children[0].topic, '真列表')

// 3. task-list checkbox stripped
const tree3 = parse('- [ ] 待办\n- [x] 已完成\n').root
assert.strictEqual(JSON.stringify(tree3.children.map((n) => n.topic)), JSON.stringify(['待办', '已完成']))

// 4. unstructured text stays a single node
const tree4 = parse('这是一段没有结构的回答，没有标题也没有列表。').root
assert.strictEqual(tree4.children.length, 0)
assert.ok(tree4.topic.includes('没有结构'))

// 5. table rows dropped, quote folds into the node above
const tree5 = parse('## 数据\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 要点\n> 引用补充\n').root
assert.strictEqual(tree5.children.length, 1)
assert.ok(tree5.children[0].topic.includes('引用补充'))

// 6. html-inline markdown cleaned
const tree6 = parse('- **粗体** 与 `代码` 与 [链接](https://example.com)\n').root
assert.strictEqual(tree6.topic, '粗体 与 代码 与 链接')

console.log('core.test: 6 groups passed')
