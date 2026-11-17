import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefCallback } from "react";
import { dropIndex, moveTo } from "./exercise-order";

/** Pointer travel (px) before a press on a handle becomes a drag, so a tap never moves a card. */
const DRAG_THRESHOLD = 6;

/** Handlers for one exercise's drag handle: spread them on the handle button. */
export interface MoveHandle {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

interface Press {
  id: string;
  pointerId: number;
  startY: number;
  /** Card midpoints, measured when the press starts, in the order they had then. */
  centers: number[];
  from: number;
  target: number;
  engaged: boolean;
}

/**
 * Reorders exercise cards by dragging their handles (Pointer Events, so touch and mouse behave alike) or with
 * the arrow keys on a focused handle. `order` is the current order of exercise ids. `onMove` gets the new order
 * and the id that moved. Each card registers its element through `cardRef` so the drop can be measured.
 */
export function useExerciseReorder(order: string[], onMove: (ids: string[], movedId: string) => void) {
  const cards = useRef(new Map<string, HTMLElement>());
  const press = useRef<Press | null>(null);
  const refocus = useRef<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; dy: number } | null>(null);
  const orderKey = order.join(",");

  // Moving a card with the keys re-inserts its element, which drops focus; put it back on the moved handle.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    cards.current.get(id)?.querySelector<HTMLElement>("[data-move-handle]")?.focus();
  }, [orderKey]);

  function endPress() {
    press.current = null;
    setDragging(null);
  }

  /** The press this pointer event belongs to, or null when another press or handle owns it. */
  function ownPress(id: string, event: PointerEvent<HTMLElement>): Press | null {
    const current = press.current;
    return current?.id === id && current.pointerId === event.pointerId ? current : null;
  }

  function handleFor(id: string): MoveHandle {
    return {
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const centers = order.map((other) => {
          const box = cards.current.get(other)?.getBoundingClientRect();
          return box ? box.top + box.height / 2 : 0;
        });
        const from = order.indexOf(id);
        press.current = { id, pointerId: event.pointerId, startY: event.clientY, centers, from, target: from, engaged: false };
      },
      onPointerMove(event) {
        const current = ownPress(id, event);
        if (!current) return;
        const dy = event.clientY - current.startY;
        if (!current.engaged && Math.abs(dy) < DRAG_THRESHOLD) return;
        current.engaged = true;
        // The card's midpoint moves with the pointer, so compare that against the others.
        current.target = dropIndex(current.centers, current.from, current.centers[current.from]! + dy);
        setDragging({ id, dy });
      },
      onPointerUp(event) {
        const current = ownPress(id, event);
        if (!current) return;
        endPress();
        if (current.engaged && current.target !== current.from) onMove(moveTo(order, id, current.target), id);
      },
      onPointerCancel(event) {
        if (ownPress(id, event)) endPress();
      },
      onKeyDown(event) {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const to = order.indexOf(id) + step;
        if (!step || to < 0 || to >= order.length) return;
        event.preventDefault();
        refocus.current = id;
        onMove(moveTo(order, id, to), id);
      },
    };
  }

  /** The card's element, so the drop can measure where each card is. */
  function cardRef(id: string): RefCallback<HTMLElement> {
    return (element) => {
      if (element) cards.current.set(id, element);
      else cards.current.delete(id);
    };
  }

  return { handleFor, cardRef, dragging };
}
