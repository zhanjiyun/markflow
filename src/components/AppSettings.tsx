import { X, Bot, Keyboard, PlaySquare } from "lucide-react";
import type { AISettings as AISettingsType } from "../hooks/useAI";
import type { StartupBehavior } from "../hooks/useSession";

interface AppSettingsProps {
  theme: string;
  onToggleTheme: () => void;
  startupBehavior: StartupBehavior;
  onStartupBehaviorChange: (behavior: StartupBehavior) => void;
  aiSettings: AISettingsType;
  onOpenAISettings: () => void;
  onClose: () => void;
}

export default function AppSettings({
  theme,
  onToggleTheme,
  startupBehavior,
  onStartupBehaviorChange,
  aiSettings,
  onOpenAISettings,
  onClose,
}: AppSettingsProps) {
  const hasAIKey = !!aiSettings.apiKey;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <h3>外观</h3>
            <div className="settings-row">
              <span>当前主题</span>
              <button className="form-btn secondary" onClick={onToggleTheme}>
                {theme === "light" ? "☀️ 浅色" : "🌙 深色"}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>
              <PlaySquare size={14} />
              启动行为
            </h3>
            <div className="settings-option-group">
              <button
                type="button"
                className={`settings-option ${startupBehavior === "resume" ? "active" : ""}`}
                onClick={() => onStartupBehaviorChange("resume")}
              >
                <span className="settings-option-title">恢复上次工作</span>
                <span className="settings-option-desc">启动后直接回到上次打开的工作区和文档。</span>
              </button>
              <button
                type="button"
                className={`settings-option ${startupBehavior === "home" ? "active" : ""}`}
                onClick={() => onStartupBehaviorChange("home")}
              >
                <span className="settings-option-title">显示主页</span>
                <span className="settings-option-desc">启动后先进入主页，再由你选择继续、打开或新建。</span>
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>
              <Bot size={14} />
              AI 助手
            </h3>
            <div className="settings-row">
              <span>API 状态</span>
              <span className={hasAIKey ? "status-ok" : "status-none"}>
                {hasAIKey
                  ? `✓ 已配置 (${aiSettings.model})`
                  : "未配置"}
              </span>
            </div>
            <button className="form-btn primary" onClick={onOpenAISettings} style={{ marginTop: 8 }}>
              配置 AI Key
            </button>
          </div>

          <div className="settings-section">
            <h3>
              <Keyboard size={14} />
              快捷键速查
            </h3>
            <div className="shortcut-list">
              <div><kbd>Ctrl + S</kbd> <span>保存</span></div>
              <div><kbd>Ctrl + O</kbd> <span>打开文件</span></div>
              <div><kbd>Ctrl + N</kbd> <span>新建文件</span></div>
              <div><kbd>Ctrl + /</kbd> <span>切换源码/WYSIWYG</span></div>
              <div><kbd>Ctrl + Shift + E</kbd> <span>切换侧边栏</span></div>
              <div><kbd>Ctrl + Shift + I</kbd> <span>切换 AI 助手</span></div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="form-btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
