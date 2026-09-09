import { useEffect, useState, type ReactNode } from "react"

type FilterOption = { id: string, name: string }
export type LocationGroup = { region: string, cities: string[] }
function FilterShell({ title, count, open, onToggle, menuClassName = "", children }: { title: string, count: number, open: boolean, onToggle: () => void, menuClassName?: string, children: ReactNode }) {
  return <div className="intel-filter">
    <button type="button" className="intel-filter-trigger" aria-haspopup="true" aria-expanded={open} onClick={onToggle}>{title}{count > 0 && <span className="intel-filter-count">{count}</span>}<span className="intel-caret">⌄</span></button>
    {open && <div className={`intel-filter-menu${menuClassName ? ` ${menuClassName}` : ""}`}>{children}</div>}
  </div>
}
export function MultiFilter({ title, options, value, open, onToggle, onChange }: { title: string, options: FilterOption[], value: string[], open: boolean, onToggle: () => void, onChange: (values: string[]) => void }) {
  return <FilterShell title={title} count={value.length} open={open} onToggle={onToggle}>
    <button type="button" className="intel-text-button" onClick={() => onChange([])}>不限{title}</button>
    {!options.length && <p className="intel-muted">当前没有可用选项</p>}
    {options.map(option => <label key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={e => onChange(e.target.checked ? [...value, option.id] : value.filter(v => v !== option.id))} /><span>{option.name}</span></label>)}
  </FilterShell>
}
export function LocationFilter({ groups, regions, cities, open, onToggle, onChange }: { groups: LocationGroup[], regions: string[], cities: string[], open: boolean, onToggle: () => void, onChange: (regions: string[], cities: string[]) => void }) {
  const [activeRegion, setActiveRegion] = useState<string>()
  useEffect(() => { if (!open) setActiveRegion(undefined) }, [open])
  const activeGroup = groups.find(group => group.region === activeRegion)
  return <FilterShell title="发布地区" count={regions.length + cities.length} open={open} onToggle={onToggle} menuClassName="intel-location-menu">
    <div className="intel-location-toolbar"><button type="button" className="intel-text-button" onClick={() => { setActiveRegion(undefined); onChange([], []) }}>不限地区</button><span>先选省级地区，再按需选择城市</span></div>
    {!groups.length && <p className="intel-muted">当前没有可用选项</p>}
    {!!groups.length && <div className="intel-location-cascade">
      <div className="intel-location-regions" aria-label="省级地区">{groups.map(group => {
        const regionChecked = regions.includes(group.region)
        const selectedCityCount = group.cities.filter(city => cities.includes(city)).length
        if (!group.cities.length) return <label className="intel-location-region-leaf" key={group.region}><input type="checkbox" checked={regionChecked} onChange={e => onChange(e.target.checked ? [...regions, group.region] : regions.filter(region => region !== group.region), cities)} /><span>{group.region}</span></label>
        return <div className={`intel-location-region-row${activeRegion === group.region ? " is-active" : ""}`} key={group.region}>
          <label className="intel-location-region-check"><input type="checkbox" aria-label={`选择${group.region}全部地区`} checked={regionChecked} onChange={e => onChange(e.target.checked ? [...regions, group.region] : regions.filter(region => region !== group.region), e.target.checked ? cities.filter(city => !group.cities.includes(city)) : cities)} /></label>
          <button type="button" className="intel-location-region-button" aria-expanded={activeRegion === group.region} onClick={() => setActiveRegion(group.region)}><span>{group.region}</span>{selectedCityCount > 0 && !regionChecked && <span className="intel-location-city-count">{selectedCityCount}</span>}<span className="intel-location-next" aria-hidden="true">›</span></button>
        </div>
      })}</div>
      <div className="intel-location-submenu">
        {!activeGroup && <div className="intel-location-placeholder">选择左侧省级地区查看城市</div>}
        {activeGroup && <><div className="intel-location-submenu-head"><strong>{activeGroup.region}</strong><span>{regions.includes(activeGroup.region) ? "已选择整个地区" : "选择具体城市"}</span></div><div className="intel-location-city-options">{activeGroup.cities.map(city => {
          const regionChecked = regions.includes(activeGroup.region)
          return <label className={regionChecked ? "is-disabled" : ""} key={city}><input type="checkbox" disabled={regionChecked} checked={!regionChecked && cities.includes(city)} onChange={e => onChange(regions, e.target.checked ? [...cities, city] : cities.filter(value => value !== city))} /><span>{city}</span></label>
        })}</div></>}
      </div>
    </div>}
  </FilterShell>
}
