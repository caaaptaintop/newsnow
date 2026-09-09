import "~/styles/globals.css"
import "virtual:uno.css"
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { GlobalOverlayScrollbar } from "~/components/common/overlay-scrollbar"
import { Toast } from "~/components/common/toast"
import { useRegisterSW } from "virtual:pwa-register/react"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: RootComponent, notFoundComponent: UnavailablePage })
export function UnavailablePage() {
  return <div className="intel-app"><section className="intel-main"><div className="intel-empty"><h1>此页面暂未开放</h1><p>本站目前仅提供建筑资讯，无需登录。</p><a className="intel-button" href="/?topic=building">返回建筑情报</a></div></section></div>
}
function RootComponent() {
  // Retain the cleanup service worker, without legacy login/sync/AI settings hooks.
  useRegisterSW()
  return <><GlobalOverlayScrollbar className="h-full overflow-x-hidden"><main><Outlet /></main></GlobalOverlayScrollbar><Toast /></>
}
