const { makePng } = require('../src/vision-bridge.cjs')

const port = Number(process.argv[2])
const workspace = process.argv[3]
if (!Number.isInteger(port) || !workspace) throw new Error('usage: node run-vision-no-key-acceptance.cjs <port> <workspace>')

async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `${method}-${Date.now()}`, method, payload }),
  })
  const envelope = await response.json()
  if (!envelope?.result?.ok) throw new Error(`${method}: ${JSON.stringify(envelope?.result?.error)}`)
  return envelope.result.value
}

async function main() {
  const registered = await rpc('workspace.create', { path: workspace })
  const created = await rpc('session.create', { workspaceId: registered.workspace.workspaceId })
  const data = `data:image/png;base64,${makePng(20, 20).toString('base64')}`
  const prompt = [
    'You must call the vision_analyze tool exactly once with the following arguments:',
    `data: ${data}`,
    'prompt: Describe this test image.',
    'No Vision API key is configured. After the tool result, reply with exactly VISION_AWAITING_KEY_OK.',
  ].join('\n')
  await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  })
  const deadline = Date.now() + 120_000
  let history
  let reason
  while (Date.now() < deadline) {
    history = await rpc('session.history', { sessionId: created.sessionId, maxMessages: 40 })
    const end = history.events.find(entry => entry.event?.type === 'turn/end')
    if (end) { reason = end.event.data?.reason?.kind; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!history || !reason) throw new Error('vision no-key turn timeout')
  const toolCalls = history.events.filter(entry => entry.event?.type === 'tool/call').map(entry => entry.event.data?.name)
  const toolResults = history.events.filter(entry => entry.event?.type === 'tool/result')
    .map(entry => JSON.stringify(entry.event.data)).join('\n')
  const assistant = []
  for (const entry of history.events) {
    if (entry.event?.type !== 'assistant/message') continue
    const parts = entry.event.data?.message?.content ?? entry.event.data?.content ?? []
    for (const part of parts) if (part?.type === 'text') assistant.push(part.text)
  }
  const summary = {
    sessionId: created.sessionId,
    turnEnd: reason,
    toolCalls,
    awaitingKeyObserved: toolResults.includes('Awaiting API Key') || toolResults.includes('MISSING_CREDENTIAL'),
    assistant,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (reason !== 'completed' || !toolCalls.includes('vision_analyze') || !summary.awaitingKeyObserved
    || !assistant.includes('VISION_AWAITING_KEY_OK')) process.exitCode = 1
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
