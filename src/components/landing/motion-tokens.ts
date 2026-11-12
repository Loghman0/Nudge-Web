export const landingMotion = {
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  micro: 0.18, standard: 0.32, exit: 0.2, stagger: 0.04,
  spring: { type: "spring" as const, stiffness: 100, damping: 20 },
};
