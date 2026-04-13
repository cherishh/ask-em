import { STORAGE_KEYS, type Provider } from '../runtime/protocol';

export type IndicatorPlacement = {
  xRatio: number;
  yRatio: number;
};

export type RectSize = {
  width: number;
  height: number;
};

export type PanelPlacement = {
  left: number;
  top: number;
  side: 'up' | 'down';
};

type StoredIndicatorPlacements = Partial<
  Record<Provider, IndicatorPlacement>
>;

const SAFE_MARGIN_PX = 16;
const PANEL_GAP_PX = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampRatio(value: number): number {
  return clamp(value, 0, 1);
}

function getTravelDistance(viewport: number, size: number, margin = SAFE_MARGIN_PX): number {
  return Math.max(viewport - size - margin * 2, 0);
}

export function getDefaultIndicatorPlacement(): IndicatorPlacement {
  return {
    xRatio: 1,
    yRatio: 1,
  };
}

export function placementToPixels(
  placement: IndicatorPlacement,
  size: RectSize,
  viewport: RectSize,
  margin = SAFE_MARGIN_PX,
) {
  const travelX = getTravelDistance(viewport.width, size.width, margin);
  const travelY = getTravelDistance(viewport.height, size.height, margin);

  return {
    left: margin + travelX * clampRatio(placement.xRatio),
    top: margin + travelY * clampRatio(placement.yRatio),
  };
}

export function pixelsToPlacement(
  pixels: { left: number; top: number },
  size: RectSize,
  viewport: RectSize,
  margin = SAFE_MARGIN_PX,
): IndicatorPlacement {
  const travelX = getTravelDistance(viewport.width, size.width, margin);
  const travelY = getTravelDistance(viewport.height, size.height, margin);

  return {
    xRatio: travelX === 0 ? 0 : clampRatio((pixels.left - margin) / travelX),
    yRatio: travelY === 0 ? 0 : clampRatio((pixels.top - margin) / travelY),
  };
}

export function clampIndicatorPixels(
  pixels: { left: number; top: number },
  size: RectSize,
  viewport: RectSize,
  margin = SAFE_MARGIN_PX,
) {
  return {
    left: clamp(pixels.left, margin, Math.max(margin, viewport.width - size.width - margin)),
    top: clamp(pixels.top, margin, Math.max(margin, viewport.height - size.height - margin)),
  };
}

export function getPanelPlacement(
  pillRect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width' | 'height'>,
  panelSize: RectSize,
  viewport: RectSize,
  margin = SAFE_MARGIN_PX,
): PanelPlacement {
  const centerX = pillRect.left + pillRect.width / 2;
  const centerY = pillRect.top + pillRect.height / 2;
  const side = centerY > viewport.height / 2 ? 'up' : 'down';
  const left = clamp(
    centerX - panelSize.width / 2,
    margin,
    Math.max(margin, viewport.width - panelSize.width - margin),
  );
  const unclampedTop =
    side === 'up'
      ? pillRect.top - panelSize.height - PANEL_GAP_PX
      : pillRect.bottom + PANEL_GAP_PX;
  const top = clamp(
    unclampedTop,
    margin,
    Math.max(margin, viewport.height - panelSize.height - margin),
  );

  return {
    left,
    top,
    side,
  };
}

async function readStoredPlacements(): Promise<StoredIndicatorPlacements> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.indicatorPositions);
  return (result[STORAGE_KEYS.indicatorPositions] as StoredIndicatorPlacements | undefined) ?? {};
}

export async function loadIndicatorPlacement(
  provider: Provider,
): Promise<IndicatorPlacement | null> {
  const placements = await readStoredPlacements();
  return placements[provider] ?? null;
}

export async function saveIndicatorPlacement(
  provider: Provider,
  placement: IndicatorPlacement,
): Promise<void> {
  const placements = await readStoredPlacements();

  await chrome.storage.local.set({
    [STORAGE_KEYS.indicatorPositions]: {
      ...placements,
      [provider]: {
        xRatio: clampRatio(placement.xRatio),
        yRatio: clampRatio(placement.yRatio),
      },
    },
  });
}
