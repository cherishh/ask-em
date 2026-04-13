import { describe, expect, it } from 'vitest';
import {
  clampIndicatorPixels,
  getDefaultIndicatorPlacement,
  getPanelPlacement,
  pixelsToPlacement,
  placementToPixels,
} from './position';

describe('content position helpers', () => {
  it('maps default placement to the bottom-right safe area', () => {
    expect(
      placementToPixels(
        getDefaultIndicatorPlacement(),
        { width: 200, height: 44 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({
      left: 984,
      top: 740,
    });
  });

  it('round-trips between pixels and ratios', () => {
    const placement = pixelsToPlacement(
      { left: 320, top: 200 },
      { width: 220, height: 44 },
      { width: 1280, height: 900 },
    );

    expect(
      placementToPixels(placement, { width: 220, height: 44 }, { width: 1280, height: 900 }),
    ).toEqual({
      left: 320,
      top: 200,
    });
  });

  it('clamps dragged indicator pixels back into the safe area', () => {
    expect(
      clampIndicatorPixels(
        { left: -30, top: 900 },
        { width: 220, height: 44 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      left: 16,
      top: 740,
    });
  });

  it('opens the panel upward when the indicator sits in the lower half', () => {
    expect(
      getPanelPlacement(
        { left: 880, top: 650, bottom: 694, width: 220, height: 44 },
        { width: 252, height: 180 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      left: 864,
      top: 460,
      side: 'up',
    });
  });

  it('opens the panel downward when the indicator sits in the upper half', () => {
    expect(
      getPanelPlacement(
        { left: 120, top: 60, bottom: 104, width: 220, height: 44 },
        { width: 252, height: 180 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      left: 104,
      top: 114,
      side: 'down',
    });
  });
});
