import { test as base } from "@playwright/test";

type IntroOptions = {
  showIntro: boolean;
  showJourney: boolean;
};

export const test = base.extend<IntroOptions>({
  showIntro: [false, { option: true }],
  showJourney: [false, { option: true }],
  context: async ({ context, showIntro, showJourney }, provideContext) => {
    if (!showJourney) await context.addInitScript(() => sessionStorage.setItem("renewal:journey-suppress:v1", "1"));
    if (!showIntro) {
      await context.addInitScript(() => {
        sessionStorage.setItem("renewal:intro-seen:v1", "1");
      });
    }
    await provideContext(context);
  }
});

export { expect } from "@playwright/test";
export type { Page, Request } from "@playwright/test";
