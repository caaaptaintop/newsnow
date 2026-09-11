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
  const runtimeNote = result.runtimePending === true
    ? '<p class="muted">Cloudflare 云端 DNS 无法读取该站点，已排队等待 Mac 后台自然周期复核；无需重复点击测试。自然周期完成后刷新管理页即可看到本机结果，Mac 结果返回前不能发布。</p>'
    : result.executor === 'mac'
      ? '<p class="muted">本结果来自已登记签名身份的 Mac 运行环境；请人工确认标题样本后再发布。</p>'
      : '<p class="muted">当前为云端测试，生产采集运行在 Mac；网络失败不等于栏目地址错误。打开原页也不能替代测试通过。</p>'
  const namesLabel = result.runtimePending === true ? '等待本机复核：' : '需要处理：'
  return '<div class="source-test-summary" role="status"><b>'+esc(heading)+'</b>'+(names.length ? '<p>'+namesLabel+esc(names.join('、'))+'</p>' : '')+'<p>'+esc(result.message)+'</p>'+runtimeNote+'</div>'+cards+'<details class="source-test-raw"><summary>技术详情（JSON）</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details>'
}
`
