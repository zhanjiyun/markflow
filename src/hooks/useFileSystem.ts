import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { SessionTabState } from "./useSession";

export interface FileState {
  id: string;
  path: string | null;
  name: string;
  content: string;
  saved: boolean;
  pinned: boolean;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type CloseStrategy = "prompt" | "save" | "discard";

const AUTO_SAVE_DELAY = 1000;
const UNTITLED_NAME = "未命名.md";
const UNTITLED_NAME_REGEX = /^未命名(?: (\d+))?\.md$/;

function writeFileRust(path: string, content: string): Promise<void> {
  return invoke("write_file_content", { path, content });
}

function getFileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || UNTITLED_NAME;
}

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getNextUntitledName(existingTabs: FileState[]): string {
  const usedNumbers = new Set<number>();

  for (const tab of existingTabs) {
    const match = tab.name.match(UNTITLED_NAME_REGEX);
    if (!match) continue;
    usedNumbers.add(match[1] ? Number.parseInt(match[1], 10) : 1);
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return nextNumber === 1 ? UNTITLED_NAME : `未命名 ${nextNumber}.md`;
}

function createUntitledTab(name = UNTITLED_NAME): FileState {
  return {
    id: createTabId(),
    path: null,
    name,
    content: "",
    saved: true,
    pinned: false,
  };
}

/** A tab is a "placeholder" when it has never been touched by the user:
 *  no file path, no content, not pinned, not modified. */
function isPlaceholderTab(tab: FileState): boolean {
  return !tab.path && !tab.content.trim() && tab.saved && !tab.pinned;
}

export function useFileSystem() {
  const initialTabRef = useRef<FileState>(createUntitledTab());
  const [tabs, setTabs] = useState<FileState[]>(() => [initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialTabRef.current.id);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastError, setLastError] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? createUntitledTab(),
    [activeTabId, tabs]
  );

  const file = activeTab;

  const clearPendingSave = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showError = useCallback((message: string) => {
    setLastError(message);
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = window.setTimeout(() => {
      setLastError(null);
      errorTimerRef.current = null;
    }, 5000);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setLastError(null);
  }, []);

  const replaceTab = useCallback((nextTab: FileState) => {
    setTabs((current) => current.map((tab) => (tab.id === nextTab.id ? nextTab : tab)));
  }, []);

  const saveTabToPath = useCallback(
    async (tab: FileState, targetPath: string): Promise<boolean> => {
      setSaveStatus("saving");
      try {
        await writeFileRust(targetPath, tab.content);
        replaceTab({
          ...tab,
          path: targetPath,
          name: getFileName(targetPath),
          saved: true,
        });
        setSaveStatus("saved");
        clearError();
        return true;
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
        showError(`保存失败：${tab.name}`);
        return false;
      }
    },
    [clearError, replaceTab, showError]
  );

  const saveTabAsInternal = useCallback(
    async (tab: FileState): Promise<boolean> => {
      try {
        const targetPath = await save({
          filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mdx"] }],
          defaultPath: tab.path ? tab.name : "untitled.md",
        });
        if (!targetPath) return false;

        return saveTabToPath(tab, targetPath);
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
        showError("另存为失败");
        return false;
      }
    },
    [saveTabToPath, showError]
  );

  const activateTab = useCallback(async (tabId: string) => {
    const current = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    if (current?.path && !current.saved) {
      await saveTabToPath(current, current.path);
    }

    clearPendingSave();
    setActiveTabId(tabId);
  }, [clearPendingSave, saveTabToPath]);

  const saveExistingFile = useCallback(async (): Promise<boolean> => {
    const current = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    if (!current?.path) return false;
    return saveTabToPath(current, current.path);
  }, [saveTabToPath]);

  const saveAsInternal = useCallback(
    async (content?: string): Promise<boolean> => {
      const current = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      if (!current) return false;

      return saveTabAsInternal({
        ...current,
        content: content ?? current.content,
      });
    },
    [saveTabAsInternal]
  );

  const confirmDiscardTab = useCallback(
    async (tab: FileState): Promise<boolean> => {
      const isEmptyUntitled = !tab.path && tab.content.trim() === "";

      if (tab.saved || isEmptyUntitled) return true;

      const shouldSave = await confirm(`文档“${tab.name}”有未保存的更改，是否先保存？`, {
        title: "未保存的更改",
        kind: "warning",
        okLabel: "保存",
        cancelLabel: "继续不保存",
      });

      if (shouldSave) {
        const latest = tabsRef.current.find((item) => item.id === tab.id) ?? tab;
        return latest.path ? saveTabToPath(latest, latest.path) : saveTabAsInternal(latest);
      }

      return confirm(`确定放弃“${tab.name}”的当前更改并继续吗？`, {
        title: "放弃更改",
        kind: "warning",
        okLabel: "继续",
        cancelLabel: "取消",
      });
    },
    [saveTabAsInternal, saveTabToPath]
  );

  useEffect(() => {
    if (!activeTab) return;

    if (!activeTab.path) {
      clearPendingSave();
      setSaveStatus(activeTab.saved ? "saved" : "unsaved");
      return;
    }

    if (activeTab.saved) {
      clearPendingSave();
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("unsaved");
    clearPendingSave();
    timerRef.current = window.setTimeout(() => {
      void saveExistingFile();
    }, AUTO_SAVE_DELAY);

    return clearPendingSave;
  }, [activeTab, clearPendingSave, saveExistingFile]);

  useEffect(() => {
    const handleBlur = () => {
      const current = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      if (current?.path && !current.saved) {
        void saveTabToPath(current, current.path);
      }
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [saveTabToPath]);

  useEffect(() => {
    return () => {
      clearPendingSave();
      if (errorTimerRef.current) {
        window.clearTimeout(errorTimerRef.current);
      }
    };
  }, [clearPendingSave]);

  const flushSave = useCallback(async () => {
    clearPendingSave();
    const pending = tabsRef.current.filter((tab) => tab.path && !tab.saved);
    for (const tab of pending) {
      await saveTabToPath(tab, tab.path!);
    }
  }, [clearPendingSave, saveTabToPath]);

  const newFile = useCallback(async (): Promise<boolean> => {
    const nextTab = createUntitledTab(getNextUntitledName(tabsRef.current));
    clearPendingSave();
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
    setSaveStatus("saved");
    clearError();
    return true;
  }, [clearError, clearPendingSave]);

  const openFile = useCallback(async (): Promise<boolean> => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Markdown", extensions: ["md", "markdown", "mdown", "mdx"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });

      if (!selected || typeof selected !== "string") return false;

      const existingTab = tabsRef.current.find((tab) => tab.path === selected);
      if (existingTab) {
        await activateTab(existingTab.id);
        clearError();
        return true;
      }

      const content = await readTextFile(selected);
      const nextTab: FileState = {
        id: createTabId(),
        path: selected,
        name: getFileName(selected),
        content,
        saved: true,
        pinned: false,
      };

      clearPendingSave();

      // If the only existing tab is an untouched placeholder, replace it.
      const currentTabs = tabsRef.current;
      const onlyPlaceholder =
        currentTabs.length === 1 && isPlaceholderTab(currentTabs[0]);

      if (onlyPlaceholder) {
        setTabs([nextTab]);
      } else {
        setTabs((current) => [...current, nextTab]);
      }

      setActiveTabId(nextTab.id);
      setSaveStatus("saved");
      clearError();
      return true;
    } catch (error) {
      console.error(error);
      setSaveStatus("error");
      showError("打开文件失败");
      return false;
    }
  }, [activateTab, clearError, clearPendingSave, showError]);

  const openFileByPath = useCallback(
    async (path: string): Promise<boolean> => {
      const existingTab = tabsRef.current.find((tab) => tab.path === path);
      if (existingTab) {
        await activateTab(existingTab.id);
        clearError();
        return true;
      }

      try {
        const content = await invoke<string>("read_file_content", { path });
        const nextTab: FileState = {
          id: createTabId(),
          path,
          name: getFileName(path),
          content,
          saved: true,
          pinned: false,
        };

        clearPendingSave();

        // If the only existing tab is an untouched placeholder, replace it.
        // Otherwise add the new tab normally.
        const currentTabs = tabsRef.current;
        const onlyPlaceholder =
          currentTabs.length === 1 && isPlaceholderTab(currentTabs[0]);

        if (onlyPlaceholder) {
          setTabs([nextTab]);
        } else {
          setTabs((current) => [...current, nextTab]);
        }

        setActiveTabId(nextTab.id);
        setSaveStatus("saved");
        clearError();
        return true;
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
        showError(`无法打开：${path}`);
        return false;
      }
    },
    [activateTab, clearError, clearPendingSave, showError]
  );

  const saveFile = useCallback(async (): Promise<boolean> => {
    clearPendingSave();
    const current = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    if (!current) return false;

    return current.path ? saveTabToPath(current, current.path) : saveAsInternal(current.content);
  }, [clearPendingSave, saveAsInternal, saveTabToPath]);

  const saveAs = useCallback(
    async (content?: string): Promise<boolean> => saveAsInternal(content),
    [saveAsInternal]
  );

  const updateContent = useCallback((content: string) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabIdRef.current
          ? {
              ...tab,
              content,
              saved: false,
            }
          : tab
      )
    );
  }, []);

  const renameTab = useCallback((tabId: string, nextName: string): boolean => {
    const normalized = nextName.trim();
    if (!normalized) return false;

    const finalName = /\.[^\\/.\s]+$/.test(normalized) ? normalized : `${normalized}.md`;
    let changed = false;

    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabId || tab.path) return tab;
        changed = true;
        return {
          ...tab,
          name: finalName,
        };
      })
    );

    return changed;
  }, []);

  const setTabPinned = useCallback((tabId: string, pinned: boolean): boolean => {
    let changed = false;

    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabId || tab.pinned === pinned) {
          return tab;
        }

        changed = true;
        return {
          ...tab,
          pinned,
        };
      })
    );

    return changed;
  }, []);

  const saveTabs = useCallback(
    async (tabIds: string[]): Promise<boolean> => {
      const idSet = new Set(tabIds);
      const targetTabs = tabsRef.current.filter((tab) => idSet.has(tab.id) && !tab.saved);

      for (const tab of targetTabs) {
        const ok = tab.path ? await saveTabToPath(tab, tab.path) : await saveTabAsInternal(tab);
        if (!ok) {
          return false;
        }
      }

      return true;
    },
    [saveTabAsInternal, saveTabToPath]
  );

  const removeTabsByIds = useCallback(
    (tabIds: string[]) => {
      const closingSet = new Set(tabIds);
      if (closingSet.size === 0) return true;

      clearPendingSave();
      const currentTabs = tabsRef.current;
      const nextTabs = currentTabs.filter((tab) => !closingSet.has(tab.id));

      if (nextTabs.length === 0) {
        // All tabs closed: go to empty state, let the UI show the home page.
        // No fallback untitled tab is created — the user explicitly closed the last tab.
        setTabs([]);
        setActiveTabId(null);
        setSaveStatus("saved");
        clearError();
        return true;
      }

      const activeClosed = activeTabIdRef.current !== null && closingSet.has(activeTabIdRef.current);
      const activeIndex = currentTabs.findIndex((tab) => tab.id === activeTabIdRef.current);
      const fallbackIndex = activeIndex >= 0 ? Math.min(activeIndex, nextTabs.length - 1) : 0;
      const nextActive = activeClosed
        ? nextTabs[fallbackIndex] ?? nextTabs[nextTabs.length - 1]
        : nextTabs.find((tab) => tab.id === activeTabIdRef.current) ?? nextTabs[0];

      setTabs(nextTabs);
      setActiveTabId(nextActive.id);
      clearError();
      return true;
    },
    [clearError, clearPendingSave]
  );

  const closeTabsWithStrategy = useCallback(
    async (tabIds: string[], strategy: CloseStrategy): Promise<boolean> => {
      const existingTabs = tabsRef.current.filter((tab) => tabIds.includes(tab.id));
      if (existingTabs.length === 0) return false;

      if (strategy === "save") {
        for (const tab of existingTabs) {
          const ok = tab.path ? await saveTabToPath(tab, tab.path) : await saveTabAsInternal(tab);
          if (!ok) {
            return false;
          }
        }
        return removeTabsByIds(existingTabs.map((tab) => tab.id));
      }

      if (strategy === "discard") {
        return removeTabsByIds(existingTabs.map((tab) => tab.id));
      }

      for (const tab of existingTabs) {
        const ok = await confirmDiscardTab(tab);
        if (!ok) {
          return false;
        }
      }

      return removeTabsByIds(existingTabs.map((tab) => tab.id));
    },
    [confirmDiscardTab, removeTabsByIds, saveTabAsInternal, saveTabToPath]
  );

  const closeTab = useCallback(
    async (tabId: string, strategy: CloseStrategy = "prompt"): Promise<boolean> =>
      closeTabsWithStrategy([tabId], strategy),
    [closeTabsWithStrategy]
  );

  const closeOtherTabs = useCallback(
    async (tabId: string, strategy: CloseStrategy = "prompt"): Promise<boolean> => {
      const targets = tabsRef.current
        .filter((tab) => tab.id !== tabId && !tab.pinned)
        .map((tab) => tab.id);
      return closeTabsWithStrategy(targets, strategy);
    },
    [closeTabsWithStrategy]
  );

  const closeTabsToRight = useCallback(
    async (tabId: string, strategy: CloseStrategy = "prompt"): Promise<boolean> => {
      const tabIndex = tabsRef.current.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) return false;

      const targets = tabsRef.current
        .slice(tabIndex + 1)
        .filter((tab) => !tab.pinned)
        .map((tab) => tab.id);
      return closeTabsWithStrategy(targets, strategy);
    },
    [closeTabsWithStrategy]
  );

  const closeAllTabs = useCallback(
    async (strategy: CloseStrategy = "prompt"): Promise<boolean> => {
      return closeTabsWithStrategy(
        tabsRef.current.filter((tab) => !tab.pinned).map((tab) => tab.id),
        strategy
      );
    },
    [closeTabsWithStrategy]
  );

  const reorderTabs = useCallback((sourceTabId: string, targetTabId: string) => {
    if (sourceTabId === targetTabId) return;

    setTabs((current) => {
      const sourceIndex = current.findIndex((tab) => tab.id === sourceTabId);
      const targetIndex = current.findIndex((tab) => tab.id === targetTabId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const nextTabs = [...current];
      const [sourceTab] = nextTabs.splice(sourceIndex, 1);
      nextTabs.splice(targetIndex, 0, sourceTab);
      return nextTabs;
    });
  }, []);

  const restoreTabs = useCallback((nextTabs: SessionTabState[], nextActiveTabId: string | null) => {
    if (nextTabs.length === 0) return;

    const restoredTabs: FileState[] = nextTabs.map((tab) => ({
      id: tab.id || createTabId(),
      path: tab.path,
      name: tab.name || (tab.path ? getFileName(tab.path) : UNTITLED_NAME),
      content: tab.content ?? "",
      saved: tab.saved ?? true,
      pinned: tab.pinned ?? false,
    }));
    const resolvedActiveId =
      restoredTabs.find((tab) => tab.id === nextActiveTabId)?.id ?? restoredTabs[0].id;

    clearPendingSave();
    setTabs(restoredTabs);
    setActiveTabId(resolvedActiveId);
    clearError();
  }, [clearError, clearPendingSave]);

  const getTabsSnapshot = useCallback(() => tabsRef.current, []);

  return {
    file,
    tabs,
    activeTabId,
    saveStatus,
    lastError,
    newFile,
    openFile,
    openFileByPath,
    saveFile,
    saveAs,
    updateContent,
    flushSave,
    activateTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    reorderTabs,
    renameTab,
    setTabPinned,
    saveTabs,
    getTabsSnapshot,
    restoreTabs,
  };
}
