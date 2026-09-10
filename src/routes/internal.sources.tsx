import { createFileRoute } from "@tanstack/react-router"
import { SourceAdmin } from "~/components/source-admin"

export const Route = createFileRoute("/internal/sources")({ component: SourceAdmin })
