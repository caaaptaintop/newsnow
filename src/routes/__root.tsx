import "~/styles/globals.css"
import "virtual:uno.css"
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { isMobile } from "react-device-detect"
import { Header } from "~/components/header"
import { GlobalOverlayScrollbar } from "~/components/common/overlay-scrollbar"
import { Footer } from "~/components/footer"
import { Toast } from "~/components/common/toast"
import { SearchBar } from "~/components/common/search-bar"
import { AISettings } from "~/components/ai-settings"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: RootComponent, notFoundComponent: NotFoundComponent })
function NotFoundComponent() { const nav = Route.useNavigate(); nav({ to: "/" }) }
function RootComponent() {
  useOnReload(); useSync(); usePWA()
  const workspace = useRouterState({ select: state => state.location.pathname === "/" })
  return <>
    <GlobalOverlayScrollbar className={workspace ? "h-full overflow-x-hidden" : $([!isMobile && "px-4", "h-full overflow-x-auto", "md:(px-10)", "lg:(px-24)"])}>
      {!workspace && <header className={$("grid items-center py-4 px-5 lg:(py-6) sticky top-0 z-10 backdrop-blur-md")} style={{ gridTemplateColumns: "50px auto 50px" }}><Header /></header>}
      <main className={workspace ? "" : "mt-2 min-h-[calc(100vh-194px)]"}><Outlet /></main>
      {!workspace && <footer className="py-6 flex flex-col items-center justify-center text-sm text-neutral-500 font-mono"><Footer /></footer>}
    </GlobalOverlayScrollbar>
    <Toast /><SearchBar /><AISettings />
    {import.meta.env.DEV && <><ReactQueryDevtools buttonPosition="bottom-left" /><TanStackRouterDevtools position="bottom-right" /></>}
  </>
}
