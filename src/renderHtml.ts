import nunjucks from "nunjucks";
import type { Paper } from "./types.js";

nunjucks.configure("templates", { autoescape: true });

export function renderDailyHtml(date: string, papers: Paper[]): string {
  return nunjucks.render("daily.html", { date, papers });
}
