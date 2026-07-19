import { useRef, useState, type PointerEvent } from 'react';
import type { Provider } from '../../../runtime/protocol';

function moveProvider(
  providers: Provider[],
  provider: Provider,
  targetIndex: number,
): Provider[] {
  const sourceIndex = providers.indexOf(provider);
  if (sourceIndex < 0) {
    return providers;
  }

  const next = [...providers];
  next.splice(sourceIndex, 1);
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(Math.max(0, Math.min(adjustedTargetIndex, next.length)), 0, provider);
  return next;
}

export function ProviderOrderList(props: {
  providers: Provider[];
  visibleProviders: Provider[];
  selectedProviders: Provider[];
  loading: boolean;
  onToggleProvider: (provider: Provider) => void;
  onChange: (providers: Provider[]) => void;
}) {
  const [draggingProvider, setDraggingProvider] = useState<Provider | null>(null);
  const pointerDragRef = useRef<{ provider: Provider; pointerId: number } | null>(null);

  const commitDrop = (
    sourceProvider: Provider,
    targetProvider: Provider,
    clientY: number,
    bounds: DOMRect,
  ) => {
    if (sourceProvider === targetProvider) {
      setDraggingProvider(null);
      return;
    }

    const targetIndex = props.providers.indexOf(targetProvider);
    const insertAfter = clientY >= bounds.top + bounds.height / 2;
    props.onChange(moveProvider(
      props.providers,
      sourceProvider,
      targetIndex + (insertAfter ? 1 : 0),
    ));
    setDraggingProvider(null);
  };

  const handlePointerUp = (event: PointerEvent<HTMLSpanElement>) => {
    const pointerDrag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (!pointerDrag) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(pointerDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(pointerDrag.pointerId);
    }

    const targetRow = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.askem-ep-row-shell');
    const targetProvider = targetRow?.dataset.provider as Provider | undefined;
    if (!targetRow || !targetProvider) {
      setDraggingProvider(null);
      return;
    }

    commitDrop(
      pointerDrag.provider,
      targetProvider,
      event.clientY,
      targetRow.getBoundingClientRect(),
    );
  };

  return (
    <div className="askem-ep-list" aria-label="Default chats and popup order">
      {props.visibleProviders.map((provider) => {
        const active = props.selectedProviders.includes(provider);
        const locked = active && props.selectedProviders.length <= 1;

        return (
          <div
            className={`askem-ep-row-shell ${active ? 'is-active' : ''} ${
              draggingProvider === provider ? 'is-dragging' : ''
            }`}
            data-provider={provider}
            key={provider}
          >
            <span
              className="askem-ep-drag-handle"
              onPointerDown={(event) => {
                if (props.loading) {
                  return;
                }
                pointerDragRef.current = { provider, pointerId: event.pointerId };
                setDraggingProvider(provider);
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                pointerDragRef.current = null;
                setDraggingProvider(null);
              }}
              aria-label={`Drag ${provider} to reorder`}
              title={`Drag ${provider} to reorder`}
            >
              <span aria-hidden="true">⋮⋮</span>
            </span>
            <button
              className={`askem-ep-row ${active ? 'is-active' : ''}`}
              onClick={() => props.onToggleProvider(provider)}
              disabled={props.loading || locked}
              aria-pressed={active}
              aria-label={
                locked
                  ? `Keep ${provider} selected for new sets`
                  : `${active ? 'Remove' : 'Add'} ${provider} from new set defaults`
              }
              type="button"
            >
              <span className="askem-ep-dot" aria-hidden="true" />
              <span className="askem-ep-copy">
                <span className="askem-ep-name">{provider}</span>
                <span className="askem-ep-state">
                  {active ? 'Included' : 'Not included'}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
