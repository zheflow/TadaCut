import { useRef } from "react";
import { Check, MessageSquarePlus } from "lucide-react";
import type { StudioReference } from "../../../../packages/platform/src/studio";
import { getState, setState, useStudio } from "../lib/store";
import { referenceKey, selectReference } from "../lib/studio-control";

export function ReferenceButton({ reference }: { reference: StudioReference }) {
  const chosen = useStudio((s) =>
    s.references.some((r) => referenceKey(r) === referenceKey(reference)),
  );
  return (
    <button
      className={`reference-button ${chosen ? "active" : ""}`}
      title={chosen ? "取消引用" : "引用到创作助手"}
      aria-label={`${chosen ? "取消引用" : "引用"}「${reference.name}」`}
      aria-pressed={chosen}
      onClick={(e) => {
        e.stopPropagation();
        selectReference(reference, { toggle: true });
        setState({ assistantOpen: true });
      }}
    >
      {chosen ? <Check size={12} /> : <MessageSquarePlus size={12} />}
      <span>{chosen ? "已引用" : "引用"}</span>
    </button>
  );
}

/** Use the displayed order for Shift ranges; Cmd/Ctrl toggles without losing a selection. */
export function useReferenceSelection(items: StudioReference[]) {
  const anchor = useRef<string | null>(null);
  const references = useStudio((s) => s.references);
  const isSelected = (r: StudioReference) =>
    references.some((x) => referenceKey(x) === referenceKey(r));
  const select = (
    reference: StudioReference,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    const index = items.findIndex(
      (x) => referenceKey(x) === referenceKey(reference),
    );
    const start = items.findIndex((x) => referenceKey(x) === anchor.current);
    if (e.shiftKey && start >= 0 && index >= 0)
      selectReference(reference, {
        range: items.slice(Math.min(start, index), Math.max(start, index) + 1),
      });
    else {
      selectReference(reference, { toggle: e.metaKey || e.ctrlKey });
      anchor.current = referenceKey(reference);
    }
    if (reference.kind === "asset") setState({ selectedClipIds: [] });
  };
  const startDrag = (reference: StudioReference, data: DataTransfer) => {
    if (!isSelected(reference)) selectReference(reference);
    const selected = getState().references.filter(
      (r) => r.kind === "asset" && r.projectId === reference.projectId,
    );
    data.effectAllowed = "copy";
    data.setData("application/tadacut-asset", reference.id);
    data.setData("application/tadacut-assets", JSON.stringify(selected));
  };
  return { select, isSelected, startDrag };
}
