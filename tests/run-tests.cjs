const MarkdownIt = require("markdown-it");
const katex = require("@traptitech/markdown-it-katex").default || require("@traptitech/markdown-it-katex");
const footnote = require("markdown-it-footnote");
const mark = require("markdown-it-mark");
const sub = require("markdown-it-sub");
const sup = require("markdown-it-sup");
const taskLists = require("markdown-it-task-lists");
const emojiPkg = require("markdown-it-emoji");
const YAML = require("yaml");

const emoji = emojiPkg.full || emojiPkg.default || emojiPkg;

const md = new MarkdownIt({
  html: true,
  breaks: false,
  linkify: true,
  typographer: false,
  xhtmlOut: true,
})
  .use(katex, { throwOnError: false, errorColor: "#cc0000" })
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
  .use(footnote)
  .use(mark)
  .use(sub)
  .use(sup)
  .use(emoji);

function makeId(rawText) {
  return rawText
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getHeadingText(tokens, idx, options, env) {
  const children = tokens[idx + 1]?.children || [];
  return md.renderer.renderInlineAsText(children, options, env).replace(/\s+/g, " ").trim();
}

const defaultHeading = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
  const id = makeId(getHeadingText(tokens, idx, options, env));
  if (id) {
    tokens[idx].attrSet("id", id);
  }

  return defaultHeading
    ? defaultHeading(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

const defaultLink = md.renderer.rules.link_open;
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet("href") || "";
  if (href && !href.startsWith("#")) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
  }

  return defaultLink
    ? defaultLink(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitFrontmatter(markdown) {
  const source = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  if (!source.startsWith("---")) {
    return { html: "", content: markdown };
  }

  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { html: "", content: markdown };
  }

  const endMatch = normalized.slice(4).match(/\n---(?:\n|$)/);
  if (!endMatch || endMatch.index == null) {
    return { html: "", content: markdown };
  }

  const yamlText = normalized.slice(4, 4 + endMatch.index);
  const contentStart = 4 + endMatch.index + endMatch[0].length;
  const content = normalized.slice(contentStart);

  try {
    const parsed = YAML.parse(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { html: "", content: normalized };
    }

    const rows = Object.entries(parsed)
      .map(([key, value]) => renderFrontmatterRow(key, value))
      .join("");

    return rows
      ? { html: `<div class="frontmatter">${rows}</div>`, content }
      : { html: "", content };
  } catch {
    return { html: "", content: normalized };
  }
}

function renderFrontmatterRow(key, value) {
  const renderedValue = renderFrontmatterValue(value);
  if (!renderedValue) return "";
  return `<div class="fm-row"><span class="fm-key">${escapeHtml(key)}</span><span class="fm-val">${renderedValue}</span></div>`;
}

function renderFrontmatterValue(value) {
  if (value == null) return '<span class="fm-empty">null</span>';

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="fm-empty">[]</span>';
    return `<ul class="fm-list">${value.map((item) => `<li>${renderFrontmatterValue(item)}</li>`).join("")}</ul>`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="fm-empty">{}</span>';
    return `<div class="fm-nested">${entries.map(([k, v]) => `<div class="fm-nested-row"><span class="fm-nested-key">${escapeHtml(k)}</span><span class="fm-nested-val">${renderFrontmatterValue(v)}</span></div>`).join("")}</div>`;
  }

  if (typeof value === "string") {
    return escapeHtml(value).replace(/\n/g, "<br />");
  }

  return escapeHtml(String(value));
}

function render(markdown) {
  try {
    const { html, content } = splitFrontmatter(markdown);
    return html + (md.render(content) || "");
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function has(str) {
  return { fn: (html) => html.includes(str), label: `contains "${str.slice(0, 30)}"` };
}

function not(str) {
  return { fn: (html) => !html.includes(str), label: `not contains "${str.slice(0, 30)}"` };
}

function count(str, min) {
  return {
    fn: (html) => (html.match(new RegExp(str, "g")) || []).length >= min,
    label: `${str} >= ${min}`,
  };
}

const tests = [];
let pass = 0;
let fail = 0;

function test(name, markdown, checks) {
  const html = render(markdown);
  const errors = [];

  for (const check of checks) {
    try {
      if (!check.fn(html)) {
        errors.push(check.label);
      }
    } catch {
      errors.push(`${check.label} (exception)`);
    }
  }

  tests.push({ name, html, errors });
  if (errors.length === 0) {
    pass += 1;
  } else {
    fail += 1;
  }
}

test("H1-H6", "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6", [has("<h1"), has("<h6")]);
test("No heading without space", "#not heading", [not("<h1")]);
test("Heading with closing #", "# Title #", [has("<h1"), has('id="title"')]);
test("Setext heading", "Title\n=====", [has("<h1"), has('id="title"')]);

test("Bold", "**bold**", [has("<strong>bold</strong>")]);
test("Italic", "*italic*", [has("<em>italic</em>")]);
test("Bold and italic", "***both***", [has("<strong>"), has("<em>")]);
test("Underscore emphasis", "_text_", [has("<em>text</em>")]);
test("Highlight", "==highlight==", [has("<mark>highlight</mark>")]);
test("Subscript", "H~2~O", [has("H<sub>2</sub>O")]);
test("Superscript", "x^2^", [has("x<sup>2</sup>")]);

test("Inline code", "`code`", [has("<code>code</code>")]);
test("Fenced code block", "```js\nconst x = 1\n```", [has("<pre><code"), has("language-js")]);

test("Unordered list", "- a\n- b", [has("<ul>"), has("<li>a</li>")]);
test("Ordered list", "1. a\n2. b", [has("<ol>"), has("<li>a</li>")]);
test("Nested list", "- a\n  - b", [count("<ul>", 2)]);
test("Task list", "- [x] done\n- [ ] todo", [has('class="contains-task-list"'), count('type="checkbox"', 2)]);

test("Blockquote", "> quote", [has("<blockquote>")]);
test("Nested blockquote", "> a\n> > b", [count("<blockquote>", 2)]);

test("Inline link", "[GitHub](https://github.com)", [has('href="https://github.com"'), has('target="_blank"')]);
test("Hash link stays local", "[Jump](#section)", [has('href="#section"'), not('target="_blank"')]);
test("Autolink", "<https://example.com>", [has("https://example.com")]);
test("Reference link", "[ref][r]\n\n[r]: https://x.com", [has('href="https://x.com"')]);
test("Link in heading uses visible text for id", "## [Link](url) heading", [has('id="link-heading"')]);

test("Image", "![alt](img.png)", [has("<img"), has('src="img.png"')]);
test("Horizontal rule", "---", [has("<hr")]);
test("Table", "| a | b |\n| --- | --- |\n| 1 | 2 |", [has("<table>"), has("<thead>"), has("<tbody>")]);
test("Strikethrough", "~~deleted~~", [has("<s>deleted</s>")]);
test("Footnote", "Footnote[^1]\n\n[^1]: note", [has('class="footnote-ref"'), has('class="footnotes"')]);
test("Emoji", ":smile:", [not(":smile:"), has("😄")]);
test("Math", "$E=mc^2$", [has('class="katex"')]);

test("Chinese bold", "这是**粗体**文字", [has("<strong>粗体</strong>")]);
test("Chinese heading", "# 中文标题", [has("<h1"), has("中文标题")]);

test("Raw HTML", "<b>bold</b>", [has("<b>bold</b>")]);
test("HTML entity", "&amp; &lt; &gt;", [has("&amp;"), has("&lt;"), has("&gt;")]);
test("Escape asterisk", "\\*not\\*", [not("<em>")]);
test("Hard break", "line  \nline2", [has("<br")]);
test("Empty string", "", [{ fn: () => true, label: "empty input ok" }]);
test("Frontmatter basic", "---\ntitle: Hello\nsummary: ok\n---\n\n# Doc", [has('class="frontmatter"'), has("Hello"), has("<h1")]);
test("Frontmatter array", "---\ntags:\n  - a\n  - b\n---\n\nBody", [has('class="fm-list"'), has("<li>a</li>"), has("Body")]);
test("Frontmatter not mistaken for hr", "---\n\nHello\n\n---\n\nWorld", [not('class="frontmatter"'), has("<hr"), has("Hello"), has("World")]);

console.log("\n==============================");
console.log("MarkFlow Markdown Smoke Tests");
console.log(`Passed: ${pass}/${tests.length}`);
console.log(`Failed: ${fail}/${tests.length}`);
console.log("==============================\n");

if (fail > 0) {
  console.log("Failed cases:\n");
  for (const entry of tests.filter((item) => item.errors.length > 0)) {
    console.log(`[FAIL] ${entry.name}: ${entry.errors.join(" | ")}`);
    console.log(`       Output: ${entry.html.slice(0, 240)}\n`);
  }
  process.exit(1);
}

console.log("All smoke tests passed.\n");
