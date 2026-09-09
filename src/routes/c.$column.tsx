import { createFileRoute } from "@tanstack/react-router"
import { UnavailablePage } from "./__root"

// Keep the old URL routable only as an unavailable page; do not import raw feeds.
export const Route = createFileRoute("/c/$column")({ component: UnavailablePage })
