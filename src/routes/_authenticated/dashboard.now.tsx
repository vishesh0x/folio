import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImageField } from "@/components/dash/AssetPicker";
import { reorderIds, run } from "@/components/dash/api";
import { ConfirmButton } from "@/components/dash/ConfirmButton";
import { Field, GhostButton, IconButton, PageHeader, PrimaryButton } from "@/components/dash/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  adminDeleteCategory,
  adminDeleteNowItem,
  adminGetNow,
  adminReorderCategories,
  adminSaveCategory,
  adminSaveNowItem,
  adminSetNowItemStatus,
} from "@/lib/admin.functions";
import type { NowCategory, NowItem } from "@/lib/public.functions";

export const Route = createFileRoute("/_authenticated/dashboard/now")({ component: NowBoard });

type ItemDraft = {
  id?: string;
  categoryId: string;
  title?: string;
  description?: string;
  status?: "doing" | "done";
  link?: string | null;
  imageUrl?: string | null;
  imageAlt?: string;
};

function NowBoard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["dash", "now"], queryFn: () => adminGetNow() });
  const cats = data?.categories ?? [];
  const items = data?.items ?? [];
  const refresh = () => qc.invalidateQueries();
  const [newCat, setNewCat] = useState({ name: "", emoji: "" });
  const [editingCat, setEditingCat] = useState<NowCategory | null>(null);
  const [item, setItem] = useState<ItemDraft | null>(null);

  const addCat = async () => {
    if (!newCat.name.trim()) return;
    const ok = await run(() => adminSaveCategory({ data: { data: newCat } }));
    if (ok) {
      setNewCat({ name: "", emoji: "" });
      refresh();
    }
  };
  const saveCat = async () => {
    if (!editingCat) return;
    const ok = await run(() =>
      adminSaveCategory({
        data: { id: editingCat.id, data: { name: editingCat.name, emoji: editingCat.emoji } },
      }),
    );
    if (ok) {
      setEditingCat(null);
      refresh();
    }
  };
  const delCat = async (c: NowCategory) => {
    await run(() => adminDeleteCategory({ data: { id: c.id } }));
    refresh();
  };
  const moveCat = async (i: number, dir: -1 | 1) => {
    const ids = reorderIds(cats, i, dir);
    if (!ids) return;
    await run(() => adminReorderCategories({ data: { ids } }));
    refresh();
  };
  const saveItem = async () => {
    if (!item?.title?.trim()) return toast.error("Title is required");
    const { id, ...rest } = item;
    const ok = await run(() =>
      adminSaveNowItem({
        data: {
          id: id ?? null,
          data: {
            categoryId: rest.categoryId,
            title: rest.title!,
            description: rest.description ?? "",
            status: rest.status ?? "doing",
            link: rest.link || null,
            imageUrl: rest.imageUrl || null,
            imageAlt: rest.imageAlt ?? "",
          },
        },
      }),
    );
    if (ok) {
      setItem(null);
      refresh();
    }
  };
  const toggleItem = async (i: NowItem) => {
    await run(() =>
      adminSetNowItemStatus({ data: { id: i.id, status: i.status === "done" ? "doing" : "done" } }),
    );
    refresh();
  };
  const delItem = async (i: NowItem) => {
    await run(() => adminDeleteNowItem({ data: { id: i.id } }));
    refresh();
  };

  return (
    <div>
      <PageHeader
        title="Now board"
        description="Track what you're doing right now — projects, books, drawings, anything."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCat();
        }}
        className="mb-8 flex flex-wrap items-end gap-2 rounded-2xl border border-dashed border-input p-4"
      >
        <Field label="Emoji" className="w-20">
          <Input
            value={newCat.emoji}
            onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value })}
            placeholder="🎨"
            maxLength={16}
          />
        </Field>
        <Field label="New category" className="min-w-48 flex-1">
          <Input
            value={newCat.name}
            onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
            placeholder="e.g. Learning"
            maxLength={80}
          />
        </Field>
        <PrimaryButton type="submit">
          <Plus aria-hidden className="h-4 w-4" /> Add category
        </PrimaryButton>
      </form>

      <div className="flex gap-5 overflow-x-auto pb-4">
        {cats.map((c, ci) => {
          const list = items.filter((i) => i.categoryId === c.id);
          return (
            <section
              key={c.id}
              aria-label={c.name}
              className="flex w-80 shrink-0 flex-col rounded-2xl border border-border bg-card"
            >
              <div className="flex items-center gap-1 border-b border-border p-3">
                <h2 className="flex-1 truncate font-display text-lg">
                  <span aria-hidden>{c.emoji}</span> {c.name}{" "}
                  <span className="font-sans text-xs text-muted-foreground">{list.length}</span>
                </h2>
                <IconButton
                  disabled={ci === 0}
                  onClick={() => moveCat(ci, -1)}
                  aria-label={`Move ${c.name} left`}
                >
                  <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  disabled={ci === cats.length - 1}
                  onClick={() => moveCat(ci, 1)}
                  aria-label={`Move ${c.name} right`}
                >
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton onClick={() => setEditingCat(c)} aria-label={`Rename ${c.name}`}>
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
                <ConfirmButton
                  title={`Delete “${c.name}”?`}
                  description="All items in this category are deleted too."
                  onConfirm={() => delCat(c)}
                >
                  <IconButton aria-label={`Delete category ${c.name}`}>
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </IconButton>
                </ConfirmButton>
              </div>
              <ul className="flex-1 space-y-2 p-3">
                {list.map((i) => (
                  <li
                    key={i.id}
                    className={`group rounded-xl border border-border bg-background p-3 ${i.status === "done" ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={i.status === "done"}
                        onClick={() => toggleItem(i)}
                        aria-label={`Mark “${i.title}” as ${i.status === "done" ? "in progress" : "done"}`}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${i.status === "done" ? "border-success bg-success text-background" : "border-input"}`}
                      >
                        {i.status === "done" && <Check aria-hidden className="h-3 w-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium ${i.status === "done" ? "line-through" : ""}`}
                        >
                          {i.title}
                        </p>
                        {i.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {i.description}
                          </p>
                        )}
                      </div>
                      {/* Visible on keyboard focus and on touch devices, not just mouse hover. */}
                      <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <IconButton
                          onClick={() => setItem({ ...i, status: i.status as "doing" | "done" })}
                          aria-label={`Edit ${i.title}`}
                        >
                          <Pencil aria-hidden className="h-3.5 w-3.5" />
                        </IconButton>
                        <ConfirmButton title={`Delete “${i.title}”?`} onConfirm={() => delItem(i)}>
                          <IconButton aria-label={`Delete ${i.title}`}>
                            <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          </IconButton>
                        </ConfirmButton>
                      </div>
                    </div>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setItem({ categoryId: c.id, status: "doing" })}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
                  >
                    <Plus aria-hidden className="h-4 w-4" /> Add item
                    <span className="sr-only"> to {c.name}</span>
                  </button>
                </li>
              </ul>
            </section>
          );
        })}
        {cats.length === 0 && (
          <p className="text-sm text-muted-foreground">Add your first category above.</p>
        )}
      </div>

      <Dialog open={!!editingCat} onOpenChange={(o) => !o && setEditingCat(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename category</DialogTitle>
            <DialogDescription className="sr-only">Change the emoji or name</DialogDescription>
          </DialogHeader>
          {editingCat && (
            <div className="flex gap-2">
              <Field label="Emoji" className="w-20">
                <Input
                  value={editingCat.emoji}
                  onChange={(e) => setEditingCat({ ...editingCat, emoji: e.target.value })}
                />
              </Field>
              <Field label="Name" className="flex-1">
                <Input
                  value={editingCat.name}
                  onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                />
              </Field>
            </div>
          )}
          <PrimaryButton onClick={saveCat}>Save</PrimaryButton>
        </DialogContent>
      </Dialog>

      <Dialog open={!!item} onOpenChange={(o) => !o && setItem(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{item?.id ? "Edit item" : "New item"}</DialogTitle>
            <DialogDescription className="sr-only">Item details</DialogDescription>
          </DialogHeader>
          {item && (
            <div className="space-y-4">
              <Field label="Title">
                <Input
                  value={item.title ?? ""}
                  onChange={(e) => setItem({ ...item, title: e.target.value })}
                  autoFocus
                  maxLength={160}
                />
              </Field>
              <Field label="Description">
                <Textarea
                  rows={3}
                  value={item.description ?? ""}
                  onChange={(e) => setItem({ ...item, description: e.target.value })}
                  maxLength={1000}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <Select
                    value={item.categoryId}
                    onValueChange={(v) => setItem({ ...item, categoryId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cats.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.emoji} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select
                    value={item.status ?? "doing"}
                    onValueChange={(v) => setItem({ ...item, status: v as "doing" | "done" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="doing">In progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Link (optional)">
                <Input
                  value={item.link ?? ""}
                  onChange={(e) => setItem({ ...item, link: e.target.value })}
                  placeholder="https://"
                />
              </Field>
              <Field label="Image (optional)">
                <ImageField
                  url={item.imageUrl}
                  alt={item.imageAlt ?? ""}
                  onChange={(n) => setItem({ ...item, imageUrl: n.url, imageAlt: n.alt ?? "" })}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <GhostButton onClick={() => setItem(null)}>
                  <RotateCcw aria-hidden className="h-4 w-4" /> Cancel
                </GhostButton>
                <PrimaryButton onClick={saveItem}>Save</PrimaryButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
