import { createPublicBrandTheme, gdsTheme } from "@sovereignsquad/gds";

// Reply Core's theme: the GDS default theme with two accessibility corrections, made through the sanctioned
// `createPublicBrandTheme({ overrides })` path (no CSS, no second theme authority).
//
// Measured with axe-core in Chrome against GDS 6.8.0 (see docs/CORE_UI.md and sovereignsquad/general-design-system#944):
//   - dimmed secondary text (PageHeader and StateBlock descriptions) is gray-6 on white = 3.3:1 (needs 4.5:1)
//     and dark-2 on the dark page = 4.0:1;
//   - the active navigation label (violet-6 on its tint) = 4.3:1.
// Darkening gray-6 (light) and lightening dark-2 (dark) fixes the first; primary shade 7 in light mode fixes the second.
// Remove this file's overrides once GDS ships defaults that pass.
type Ramp = NonNullable<NonNullable<typeof gdsTheme.colors>["gray"]>;
const replaceShade = (ramp: Ramp, index: number, value: string): Ramp => ramp.map((c, i) => (i === index ? value : c)) as unknown as Ramp;

export const replyTheme = createPublicBrandTheme({
  overrides: {
    primaryShade: { light: 7, dark: 8 },
    colors: {
      gray: replaceShade(gdsTheme.colors!.gray as Ramp, 6, "#4b5563"),
      dark: replaceShade(gdsTheme.colors!.dark as Ramp, 2, "#c1c2c5"),
    },
  },
});
