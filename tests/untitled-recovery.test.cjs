/**
 * Tests for untitled tab persistence & recovery logic.
 *
 * These test the core rules for placeholder detection and untitled naming
 * that live in useFileSystem.ts.  They run in Node.js (CommonJS).
 */

// -- Inline copies of the production functions under test --
// (These MUST match src/hooks/useFileSystem.ts exactly.)

const UNTITLED_NAME_REGEX = /^未命名(?: (\d+))?\.md$/;
const UNTITLED_NAME = "未命名.md";

/**
 * A tab is a placeholder when it has never been touched by the user:
 * no file path, no content, not pinned, not modified.
 */
function isPlaceholderTab(tab) {
  return !tab.path && !tab.content.trim() && tab.saved && !tab.pinned;
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

// -- Tests --

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ── isPlaceholderTab ──

test("empty untitled tab is a placeholder", () => {
  assert(isPlaceholderTab({ path: null, content: "", saved: true, pinned: false }));
});

test("tab with content is NOT a placeholder", () => {
  assert(!isPlaceholderTab({ path: null, content: "# Hello", saved: false, pinned: false }));
});

test("tab with path is NOT a placeholder", () => {
  assert(!isPlaceholderTab({ path: "/f.md", content: "", saved: true, pinned: false }));
});

test("unsaved tab is NOT a placeholder", () => {
  assert(!isPlaceholderTab({ path: null, content: "", saved: false, pinned: false }));
});

test("pinned tab is NOT a placeholder", () => {
  assert(!isPlaceholderTab({ path: null, content: "", saved: true, pinned: true }));
});

test("whitespace-only content is still a placeholder", () => {
  assert(isPlaceholderTab({ path: null, content: "  \n  ", saved: true, pinned: false }));
});

// ── getNextUntitledName ──

test("no existing tabs → 未命名.md", () => {
  assert(getNextUntitledName([]) === "未命名.md");
});

test("existing 未命名.md → 未命名 2.md", () => {
  assert(
    getNextUntitledName([{ name: "未命名.md" }]) === "未命名 2.md"
  );
});

test("existing 未命名.md + 未命名 2.md → 未命名 3.md", () => {
  assert(
    getNextUntitledName([
      { name: "未命名.md" },
      { name: "未命名 2.md" },
    ]) === "未命名 3.md"
  );
});

test("existing real files → still 未命名.md", () => {
  assert(
    getNextUntitledName([
      { name: "readme.md" },
      { name: "notes.md" },
    ]) === "未命名.md"
  );
});

test("gaps in numbering → fills lowest gap", () => {
  assert(
    getNextUntitledName([
      { name: "未命名.md" },
      { name: "未命名 3.md" },
    ]) === "未命名 2.md"
  );
});

// ── Report ──

console.log("\n====================================");
console.log("MarkFlow  Untitled Recovery Tests");
console.log(`Passed: ${pass}/${pass + fail}`);
console.log(`Failed: ${fail}/${pass + fail}`);
console.log("====================================\n");

if (fail > 0) {
  for (const f of failures) {
    console.log(`[FAIL] ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("All untitled recovery tests passed.\n");
