/** Presentation metadata only: registration never grants or unlocks an ability. */
export function createHeardAbility<const Name extends string>(name: Name, description: string) {
  return {
    name,
    description,
    opening: "我听到了",
    ending: "的回响",
    caption: `我听到了【${name}】的回响` as const
  } as const;
}

/** Only renewal has a visual caption. Add future abilities through the heard factory. */
export const ABILITY_CATALOG = {
  renewal: {
    name: "生生不息",
    description: "只要想念，就会想见",
    opening: "我看到了",
    ending: "的激荡",
    caption: "我看到了【生生不息】的激荡"
  },
  dream: createHeardAbility("入梦", "循着回响，再见一面")
} as const;

export type AbilityKind = keyof typeof ABILITY_CATALOG;

export function isAbilityKind(value: unknown): value is AbilityKind {
  return typeof value === "string" && Object.hasOwn(ABILITY_CATALOG, value);
}
