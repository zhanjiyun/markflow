/**
 * Tests for core useFileSystem logic that can be evaluated in Node.js.
 *
 * Covers: placeholder detection, untitled naming, file path extraction,
 *         open-file placeholder replacement decision rule, and close-tab
 *         active-tab selection fallback logic.
 */

// -- Inline copies of the production functions under test --
//   Must match src/hooks/useFileSystem.ts exactly.

const UNTITLED_NAME = "未命名.md";
const UNTITLED_NAME_REGEX = /^未命名(?: (\d+))?\.md$/;

function getFileName(path) {
  return path.replace(/\\/g, "/").split("/").pop() || UNTITLED_NAME;
}

function getNextUntitledName(existingTabs) {
  const usedNumbers = new Set();
  for (const tab of existingTabs) {
    const match = tab.name.match(UNTITLED_NAME_REGEX);
    if (!match) continue;
    usedNumbers.add(match[1] ? Number.parseInt(match[1], 10) : 1);
  }
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber++;
  return nextNumber === 1 ? UNTITLED_NAME : `未命名 ${nextNumber}.md`;
}

function isPlaceholderTab(tab) {
  return !tab.path && !tab.content.trim() && tab.saved && !tab.pinned;
}

/** Decision rule used in openFile / openFileByPath. */
function shouldReplacePlaceholder(tabs) {
  return tabs.length === 1 && isPlaceholderTab(tabs[0]);
}

/** Fallback active-tab selection when closing tabs (from removeTabsByIds). */
function selectNextActive(currentTabs, closingIds, currentActiveId) {
  const closingSet = new Set(closingIds);
  const nextTabs = currentTabs.filter((t) => !closingSet.has(t.id));
  if (nextTabs.length === 0) return null;
  const activeClosed = closingSet.has(currentActiveId);
  const activeIndex = currentTabs.findIndex((t) => t.id === currentActiveId);
  const fallbackIndex = activeIndex >= 0 ? Math.min(activeIndex, nextTabs.length - 1) : 0;
  return activeClosed
    ? (nextTabs[fallbackIndex] ?? nextTabs[nextTabs.length - 1]).id
    : (nextTabs.find((t) => t.id === currentActiveId) ?? nextTabs[0]).id;
}

// -- Test runner --

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push({ name, error: e.message }); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ═══════════════════════════════════════════════════
// getFileName
// ═══════════════════════════════════════════════════

test("Windows path → filename", () => {
  assert(getFileName("C:\\Users\\me\\notes.md") === "notes.md");
});
test("Unix path → filename", () => {
  assert(getFileName("/home/me/readme.markdown") === "readme.markdown");
});
test("empty path → 未命名.md", () => {
  assert(getFileName("") === UNTITLED_NAME);
});
test("chinese path", () => {
  assert(getFileName("D:\\文档\\测试.mdown") === "测试.mdown");
});
test("path with spaces", () => {
  assert(getFileName("C:\\My Files\\hello world.md") === "hello world.md");
});

// ═══════════════════════════════════════════════════
// getNextUntitledName
// ═══════════════════════════════════════════════════

test("no existing tabs → 未命名.md", () => {
  assert(getNextUntitledName([]) === UNTITLED_NAME);
});
test("one untitled → 未命名 2.md", () => {
  assert(getNextUntitledName([{ name: "未命名.md" }]) === "未命名 2.md");
});
test("two untitleds → 未命名 3.md", () => {
  assert(getNextUntitledName([{ name: "未命名.md" }, { name: "未命名 2.md" }]) === "未命名 3.md");
});
test("gap in numbering fills lowest", () => {
  assert(getNextUntitledName([{ name: "未命名.md" }, { name: "未命名 3.md" }]) === "未命名 2.md");
});
test("real files don't affect naming", () => {
  assert(getNextUntitledName([{ name: "readme.md" }]) === UNTITLED_NAME);
});

// ═══════════════════════════════════════════════════
// isPlaceholderTab
// ═══════════════════════════════════════════════════

test("empty untitled is placeholder", () => {
  assert(isPlaceholderTab({ path: null, content: "", saved: true, pinned: false }));
});
test("tab with content is NOT placeholder", () => {
  assert(!isPlaceholderTab({ path: null, content: "# Hi", saved: false, pinned: false }));
});
test("tab with path is NOT placeholder", () => {
  assert(!isPlaceholderTab({ path: "/f.md", content: "", saved: true, pinned: false }));
});
test("pinned tab is NOT placeholder", () => {
  assert(!isPlaceholderTab({ path: null, content: "", saved: true, pinned: true }));
});
test("whitespace-only content IS placeholder", () => {
  assert(isPlaceholderTab({ path: null, content: "  \n ", saved: true, pinned: false }));
});

// ═══════════════════════════════════════════════════
// shouldReplacePlaceholder (open-file decision rule)
// ═══════════════════════════════════════════════════

test("single placeholder → should replace", () => {
  assert(shouldReplacePlaceholder([
    { path: null, content: "", saved: true, pinned: false },
  ]));
});
test("single placeholder with whitespace → should replace", () => {
  assert(shouldReplacePlaceholder([
    { path: null, content: "  ", saved: true, pinned: false },
  ]));
});
test("single tab with content → should NOT replace", () => {
  assert(!shouldReplacePlaceholder([
    { path: null, content: "# Doc", saved: false, pinned: false },
  ]));
});
test("single tab with path → should NOT replace", () => {
  assert(!shouldReplacePlaceholder([
    { path: "/f.md", content: "", saved: true, pinned: false },
  ]));
});
test("two tabs (one placeholder) → should NOT replace", () => {
  assert(!shouldReplacePlaceholder([
    { path: null, content: "", saved: true, pinned: false },
    { path: "/a.md", content: "", saved: true, pinned: false },
  ]));
});
test("empty tabs array → should NOT replace", () => {
  assert(!shouldReplacePlaceholder([]));
});
test("single pinned placeholder → should NOT replace", () => {
  assert(!shouldReplacePlaceholder([
    { path: null, content: "", saved: true, pinned: true },
  ]));
});

// ═══════════════════════════════════════════════════
// selectNextActive (close-tab fallback logic)
// ═══════════════════════════════════════════════════

test("close active → fallback to next tab at same index", () => {
  const tabs = [
    { id: "a", name: "a.md" },
    { id: "b", name: "b.md" },
    { id: "c", name: "c.md" },
  ];
  assert(selectNextActive(tabs, ["b"], "b") === "c");
});
test("close last tab → fallback to previous", () => {
  const tabs = [
    { id: "a", name: "a.md" },
    { id: "b", name: "b.md" },
  ];
  assert(selectNextActive(tabs, ["b"], "b") === "a");
});
test("close non-active tab → keep current active", () => {
  const tabs = [
    { id: "a", name: "a.md" },
    { id: "b", name: "b.md" },
  ];
  assert(selectNextActive(tabs, ["b"], "a") === "a");
});
test("close all → returns null", () => {
  const tabs = [{ id: "a", name: "a.md" }];
  assert(selectNextActive(tabs, ["a"], "a") === null);
});
test("active is null → pick first remaining", () => {
  const tabs = [
    { id: "a", name: "a.md" },
    { id: "b", name: "b.md" },
  ];
  assert(selectNextActive(tabs, ["a"], null) === "b");
});

// ═══════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════

console.log("\n====================================");
console.log("MarkFlow  FileSystem Logic Tests");
console.log(`Passed: ${pass}/${pass + fail}`);
console.log(`Failed: ${fail}/${pass + fail}`);
console.log("====================================\n");

if (fail > 0) {
  for (const f of failures) console.log(`[FAIL] ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log("All filesystem logic tests passed.\n");
