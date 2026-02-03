export type AppStateStatusLike = "active" | "inactive" | "background" | string;

export function isResumeTransition(prev: AppStateStatusLike, next: AppStateStatusLike): boolean {
  return (prev === "inactive" || prev === "background") && next === "active";
}

