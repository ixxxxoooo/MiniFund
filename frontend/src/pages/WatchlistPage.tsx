import { useEffect, useState } from "react";
import { Plus, Search, TrendingUp, X } from "lucide-react";
import type { WatchItem } from "@bindings/minifund/internal/model";
import { PositionDialog } from "@/components/fund/PositionDialog";
import { ProfitCards } from "@/components/fund/ProfitCards";
import { WatchlistTable } from "@/components/fund/WatchlistTable";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { zhCN } from "@/i18n/zh-CN";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { isSummaryGroup, useWatchlistStore } from "@/stores/watchlist";

/**
 * 自选监控页：盈亏汇总卡片 + 分组标签 + 估值表格。
 */
export function WatchlistPage() {
  const groups = useWatchlistStore((s) => s.groups);
  const activeGroupId = useWatchlistStore((s) => s.activeGroupId);
  const items = useWatchlistStore((s) => s.items);
  const loaded = useWatchlistStore((s) => s.loaded);
  const load = useWatchlistStore((s) => s.load);
  const setActiveGroup = useWatchlistStore((s) => s.setActiveGroup);
  const createGroup = useWatchlistStore((s) => s.createGroup);
  const deleteGroup = useWatchlistStore((s) => s.deleteGroup);
  const focusSearch = useUIStore((s) => s.focusSearch);

  const [editing, setEditing] = useState<WatchItem | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  // 待确认删除的分组 id（应用内确认弹窗，替代 Wails WebView 不支持的 window.confirm）
  const [deletingGroup, setDeletingGroup] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateGroup = async () => {
    if (groupName.trim()) {
      await createGroup(groupName.trim());
    }
    setAddingGroup(false);
    setGroupName("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--size-gap)] p-[var(--size-padding)]">
      <ProfitCards />

      {/* 分组标签栏 */}
      <div className="flex items-center gap-1">
        {groups.map((g) => (
          <div key={g.id} className="group relative">
            <button
              onClick={() => void setActiveGroup(g.id)}
              className={cn(
                "h-[var(--size-tab)] rounded-[var(--radius-btn)] px-3 text-[length:var(--size-font-xs)]",
                g.id === activeGroupId
                  ? "bg-[var(--row-selected)] font-medium text-[var(--accent)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--row-hover)]"
              )}
            >
              {g.name}
            </button>
            {/* 「汇总」为默认分组不可删除；真实分组多于 1 个且选中时才可删除 */}
            {!isSummaryGroup(g.id) &&
              g.id === activeGroupId &&
              groups.filter((x) => !isSummaryGroup(x.id)).length > 1 && (
              <Tooltip content={zhCN.watchlist.deleteGroup}>
                <button
                  aria-label={zhCN.watchlist.deleteGroup}
                  onClick={() => setDeletingGroup(g.id)}
                  className="absolute -right-1 -top-1 hidden rounded-full bg-[var(--surface-elevated)] p-0.5 text-[var(--fg-muted)] shadow-[var(--shadow-sm)] hover:text-[var(--danger)] group-hover:block"
                >
                  <X size={10} />
                </button>
              </Tooltip>
            )}
          </div>
        ))}
        {addingGroup ? (
          <input
            autoFocus
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateGroup();
              if (e.key === "Escape") {
                setAddingGroup(false);
                setGroupName("");
              }
            }}
            onBlur={() => void handleCreateGroup()}
            placeholder={zhCN.watchlist.groupNamePlaceholder}
            className="h-[var(--size-tab)] w-28 rounded-[var(--radius-btn)] border border-[var(--border-color)] bg-[var(--surface)] px-2 text-[length:var(--size-font-xs)] outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <Tooltip content={zhCN.watchlist.addGroup}>
            <button
              aria-label={zhCN.watchlist.addGroup}
              onClick={() => setAddingGroup(true)}
              className="flex h-[var(--size-tab)] items-center rounded-[var(--radius-btn)] px-2 text-[var(--fg-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--fg)]"
            >
              <Plus size={13} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* 内容区：空状态 / 表格 */}
      {loaded && items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <TrendingUp size={36} className="text-[var(--fg-muted)]" />
          <div className="text-[length:var(--size-font-sm)] text-[var(--fg-secondary)]">
            {zhCN.main.watchlistEmpty}
          </div>
          <Button size="sm" onClick={() => focusSearch()}>
            <Search size={13} className="mr-1" />
            {zhCN.main.watchlistEmptyAction}
          </Button>
        </div>
      ) : (
        <WatchlistTable onEditPosition={setEditing} />
      )}

      <PositionDialog item={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deletingGroup != null}
        title={zhCN.watchlist.deleteGroup}
        message={zhCN.watchlist.deleteGroupConfirm}
        confirmLabel={zhCN.watchlist.deleteGroup}
        danger
        onConfirm={() => {
          if (deletingGroup != null) void deleteGroup(deletingGroup);
          setDeletingGroup(null);
        }}
        onCancel={() => setDeletingGroup(null)}
      />
    </div>
  );
}
