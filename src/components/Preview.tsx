import { useMemo, useRef, useEffect, useLayoutEffect, useCallback, type MutableRefObject } from "react";
import { renderMarkdown } from "../utils/markdown";
import { findTextMatches } from "../utils/textSearch";
import type { EditorSearchMatch, SearchableEditorHandle } from "../types/editorSearch";

interface PreviewProps {
  content: string;
  searchRef?: MutableRefObject<SearchableEditorHandle | null>;
}

interface TextNodeSegment {
  textFrom: number;
  textTo: number;
  node: Text;
}

function collectTextNodeSegments(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments: TextNodeSegment[] = [];
  let text = "";

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    if (!value) continue;

    const textFrom = text.length;
    text += value;
    const textTo = text.length;
    segments.push({ textFrom, textTo, node });
  }

  return { text, segments };
}

function findSegment(segments: TextNodeSegment[], offset: number): TextNodeSegment | null {
  for (const segment of segments) {
    if (offset >= segment.textFrom && offset < segment.textTo) {
      return segment;
    }
  }

  return null;
}

const COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
const COPIED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';

/**
 * Attaches copy buttons to code blocks using event delegation.
 * Uses useLayoutEffect so buttons are in place before the browser paints,
 * and only wraps unwrapped blocks (avoids removing/re-adding on every render).
 */
function CodeCopyButtons({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const btnByBlock = useRef<WeakMap<Element, HTMLButtonElement>>(new WeakMap());

  // Delegated click handler: detect clicks on copy buttons
  const handleContainerClick = useCallback((e: Event) => {
    const btn = (e.target as HTMLElement).closest(".code-copy-btn") as HTMLButtonElement | null;
    if (!btn) return;

    const wrapper = btn.closest(".code-block-wrapper");
    const code = wrapper?.querySelector("pre code");
    if (!code?.textContent) return;

    navigator.clipboard.writeText(code.textContent);
    btn.innerHTML = COPIED_SVG;
    setTimeout(() => {
      btn.innerHTML = COPY_SVG;
    }, 2000);
  }, []);

  // Attach wrappers and buttons on DOM change, using the stable container
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pres = container.querySelectorAll("pre");
    pres.forEach((pre) => {
      // Already wrapped?
      if (pre.parentElement?.classList.contains("code-block-wrapper")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrapper";
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.title = "复制代码";
      btn.innerHTML = COPY_SVG;
      wrapper.appendChild(btn);
      btnByBlock.current.set(pre, btn);
    });
  }, [html]);

  // Attach and detach the delegated listener via the preview container
  useEffect(() => {
    const container = document.querySelector(".preview-content");
    if (!container) return;
    container.addEventListener("click", handleContainerClick as EventListener);
    // Store ref for useLayoutEffect
    containerRef.current = container as HTMLDivElement;
    return () => {
      container.removeEventListener("click", handleContainerClick as EventListener);
    };
  }, [handleContainerClick]);

  return null;
}

export default function Preview({ content, searchRef }: PreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    return renderMarkdown(content);
  }, [content]);

  // Scroll to hash on mount
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");
      const href = link?.getAttribute("href");
      if (href?.startsWith("#")) {
        e.preventDefault();
        const id = href.slice(1);
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    };

    const div = previewRef.current;
    div?.addEventListener("click", handleClick);
    return () => div?.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!searchRef) return;

    searchRef.current = {
      canReplace: false,
      focus: () => {
        previewRef.current?.focus();
      },
      findMatches: (query, caseSensitive) => {
        const container = previewRef.current;
        if (!container) return [];

        const { text } = collectTextNodeSegments(container);
        return findTextMatches(text, query, caseSensitive);
      },
      selectMatch: (match: EditorSearchMatch) => {
        const container = previewRef.current;
        if (!container) return false;

        const { segments } = collectTextNodeSegments(container);
        const startSegment = findSegment(segments, match.from);
        const endSegment = findSegment(segments, match.to - 1);
        if (!startSegment || !endSegment) return false;

        const range = document.createRange();
        range.setStart(startSegment.node, match.from - startSegment.textFrom);
        range.setEnd(endSegment.node, match.to - endSegment.textFrom);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        previewRef.current?.focus();
        (range.startContainer.parentElement ?? container).scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        return true;
      },
      replaceMatch: () => null,
      replaceAll: () => 0,
    };

    return () => {
      searchRef.current = null;
    };
  }, [searchRef]);

  return (
    <div className="preview-content" ref={previewRef} tabIndex={-1}>
      <CodeCopyButtons html={html} />
      {content ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <h2>预览区域</h2>
          <p>在左侧编辑器中输入 Markdown 内容，实时预览将显示在此处</p>
        </div>
      )}
    </div>
  );
}
