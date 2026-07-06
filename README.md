# MarkFlow

MarkFlow is a local-first Markdown editor built with Tauri v2, React, and Milkdown. It focuses on a Typora-like editing experience, Markdown preview fidelity, and desktop-native packaging.

## Stack

- Tauri v2
- React 19 + TypeScript
- Milkdown / ProseMirror
- markdown-it
- CodeMirror 6
- KaTeX
- Browser print-based PDF export

## Project Structure

```text
markflow/
|-- public/                Static frontend assets
|-- src/                   React frontend source
|-- src-tauri/             Tauri backend, bundling, and native config
|-- tests/                 Markdown rendering test cases and runners
|-- package.json           Frontend scripts and dependencies
|-- rust-toolchain.toml    Rust toolchain pin for Windows MSVC builds
`-- README.md
```

## Development

### Prerequisites

- Node.js 22+
- Rust 1.77+
- Visual Studio Build Tools with the C++ workload on Windows

### Install

```bash
npm install
```

### Run

```bash
npm run dev
npx tauri dev
```

### Build

```bash
npx tauri build
```

PDF export follows the same model as Guanmo: MarkFlow renders the current document into a print-friendly HTML document and opens the system print flow, where the user can choose "Save as PDF".

## Tests

```bash
npm run test:markdown
npm run test:spec
```

If you need the full CommonMark spec dataset again:

```bash
curl -L -o tests/spec.json https://spec.commonmark.org/0.31.2/spec.json
```

## Notes

- `dist/` and `src-tauri/target/` are generated artifacts and should not be committed.
- This repository is pinned to the MSVC Rust toolchain so Windows builds do not depend on the side-by-side `WebView2Loader.dll` workaround from the GNU toolchain.
