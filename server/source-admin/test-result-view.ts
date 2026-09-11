/** Literal browser source: no function.toString() dependence on bundler helper names. */
export const sourceTestResultScript = String.raw`
function renderSourceTestView(input) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  const link = (value, label) => {
    try {
      const url = new URL(String(value))
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error()
      return '<a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+esc(label ?? url.href)+'</a>'
    } catch { return esc(label ?? value) }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '尚未测试当前草稿'
  const result = input
  const endpoints = Array.isArray(result.endpoints) ? result.endpoints.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []
  const passed = endpoints.filter(item => item.ok === true).length
  const untested = endpoints.filter(item => item.ok !== true && item.status === 'untested').length
  const failed = endpoints.length - passed - untested
  const names = endpoints.filter(item => item.ok !== true).map(item => String(item.name ?? '未命名栏目'))
  const heading = endpoints.length ? '已通过 '+passed+' / '+endpoints.length+' 个栏目；未通过 '+failed+' 个'+(untested ? '；未测试 '+untested+' 个' : '') : '测试结果'
  const cards = endpoints.map(item => {
    const state = item.ok === true ? 'ok' : item.status === 'untested' ? 'unknown' : 'error'
    const label = item.ok === true ? '通过' : item.status === 'untested' ? '未测试' : '未通过'
    const diagnostic = item.diagnostic && typeof item.diagnostic === 'object' ? item.diagnostic : null
    const status = Number.isInteger(diagnostic?.httpStatus) ? 'HTTP '+diagnostic.httpStatus : ''
    const code = /^1\d{3}$/.test(diagnostic?.cloudflareCode ?? '') ? 'Cloudflare '+diagnostic.cloudflareCode : ''
    const details = [status, code].filter(Boolean).join(' / ')
    const preview = Array.isArray(item.preview) ? item.preview.slice(0,5).map(article => '<li>'+link(article?.url, article?.title)+'</li>').join('') : ''
    return '<section class="source-test-card '+state+'" data-test-endpoint="'+esc(item.id)+'"><div class="source-test-title"><b>'+esc(item.name)+'</b><span>'+label+'</span></div><div class="source-test-url">'+link(item.url)+'</div>'+(item.finalUrl && item.finalUrl !== item.url ? '<div>最终地址：'+link(item.finalUrl)+'</div>' : '')+(details ? '<div class="source-test-code">'+esc(details)+'</div>' : '')+'<p>'+esc(item.message)+'</p>'+(item.ok === true ? '<div>识别到 '+esc(item.count)+' 篇候选；请确认是否属于目标栏目。</div>' : '')+(preview ? '<ul>'+preview+'</ul>' : '')+'</section>'
  }).join('')
  return '<div class="source-test-summary" role="status"><b>'+esc(heading)+'</b>'+(names.length ? '<p>需要处理：'+esc(names.join('、'))+'</p>' : '')+'<p>'+esc(result.message)+'</p><p class="muted">当前为云端测试，生产采集运行在 Mac；网络失败不等于栏目地址错误。打开原页也不能替代测试通过。</p></div>'+cards+'<details class="source-test-raw"><summary>技术详情（JSON）</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details>'
}
`
